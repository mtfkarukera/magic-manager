// merge.js — Module de fusion intelligente de plusieurs sources (F2)
// Auteur : MTF Karukera | Licence : MPL-2.0
// Dépendances : window.MM (utils.js, rpcclient.js chargés avant)

'use strict';

(function () {
  const { t, createElement } = window.MM;

  let batchMergeButton = null;

  /** Dernier nombre de sources cochées connu — sert de verrou d'idempotence */
  let lastBatchMergeCount = -1;




  // ═══════════════════════════════════════════════════════════════════════
  // Fonctions DOM centralisées — fournies par source-helpers.js (window.MM.*)
  //   findSourcesListContainer, findSelectAllRow, getCheckedSourceCheckboxes,
  //   findSourceContainerByTitle, findSourceCardFromCheckbox
  // Identifiant notebook — fourni par utils.js (window.MM.getActiveNotebookId)
  // ═══════════════════════════════════════════════════════════════════════

  function findIndividualSourceData() {
    const sourceViewer = document.querySelector('source-viewer');
    if (!sourceViewer) return null;

    const titleEl = sourceViewer.querySelector('.source-title');
    if (!titleEl) return null;
    const title = titleEl.textContent.trim();

    const clone = sourceViewer.cloneNode(true);
    const guide = clone.querySelector('button');
    if (guide) guide.remove();
    
    const ourBtns = clone.querySelectorAll('.mm-delete-btn, .mm-individual-export-btn, .mm-individual-delete-btn');
    ourBtns.forEach(b => b.remove());

    const textElements = Array.from(clone.querySelectorAll('p, li, [class*="paragraph"], [class*="text-segment"]'));
    let content = '';
    if (textElements.length > 0) {
      content = textElements.map(el => el.textContent.trim()).filter(t => t.length > 0).join('\n\n');
    }
    return { title: title, content: content };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Gestionnaires asynchrones pour l'extraction DOM
  // ═══════════════════════════════════════════════════════════════════════

  async function waitForSourceViewer(timeout = 3500) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const viewer = document.querySelector('source-viewer');
      if (viewer) {
        const paragraph = viewer.querySelector('p, li, [class*="paragraph"], [class*="text-segment"]');
        if (paragraph) {
          return viewer;
        }
      }
      await new Promise(r => setTimeout(r, 50));
    }
    return null;
  }

  /**
   * Attend que le titre du source-viewer change par rapport à previousTitle.
   * Indispensable pour la fusion : sans cela, le viewer de la source précédente
   * est encore présent quand on clique sur la suivante, et on extrait le mauvais contenu.
   *
   * @param {string} previousTitle - Titre affiché avant le clic.
   * @param {number} timeoutMs - Délai maximum en ms.
   * @returns {Promise<Element|null>} Le viewer chargé ou null si timeout.
   */
  async function waitForViewerToChange(previousTitle, timeoutMs = 4000) {
    // Délai minimum incompressible : Angular/NotebookLM a besoin d'au moins ~300ms
    // pour monter le nouveau composant dans le DOM après un clic sur stretchedBtn.
    await new Promise(r => setTimeout(r, 400));

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const viewer = document.querySelector('source-viewer');
      if (viewer) {
        // Chercher le titre avec plusieurs sthégies (le sélecteur exact varie selon la version NLM)
        const titleEl = viewer.querySelector(
          '.source-title, [class*="source-title"], .title, [class*="viewer-title"]'
        );
        const currentTitle = titleEl ? titleEl.textContent.trim() : '';

        // La source est bien chargée si :
        // 1. Le titre a changé par rapport à l'itération précédente
        // 2. Il y a du contenu textuel affiché
        if (currentTitle && currentTitle !== previousTitle) {
          const hasContent = viewer.querySelector('p, li, [class*="paragraph"], [class*="text-segment"], [class*="content"]');
          if (hasContent) {
            console.log(`[MM] Viewer chargé : "${currentTitle.slice(0, 50)}" (attendu != "${previousTitle.slice(0, 30)}")`);
            return viewer;
          }
        }
      }
      await new Promise(r => setTimeout(r, 100));
    }
    console.warn(`[MM] waitForViewerToChange : timeout après ${timeoutMs + 400}ms (previousTitle="${previousTitle.slice(0, 40)}")`);
    return null;
  }

  function closeSourceViewer() {
    const sourcePanel = document.querySelector('section.source-panel');
    if (!sourcePanel) return;
    const panelHeader = sourcePanel.querySelector('.panel-header');
    if (!panelHeader) return;
    const nativeButtons = Array.from(panelHeader.querySelectorAll(
      'button:not(.mm-individual-delete-btn):not(.mm-individual-export-btn)'
    ));
    if (nativeButtons.length > 0) {
      const collapseBtn = nativeButtons[nativeButtons.length - 1];
      if (collapseBtn) collapseBtn.click();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Générateur PDF avec jsPDF (similaire à export.js)
  // ═══════════════════════════════════════════════════════════════════════

  function generatePDFBlob(filename, content) {
    const jspdfLib = window.jspdf
      || (typeof globalThis !== 'undefined' && globalThis.jspdf)
      || (typeof self !== 'undefined' && self.jspdf);

    if (!jspdfLib || !jspdfLib.jsPDF) {
      throw new Error('[MM] Bibliothèque jsPDF non disponible dans le contexte.');
    }

    const { jsPDF } = jspdfLib;
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const margin = 20;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const maxLineWidth = pageWidth - (margin * 2);

    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(16);
    const titleLines = doc.splitTextToSize(filename || 'Document Fusionné', maxLineWidth);
    let y = 25;

    titleLines.forEach(line => {
      if (y > pageHeight - margin) { doc.addPage(); y = 20; }
      doc.text(line, margin, y);
      y += 8;
    });

    y += 4;

    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(11);

    const paragraphs = content.split('\n\n');
    paragraphs.forEach(p => {
      const pText = p.replace(/\s+/g, ' ').trim();
      if (!pText) return;
      const lines = doc.splitTextToSize(pText, maxLineWidth);
      lines.forEach(line => {
        if (y > pageHeight - margin) { doc.addPage(); y = 20; }
        doc.text(line, margin, y);
        y += 6;
      });
      y += 4;
    });

    return doc.output('blob');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Interface utilisateur & modale de fusion
  // ═══════════════════════════════════════════════════════════════════════

  function showMergeDialog(checkboxes) {
    const dateStr = new Date().toISOString().split('T')[0];
    const defaultTitle = `${t('mergedSourcesTitle') || 'Sources fusionnées'} - ${dateStr}`;

    const dialogTitleId = 'mm-merge-title-' + Date.now();
    const dialog = createElement('dialog', {
      className: 'mm-merge-dialog mm-dialog',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': dialogTitleId
    });

    // Centralisation de la suppression du DOM à la fermeture native
    dialog.addEventListener('close', () => {
      dialog.remove();
    });
    
    const titleEl = createElement('div', { 
      id: dialogTitleId,
      className: 'mm-merge-title', 
      textContent: t('mergeButton') || 'Fusionner les sources' 
    });
    
    const titleField = createElement('div', { className: 'mm-merge-field' }, [
      createElement('label', { 
        className: 'mm-merge-label', 
        textContent: t('mergedTitleLabel') || 'Titre de la nouvelle source' 
      }),
      createElement('input', {
        type: 'text',
        className: 'mm-merge-input',
        value: defaultTitle,
        placeholder: 'Saisissez le titre...'
      })
    ]);

    let selectedFormat = 'Markdown';
    const formatLabel = createElement('label', { 
      className: 'mm-merge-label', 
      textContent: 'Format du document final' 
    });
    
    const mdBtn = createElement('button', {
      className: 'mm-merge-format-btn active',
      textContent: 'Markdown',
      onClick: () => {
        selectedFormat = 'Markdown';
        mdBtn.classList.add('active');
        pdfBtn.classList.remove('active');
      }
    });
    const pdfBtn = createElement('button', {
      className: 'mm-merge-format-btn',
      textContent: 'PDF (jsPDF)',
      onClick: () => {
        selectedFormat = 'PDF';
        pdfBtn.classList.add('active');
        mdBtn.classList.remove('active');
      }
    });


    const formatField = createElement('div', { className: 'mm-merge-field' }, [
      formatLabel,
      createElement('div', { className: 'mm-merge-formats' }, [mdBtn, pdfBtn])
    ]);

    const btnCancel = createElement('button', {
      className: 'mm-merge-btn-cancel',
      textContent: 'Annuler',
      onClick: () => {
        dialog.close();
      }
    });
    const btnConfirm = createElement('button', {
      className: 'mm-merge-btn-confirm',
      textContent: 'Fusionner',
      onClick: async () => {
        const titleInput = titleField.querySelector('input');
        const finalTitle = titleInput.value.trim() || defaultTitle;
        await runMergeProcess(checkboxes, finalTitle, selectedFormat, dialog);
      }
    });

    const buttonsContainer = createElement('div', { className: 'mm-merge-buttons' }, [
      btnCancel,
      btnConfirm
    ]);

    dialog.appendChild(titleEl);
    dialog.appendChild(titleField);
    dialog.appendChild(formatField);
    dialog.appendChild(buttonsContainer);
    
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) {
        dialog.close();
        dialog.remove();
      }
    });

    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      dialog.close();
      dialog.remove();
    });

    document.body.appendChild(dialog);
    dialog.showModal();

    setTimeout(() => titleField.querySelector('input').select(), 50);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Processus de Fusion synchrone via DOM + RPC
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Nettoie le titre brut récupéré d'une source pour éliminer les préfixes de l'aria-label.
   */
  function cleanSourceTitle(rawTitle) {
    if (!rawTitle) return '';
    let title = rawTitle.trim();
    const prefixes = [
      /^(Ouvrir la source|Ouvrir|Ouvrir le document)\s+/i,
      /^(Open source|Open|Open document)\s+/i,
      /^(Abrir la fuente|Abrir)\s+/i,
      /^(Quelle öffnen|Öffnen)\s+/i
    ];
    for (const regex of prefixes) {
      title = title.replace(regex, '');
    }
    return title.trim();
  }

  /**
   * Trouve l'identifiant de source correspondant au titre par matching dans la liste RPC.
   */
  function findSourceIdByTitle(cleanedTitle, allSources) {
    if (!cleanedTitle || !allSources) return null;
    const titleLower = cleanedTitle.toLowerCase();
    
    // Essai 1 : match exact
    let match = allSources.find(s => s.title && s.title.toLowerCase() === titleLower);
    if (match) return match.id;
    
    // Essai 2 : match de sous-chaîne ou d'inclusion
    match = allSources.find(s => s.title && (titleLower.includes(s.title.toLowerCase()) || s.title.toLowerCase().includes(titleLower)));
    if (match) return match.id;
    
    return null;
  }

  async function runMergeProcess(checkboxes, title, format, dialog) {
    const notebookId = window.MM.getActiveNotebookId();
    if (!notebookId) {
      window.MM.showAlertDialog('mergeError', 'notebookIdNotFound');
      dialog.close();
      return;
    }

    let isCancelled = false;
    dialog.addEventListener('close', () => {
      isCancelled = true;
    });

    dialog.replaceChildren();
    const progressContainer = createElement('div', { className: 'mm-merge-progress-container' }, [
      createElement('div', { className: 'mm-merge-spinner' }),
      createElement('div', {
        id: 'mm-merge-status',
        style: 'font-weight: 500; font-family: var(--mm-font-family); margin-bottom: 8px;',
        textContent: 'Initialisation...'
      }),

      createElement('div', {
        id: 'mm-merge-substatus',
        style: 'font-size: 12px; color: #aaa; font-family: var(--mm-font-family);',
        textContent: `0 / ${checkboxes.length} sources traitées`
      })
    ]);
    dialog.appendChild(progressContainer);

    const statusEl = progressContainer.querySelector('#mm-merge-status');
    const substatusEl = progressContainer.querySelector('#mm-merge-substatus');

    let mergedContent = '';

    try {
      // Récupérer toutes les sources du carnet via RPC pour le fallback de matching
      let allSources = [];
      try {
        allSources = await window.MM.rpc.getNotebookSources(notebookId);
      } catch (e) {
        console.warn('[MM] Impossible de lister les sources du notebook via RPC.', e);
      }

      for (let i = 0; i < checkboxes.length; i++) {
        if (isCancelled) {
          console.log('[MM] Processus de fusion annulé par la fermeture de la modale.');
          return;
        }
        const cb = checkboxes[i];

        // Remonter depuis la checkbox vers la carte source parente
        const sourceInfo = window.MM.findSourceCardFromCheckbox(cb);
        if (!sourceInfo) {
          console.warn(`[MM] Fusion : impossible de remonter au conteneur pour la checkbox ${i}`);
          continue;
        }

        const sourceTitle = cleanSourceTitle(sourceInfo.title);
        statusEl.textContent = `Extraction de : ${sourceTitle.slice(0, 60)}`;
        substatusEl.textContent = `${i} / ${checkboxes.length} sources traitées`;

        console.log(`[MM] Fusion : traitement de "${sourceTitle.slice(0, 50)}" (${i+1}/${checkboxes.length})`);

        // 1. Extraire l'ID de la source (DOM puis RPC fallback)
        let sourceId = window.MM.extractSourceId(sourceInfo.card);
        if (!sourceId && allSources.length > 0) {
          sourceId = findSourceIdByTitle(sourceTitle, allSources);
        }

        if (!sourceId) {
          console.error(`[MM] Impossible de trouver l'identifiant de la source pour "${sourceTitle}"`);
          continue;
        }

        // 2. Récupérer le contenu brut via RPC
        try {
          const content = await window.MM.rpc.getSourceContent(sourceId, notebookId);
          if (isCancelled) return; // double check après l'appel réseau
          if (content) {
            mergedContent += `# ${sourceTitle}\n\n${content}\n\n---\n\n`;
          } else {
            console.warn(`[MM] Contenu vide reçu pour "${sourceTitle}"`);
          }
        } catch (err) {
          console.error(`[MM] Échec de la récupération du contenu pour "${sourceTitle}" :`, err);
        }

        // Espacement temporel de sécurité pour éviter le rate limiting (429)
        if (i < checkboxes.length - 1) {
          await new Promise(r => setTimeout(r, 200));
        }
      }

      if (isCancelled) return;

      if (!mergedContent) {
        throw new Error('Aucun contenu textuel n\'a pu être extrait des sources sélectionnées.');
      }

      statusEl.textContent = 'Création du document fusionné...';
      substatusEl.textContent = 'Envoi vers NotebookLM via RPC';

      if (format === 'Markdown') {
        await window.MM.rpc.addTextSource(notebookId, title, mergedContent);
      } else {
        const pdfBlob = generatePDFBlob(title, mergedContent);
        await window.MM.rpc.uploadBlob(notebookId, pdfBlob, `${title}.pdf`);
      }

      if (isCancelled) return;

      // Cacher le spinner
      const spinner = dialog.querySelector('.mm-merge-spinner');
      if (spinner) spinner.style.display = 'none';


      statusEl.textContent = 'Fusion terminée !';
      statusEl.style.color = '#34A853';
      substatusEl.textContent = 'La nouvelle source a été ajoutée. Elle va apparaître dans votre carnet sous peu.';
      
      const btnClose = createElement('button', {
        className: 'mm-merge-btn-confirm',
        style: 'margin-top: 16px; background-color: #34A853;',
        textContent: 'Fermer',
        onClick: () => {
          dialog.close();
        }
      });
      progressContainer.appendChild(btnClose);

    } catch (err) {
      console.error('[MM] Erreur lors de la fusion :', err);
      // Cacher le spinner en cas d'erreur
      const spinner = dialog.querySelector('.mm-merge-spinner');
      if (spinner) spinner.style.display = 'none';

      statusEl.textContent = 'Une erreur est survenue';
      statusEl.style.color = '#EA4335';
      substatusEl.textContent = err.message || err;
      
      const btnClose = createElement('button', {
        className: 'mm-merge-btn-cancel',
        style: 'margin-top: 16px;',
        textContent: 'Fermer',
        onClick: () => {
          dialog.close();
        }
      });
      progressContainer.appendChild(btnClose);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Bouton de fusion et cycle de vie
  // ═══════════════════════════════════════════════════════════════════════

  function createMergeIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.display = 'block';
    svg.style.pointerEvents = 'none';

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M9 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h4v-2H5V5h4V3zm10 0h-4v2h4v14h-4v2h4c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-6 4h-2v4H7v2h4v4h2v-4h4v-2h-4V7z');

    svg.appendChild(path);
    return svg;
  }

  function updateBatchMergeButtonState() {
    const list = window.MM.findSourcesListContainer();
    if (!list) {
      console.debug('[MM] updateBatchMergeButtonState : aucun conteneur de sources trouvé.');
      return;
    }

    const checked = window.MM.getCheckedSourceCheckboxes();
    const count = checked.length;
    
    // Ancre prioritaire : le panel-header du panneau des sources de NotebookLM
    const sourcePanel = document.querySelector('section.source-panel, .source-panel, [class*="source-panel"]');
    const panelHeader = sourcePanel ? sourcePanel.querySelector('.panel-header, [class*="header"]') : null;

    let anchor = panelHeader;
    let isHeader = true;
    let isMobileSticky = false;

    if (!anchor) {
      // Tenter d'utiliser l'en-tête collant mobile
      const stickyHeader = window.MM.getOrCreateStickyHeader();
      if (stickyHeader) {
        anchor = stickyHeader.querySelector('.mm-sticky-header-actions');
        isMobileSticky = true;
      }
    }

    if (!anchor) {
      anchor = document.querySelector('.mm-search-bar') || window.MM.findSelectAllRow();
      isHeader = false;
      console.debug('[MM] updateBatchMergeButtonState : pas de panel-header trouvé, utilisation fallback :', anchor ? anchor.tagName : 'non trouvé');
    }

    if (!anchor) {
      console.warn('[MM] updateBatchMergeButtonState : aucune ancre trouvée pour injecter le bouton de fusion.');
      return;
    }

    // Verrou d'idempotence : si le compte n'a pas changé ET le bouton est déjà
    // dans la bonne ancre (ou absent si count < 2), ne rien faire du tout.
    if (count === lastBatchMergeCount) {
      const buttonIsCorrect = count < 2
        ? !batchMergeButton
        : (batchMergeButton && anchor.contains(batchMergeButton));
      if (buttonIsCorrect) return;
    }
    lastBatchMergeCount = count;

    // Log uniquement après le verrou — ne loguer que les changements réels
    console.debug(`[MM] updateBatchMergeButtonState : ${count} source(s) cochée(s) détectée(s).`);

    if (count >= 2) {
      if (!batchMergeButton || !anchor.contains(batchMergeButton)) {
        if (batchMergeButton) batchMergeButton.remove();

        console.debug('[MM] updateBatchMergeButtonState : création du bouton de fusion.');
        batchMergeButton = createElement('button', {
          className: isHeader ? 'mm-batch-merge-btn mm-btn-icon' : 'mm-batch-merge-btn mm-btn-row',
          title: `${t('mergeButton') || 'Fusionner'} (${count})`,
          'aria-label': `${t('mergeButton') || 'Fusionner'} (${count})`,
          onClick: () => showMergeDialog(checked)
        }, [
          createMergeIcon(),
          createElement('span', {
            className: 'mm-badge-count',
            textContent: `(${count})`
          })
        ]);


        if (isHeader) {
          if (isMobileSticky) {
            anchor.appendChild(batchMergeButton);
          } else {
            // Trouver le bouton collapse natif (dernier bouton natif du header)
            const nativeButtons = Array.from(anchor.querySelectorAll(
              'button:not(.mm-batch-merge-btn):not(.mm-batch-export-btn):not(.mm-individual-delete-btn):not(.mm-individual-export-btn)'
            ));
            const collapseBtn = nativeButtons[nativeButtons.length - 1];
            if (collapseBtn) {
              collapseBtn.parentNode.insertBefore(batchMergeButton, collapseBtn);
            } else {
              anchor.appendChild(batchMergeButton);
            }
          }
        } else {
          const exportBtn = anchor.querySelector('.mm-batch-export-btn');
          if (exportBtn) {
            exportBtn.parentNode.insertBefore(batchMergeButton, exportBtn.nextSibling);
          } else {
            anchor.appendChild(batchMergeButton);
          }
        }
      } else {
        const span = batchMergeButton.querySelector('span');
        if (span) span.textContent = `(${count})`;
        batchMergeButton.title = `${t('mergeButton') || 'Fusionner'} (${count})`;
        batchMergeButton.setAttribute('aria-label', `${t('mergeButton') || 'Fusionner'} (${count})`);
      }
    } else {
      if (batchMergeButton) {
        console.debug('[MM] updateBatchMergeButtonState : retrait du bouton de fusion (moins de 2 sources cochées).');
        batchMergeButton.remove();
        batchMergeButton = null;
      }
    }
  }

  function initMerge() {
    updateBatchMergeButtonState();
    console.log('[MM] Module merge initialisé');
  }

  function cleanupMerge() {
    if (batchMergeButton) {
      batchMergeButton.remove();
      batchMergeButton = null;
    }
    lastBatchMergeCount = -1;
    console.log('[MM] Module merge nettoyé');
  }

  window.MM.initMerge = initMerge;
  window.MM.cleanupMerge = cleanupMerge;
  window.MM.updateBatchMergeButtonState = updateBatchMergeButtonState;
})();
