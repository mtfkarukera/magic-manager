// export.js — Module d'exportation de sources individuelles et par lot
// Auteur : MTF Karukera | Licence : MPL-2.0
// Dépendances :
// - window.MM (t, createElement, debounce, findSourcesListContainer,
//   findSelectAllRow, getCheckedSourceCheckboxes, findSourceContainerByTitle,
//   findSourceCardFromCheckbox — via source-helpers.js)
// - lib/jspdf.umd.min.js (window.jspdf)
// Note : JSZip supprimé — ZIP généré en pur JS via buildZipBlob (format STORE, sans eval)

'use strict';

(function () {
  const { t, createElement, debounce } = window.MM;

  // ═══════════════════════════════════════════════════════════════════════
  // État interne
  // ═══════════════════════════════════════════════════════════════════════

  /** Bouton d'exportation par lot (injecté dynamiquement) */
  let batchExportButton = null;

  /** Dernier nombre de sources cochées connu — sert de verrou d'idempotence */
  let lastBatchExportCount = -1;


  // ════════════════════════════════════════════════════════  // Les fonctions utilitaires et de génération (cleanSourceTitle, stripSourceExtension,
  // findSourceIdByTitle, crc32, buildZipBlob, downloadBlob, walkDOM, generatePdfBlob)
  // sont désormais importées depuis window.MM.exportUtils.
  const {
    cleanSourceTitle,
    stripSourceExtension,
    findSourceIdByTitle,
    getFormattedTimestamp,
    buildZipBlob,
    downloadBlob,
    generatePdfBlob,
    findIndividualSourceData,
    checkIfTruncated
  } = window.MM.exportUtils;

  // ═══════════════════════════════════════════════════════════════════════
  // Pictogrammes SVG
  // ═══════════════════════════════════════════════════════════════════════

  function createDownloadIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.display = 'block';
    svg.style.pointerEvents = 'none';

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M5 20h14v-2H5v2zm7-18L5.33 11h4V16h5.33v-5h4L12 2z');
    
    svg.appendChild(path);
    return svg;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Actions d'exportation par lot
  // ═══════════════════════════════════════════════════════════════════════

  async function triggerBatchExport() {
    const checked = window.MM.getCheckedSourceCheckboxes();
    if (checked.length === 0) return;

    // Fermer le dialogue global de paramétrage s'il est ouvert
    const settings = document.getElementById('mm-settings-menu');
    if (settings) settings.style.display = 'none';

    // Afficher la modale de choix de format riche avec radio-boutons
    window.MM.showExportFormatDialog(function (format) {
      startBatchProcess(checked, format);
    });
  }

  /**
   * Lance le processus d'exportation par lot pour les sources sélectionnées.
   *
   * @param {Array<HTMLInputElement>} checkboxes - Les checkboxes des sources cochées
   * @param {string} format - Le format d'export choisi ('md', 'pdf-simple', 'pdf-structured')
   */
  async function startBatchProcess(checkboxes, format) {
    console.log(`[MM] Lancement de l'exportation par lot au format ${format} pour ${checkboxes.length} sources...`);

    const notebookId = window.MM.getActiveNotebookId();
    if (!notebookId) {
      window.MM.showAlertDialog('exportError', 'notebookIdNotFound');
      return;
    }

    let isCancelled = false;
    let progressDialog = null;

    if (checkboxes.length > 1) {
      progressDialog = window.MM.showProgressDialog(
        window.MM.t('exportingTitle') || 'Exportation en cours...',
        checkboxes.length,
        function () {
          console.log('[MM] Exportation annulée par l\'utilisateur.');
          isCancelled = true;
        }
      );
    }

    try {
      // Récupérer toutes les sources du carnet via RPC pour le matching par titre
      let allSources = [];
      try {
        allSources = await window.MM.rpc.getNotebookSources(notebookId);
      } catch (e) {
        console.warn('[MM] Impossible de lister les sources du notebook via RPC.', e);
      }

      const zipFiles = [];
      const activeNotebookName = getActiveNotebookName();
      const timestamp = getFormattedTimestamp();
      let anyTruncated = false;

    for (let i = 0; i < checkboxes.length; i++) {
      if (window.MM.getActiveNotebookId() !== notebookId) {
        console.log('[MM] Export par lot interrompu : changement de notebook détecté.');
        break;
      }
      const cb = checkboxes[i];

      // Remonter vers la carte source parente
      const sourceInfo = window.MM.findSourceCardFromCheckbox(cb);
      if (!sourceInfo) {
        console.warn(`[MM] Export batch : impossible de remonter au conteneur pour la checkbox ${i}`);
        continue;
      }

      const title = cleanSourceTitle(sourceInfo.title);
      console.log(`[MM] Export batch : traitement de "${title.slice(0, 50)}" (${i+1}/${checkboxes.length})`);

      // 1. Extraire l'ID de la source
      let sourceId = window.MM.extractSourceId(sourceInfo.card);
      if (!sourceId && allSources.length > 0) {
        sourceId = findSourceIdByTitle(title, allSources);
      }

      if (!sourceId) {
        console.error(`[MM] Impossible de trouver l'identifiant de la source pour "${title}"`);
        continue;
      }

      // 2. Récupérer le contenu via RPC selon le format demandé
      try {
        let content;
        if (format === 'pdf-riche') {
          content = await window.MM.rpc.getSourceContentHtml(sourceId, notebookId);
          if (checkIfTruncated(content, true)) {
            anyTruncated = true;
          }
        } else {
          const isHtmlRequest = format === 'md-riche';
          content = await window.MM.rpc.getSourceContent(sourceId, notebookId, {
            format: isHtmlRequest ? 'html' : 'text'
          });
          if (format === 'md-riche' && checkIfTruncated(content, false)) {
            anyTruncated = true;
          }
        }

        if (content) {
          const baseName = stripSourceExtension(title || `Source_${i+1}`);
          const safeTitle = baseName.replace(/[\/\\?%*:|"<>\s]/g, '_');

          if (checkboxes.length === 1) {
            // Un seul fichier : téléchargement direct avec horodatage
            if (format === 'md-riche' || format === 'md-simple') {
              const blob = new Blob([content], { type: 'text/markdown;charset=utf-8;' });
              downloadBlob(blob, `${safeTitle}_${timestamp}.md`);
            } else {
              const isStructured = format === 'pdf-riche';
              const pdfBlob = await generatePdfBlob(content, title, { structured: isStructured, loadImages: true });
              downloadBlob(pdfBlob, `${safeTitle}_${timestamp}.pdf`);
            }
          } else {
            // Plusieurs fichiers : empiler pour le ZIP (nom simple dans le ZIP)
            if (format === 'md-riche' || format === 'md-simple') {
              zipFiles.push({ name: safeTitle + '.md', data: content });
            } else {
              const isStructured = format === 'pdf-riche';
              const pdfBlob = await generatePdfBlob(content, title, { structured: isStructured, loadImages: true });
              const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());
              zipFiles.push({ name: safeTitle + '.pdf', data: pdfBytes });
            }
          }
        } else {
          console.warn(`[MM] Contenu vide reçu pour "${title}"`);
        }
      } catch (err) {
        console.error(`[MM] Échec de la récupération du contenu pour "${title}" :`, err);
      }

      // Délai anti rate-limiting NotebookLM : 400ms
      if (i < checkboxes.length - 1) {
        await new Promise(r => setTimeout(r, 400));
      }
    }

    // Si export multiple : générer et télécharger l'archive ZIP horodatée
    if (checkboxes.length > 1 && zipFiles.length > 0) {
      const safeNotebookName = (activeNotebookName || 'Notebook_Sources').replace(/[\/\\?%*:|"<>\s]/g, '_');
      const zipName = `${safeNotebookName}_${timestamp}.zip`;
      const zipBlob = buildZipBlob(zipFiles);
      downloadBlob(zipBlob, zipName);
      console.log(`[MM] Package ZIP téléchargé : ${zipName} (${zipFiles.length} fichiers)`);
    }

    if (anyTruncated) {
      window.MM.showAlertDialog('truncationWarning', 'truncationWarning');
    }

    console.log('[MM] Exportation par lot terminée');
    } catch (globalErr) {
      console.error('[MM] Erreur globale lors du processus d\'exportation par lot :', globalErr);
      window.MM.showAlertDialog(
        window.MM.t('exportBatchErrorTitle') || 'Erreur d\'exportation',
        window.MM.t('exportBatchErrorMsg') || 'Une erreur inattendue est survenue pendant l\'exportation. Veuillez réessayer.'
      );
    } finally {
      if (progressDialog && typeof progressDialog.close === 'function') {
        progressDialog.close();
      }
    }
  }

  function getActiveNotebookName() {
    const titleLabel = document.querySelector('.title-label-inner');
    if (titleLabel) return titleLabel.textContent.trim();
    const titleInput = document.querySelector('.title-input');
    if (titleInput) return titleInput.value.trim();
    return 'Notebook';
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Injection et Détection
  // ═══════════════════════════════════════════════════════════════════════

  function checkAndInjectIndividualExport() {
    if (typeof window.MM.isFeatureEnabled === 'function' && !window.MM.isFeatureEnabled('export')) return;
    // Vérifier que source-viewer est actif avant toute chose
    const sourceViewer = document.querySelector('source-viewer');
    if (!sourceViewer) return;

    // 1. Trouver le panel-header du panneau des sources (mode desktop)
    const sourcePanel = document.querySelector('section.source-panel');
    const panelHeader = sourcePanel ? sourcePanel.querySelector('.panel-header') : null;

    let anchor = panelHeader;
    let collapseBtn = null;

    if (panelHeader) {
      const nativeButtons = Array.from(panelHeader.querySelectorAll(
        'button:not(.mm-individual-delete-btn):not(.mm-individual-export-btn)'
      ));
      collapseBtn = nativeButtons.length > 0 ? nativeButtons[nativeButtons.length - 1] : null;
    }

    // 2. Si non trouvé (mode mobile), s'ancrer sur le bouton de retour du document (recherche globale robuste)
    if (!anchor || !collapseBtn) {
      const closeBtn = window.MM.findSourceViewerCloseButton(sourceViewer);
      if (closeBtn) {
        anchor = closeBtn.parentNode;
        collapseBtn = closeBtn;
      }
    }

    // Si les éléments requis ne sont pas encore prêts (hydratation Angular asynchrone)
    if (!anchor || !collapseBtn) {
      const retryCount = parseInt(sourceViewer.dataset.mmExportRetryCount || '0', 10);
      if (retryCount < 3) {
        sourceViewer.dataset.mmExportRetryCount = String(retryCount + 1);
        setTimeout(function () {
          checkAndInjectIndividualExport();
        }, retryCount === 0 ? 100 : 300);
      }
      return;
    }

    // Vérifier localement sous le parent commun pour éviter de détecter
    // des boutons fantômes d'autres onglets mis en cache par Angular
    if (collapseBtn.parentNode.querySelector('.mm-individual-export-btn')) return;

    // Bouton d'exportation individuel circulaire (stylisé par classe .mm-individual-export-btn)
    const exportBtn = createElement('button', {
      className: 'mm-individual-export-btn mm-btn-icon',
      title: t('exportButton'),
      'aria-label': t('exportButton'),
      onClick: function (e) {
        e.stopPropagation();

        const notebookId = window.MM.getActiveNotebookId();
        if (!notebookId) return;

        // Récupérer le titre affiché
        const sourceViewer = document.querySelector('source-viewer');
        if (!sourceViewer) return;
        const rawTitle = window.MM.findSourceViewerTitleText(sourceViewer) ||
                      (window.MM.findSourceViewerTitle(sourceViewer) || { textContent: '' }).textContent.trim();
        const cleanedTitle = cleanSourceTitle(rawTitle);
        if (!cleanedTitle) return;

        // Utiliser showFormatChoiceDialog avec les 3 options
        window.MM.showFormatChoiceDialog('exportButton', async function (format) {
          try {
            // Récupérer toutes les sources pour trouver l'ID de la source par son titre
            const allSources = await window.MM.rpc.getNotebookSources(notebookId);
            const sourceId = findSourceIdByTitle(cleanedTitle, allSources);

            let content;
            let isTruncated = false;
            if (sourceId) {
              if (format === 'pdf-riche') {
                content = await window.MM.rpc.getSourceContentHtml(sourceId, notebookId);
                isTruncated = checkIfTruncated(content, true);
              } else {
                const isHtmlRequest = format === 'md-riche';
                content = await window.MM.rpc.getSourceContent(sourceId, notebookId, {
                  format: isHtmlRequest ? 'html' : 'text'
                });
                if (format === 'md-riche') {
                  isTruncated = checkIfTruncated(content, false);
                }
              }
            } else {
              console.warn('[MM] Source ID non trouvé par titre pour', cleanedTitle, '- repli DOM');
              const domData = findIndividualSourceData();
              if (!domData) return;
              content = domData.content;
            }

            const baseName = stripSourceExtension(cleanedTitle);
            const safeTitle = baseName.replace(/[\/\\?%*:|"<>\s]/g, '_');
            const timestamp = getFormattedTimestamp();

            if (format === 'md-riche' || format === 'md-simple') {
              const blob = new Blob([content], { type: 'text/markdown;charset=utf-8;' });
              downloadBlob(blob, `${safeTitle}_${timestamp}.md`);
            } else {
              const isStructured = format === 'pdf-riche';
              const pdfBlob = await generatePdfBlob(content, cleanedTitle, { structured: isStructured, loadImages: true });
              downloadBlob(pdfBlob, `${safeTitle}_${timestamp}.pdf`);
            }

            if (isTruncated) {
              window.MM.showAlertDialog('truncationWarning', 'truncationWarning');
            }
          } catch (err) {
            console.error('[MM] Erreur lors de l\'export individuel :', err);
            window.MM.showAlertDialog('exportError', 'Échec de la récupération ou de la génération : ' + err.message);
          }
        });
      }
    }, [createDownloadIcon()]);


    // Insérer à gauche du bouton delete MM s'il existe, sinon devant collapse
    const deleteBtn = document.querySelector('.mm-individual-delete-btn');
    const anchorBefore = deleteBtn || collapseBtn;
    collapseBtn.parentNode.insertBefore(exportBtn, anchorBefore);
    console.log('[MM] Bouton exportation individuelle injecté dans section.source-panel .panel-header');
  }

  function updateBatchExportButtonState() {
    const checked = window.MM.getCheckedSourceCheckboxes();
    const count = checked.length;
    
    // Ancre prioritaire : le panel-header du panneau des sources de NotebookLM (desktop)
    const sourcePanel = document.querySelector('section.source-panel, .source-panel, [class*="source-panel"]');
    const panelHeader = sourcePanel ? sourcePanel.querySelector('.panel-header, [class*="header"]') : null;

    // En mode mobile, forcer l'utilisation du sticky-header même si le panel-header existe
    const isMobileLayout = typeof window.MM.detectDesktopLayout === 'function' && !window.MM.detectDesktopLayout();

    let anchor = (!isMobileLayout && panelHeader) ? panelHeader : null;
    let isHeader = !!anchor;
    let isMobileSticky = false;

    if (!anchor) {
      // Utiliser l'en-tête collant mobile
      const stickyHeader = window.MM.getOrCreateStickyHeader();
      if (stickyHeader) {
        anchor = stickyHeader.querySelector('.mm-sticky-header-actions');
        isMobileSticky = true;
        isHeader = true;
      }
    }

    if (!anchor) {
      anchor = document.querySelector('.mm-search-bar') || window.MM.findSelectAllRow();
      isHeader = false;
      console.debug('[MM] updateBatchExportButtonState : pas de panel-header trouvé, utilisation fallback :', anchor ? anchor.tagName : 'non trouvé');
    }

    if (!anchor) {
      console.warn('[MM] updateBatchExportButtonState : aucune ancre trouvée pour injecter le bouton d\'export par lot.');
      return;
    }

    // Verrou d'idempotence : si le compte n'a pas changé ET le bouton est déjà
    // dans la bonne ancre (ou absent si count=0), ne rien faire du tout.
    // Évite toute mutation DOM redondante et interrompt proprement la boucle réactive.
    if (count === lastBatchExportCount) {
      const buttonIsCorrect = count === 0
        ? !batchExportButton
        : (batchExportButton && anchor.contains(batchExportButton));
      if (buttonIsCorrect) return;
    }
    lastBatchExportCount = count;

    // Log uniquement après le verrou — ne loguer que les changements réels
    console.debug(`[MM] updateBatchExportButtonState : ${count} source(s) cochée(s) détectée(s).`);

    if (count > 0) {
      if (!batchExportButton || !anchor.contains(batchExportButton)) {
        if (batchExportButton) batchExportButton.remove();

        console.debug('[MM] updateBatchExportButtonState : création du bouton d\'export par lot.');

        batchExportButton = createElement('button', {
          className: isHeader ? 'mm-batch-export-btn mm-btn-icon' : 'mm-batch-export-btn mm-btn-row',
          title: `${t('exportButton')} (${count})`,
          'aria-label': `${t('exportButton')} (${count})`,
          onClick: triggerBatchExport
        }, [
          createDownloadIcon(),
          createElement('span', {
            className: 'mm-badge-count',
            textContent: `(${count})`
          })
        ]);


        if (isHeader && !isMobileSticky) {
          const collapseBtn = window.MM.getNativeCollapseBtn(anchor);
          if (collapseBtn) {
            collapseBtn.parentNode.insertBefore(batchExportButton, collapseBtn);
          } else {
            anchor.appendChild(batchExportButton);
          }
        } else {
          anchor.appendChild(batchExportButton);
        }
      } else {
        const span = batchExportButton.querySelector('span');
        if (span) span.textContent = `(${count})`;
        batchExportButton.title = `${t('exportButton')} (${count})`;
        batchExportButton.setAttribute('aria-label', `${t('exportButton')} (${count})`);
      }
    } else {
      if (batchExportButton) {
        console.debug('[MM] updateBatchExportButtonState : retrait du bouton d\'export par lot (0 source cochée).');
        batchExportButton.remove();
        batchExportButton = null;
      }
    }
  }

  function initExport() {
    checkAndInjectIndividualExport();
    updateBatchExportButtonState();
    console.log('[MM] Module export initialisé');
  }

  function cleanupExport() {
    if (batchExportButton) {
      batchExportButton.remove();
      batchExportButton = null;
    }
    lastBatchExportCount = -1;
    document.querySelectorAll('.mm-individual-export-btn').forEach(
      function (b) { b.remove(); }
    );
    console.log('[MM] Module export nettoyé');
  }

  window.MM.initExport = initExport;
  window.MM.cleanupExport = cleanupExport;
  window.MM.updateBatchExportButtonState = updateBatchExportButtonState;
  window.MM.checkAndInjectIndividualExport = checkAndInjectIndividualExport;
})();
