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

  const {
    cleanSourceTitle,
    findSourceIdByTitle,
    getFormattedTimestamp,
    generatePdfBlob,
    checkIfTruncated
  } = window.MM.exportUtils;

  // ═══════════════════════════════════════════════════════════════════════
  // Interface utilisateur & modale de fusion
  // ═══════════════════════════════════════════════════════════════════════

  function showMergeDialog(checkboxes) {
    const timestamp = getFormattedTimestamp();
    const defaultTitle = `${t('mergedSourcesTitle') || 'Sources fusionnées'} - ${timestamp}`;

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
        htmlFor: 'mm-merge-title-input',
        textContent: t('mergedTitleLabel') || 'Titre de la nouvelle source' 
      }),
      createElement('input', {
        type: 'text',
        id: 'mm-merge-title-input',
        className: 'mm-merge-input',
        value: defaultTitle,
        placeholder: 'Saisissez le titre...'
      })
    ]);

    let selectedFormat = 'Markdown-Riche';
    const formatLabel = createElement('label', { 
      className: 'mm-merge-label', 
      textContent: 'Format du document final' 
    });
    
    function setActiveFormatBtn(activeBtn) {
      [mdRicheBtn, mdSimpleBtn, pdfRicheBtn, pdfSimpleBtn].forEach(btn => {
        const isActive = btn === activeBtn;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', String(isActive));
      });
    }

    const mdRicheBtn = createElement('button', {
      className: 'mm-merge-format-btn active',
      'aria-pressed': 'true',
      textContent: t('mergeFormatMarkdownRiche') || 'Markdown Riche',
      onClick: () => {
        selectedFormat = 'Markdown-Riche';
        setActiveFormatBtn(mdRicheBtn);
      }
    });
    const mdSimpleBtn = createElement('button', {
      className: 'mm-merge-format-btn',
      'aria-pressed': 'false',
      textContent: t('mergeFormatMarkdownSimple') || 'Markdown Simple',
      onClick: () => {
        selectedFormat = 'Markdown-Simple';
        setActiveFormatBtn(mdSimpleBtn);
      }
    });
    const pdfRicheBtn = createElement('button', {
      className: 'mm-merge-format-btn',
      'aria-pressed': 'false',
      textContent: t('mergeFormatPdfRiche') || 'PDF Riche',
      onClick: () => {
        selectedFormat = 'PDF-Riche';
        setActiveFormatBtn(pdfRicheBtn);
      }
    });
    const pdfSimpleBtn = createElement('button', {
      className: 'mm-merge-format-btn',
      'aria-pressed': 'false',
      textContent: t('mergeFormatPdfSimple') || 'PDF Simple',
      onClick: () => {
        selectedFormat = 'PDF-Simple';
        setActiveFormatBtn(pdfSimpleBtn);
      }
    });

    const formatField = createElement('div', { className: 'mm-merge-field' }, [
      formatLabel,
      createElement('div', { className: 'mm-merge-formats' }, [mdRicheBtn, mdSimpleBtn, pdfSimpleBtn, pdfRicheBtn])
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
        try {
          const titleInput = titleField.querySelector('input');
          const finalTitle = (titleInput ? titleInput.value.trim() : '') || defaultTitle;
          await runMergeProcess(checkboxes, finalTitle, selectedFormat, dialog);
        } catch (err) {
          console.error('[MM] Erreur lors de l\'exécution de la fusion :', err);
          window.MM.showAlertDialog(
            window.MM.t('mergeErrorTitle') || 'Erreur de fusion',
            window.MM.t('mergeErrorMsg') || 'Une erreur inattendue est survenue pendant la fusion. Veuillez réessayer.'
          );
        }
      }
    });

    const buttonsContainer = createElement('div', { className: 'mm-merge-buttons' }, [
      btnCancel,
      btnConfirm
    ]);

    dialog.appendChild(titleEl);
    dialog.appendChild(titleField);
    dialog.appendChild(formatField);
    
    // Bannière d'avertissement de troncature
    const warningEl = createElement('div', { 
      className: 'mm-dialog-warning', 
      textContent: t('truncationWarning') 
    });
    dialog.appendChild(warningEl);
    
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
    const progressContainer = createElement('div', { 
      className: 'mm-merge-progress-container',
      role: 'status',
      'aria-live': 'polite'
    }, [
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
    let anyTruncated = false;

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

        // 1. Extraire l'ID de la source
        let sourceId = window.MM.extractSourceId(sourceInfo.card);
        if (!sourceId && allSources.length > 0) {
          sourceId = findSourceIdByTitle(sourceTitle, allSources);
        }

        if (!sourceId) {
          console.error(`[MM] Impossible de trouver l'identifiant de la source pour "${sourceTitle}"`);
          continue;
        }

        // 2. Récupérer le contenu via RPC
        try {
          let content;
          if (format === 'PDF-Riche') {
            const html = await window.MM.rpc.getSourceContentHtml(sourceId, notebookId);
            if (isCancelled) return;
            if (checkIfTruncated(html, true)) {
              anyTruncated = true;
            }
            if (html) {
              content = `<h1>${sourceTitle}</h1>` + html + `<hr>`;
            } else {
              // Fallback au texte brut enveloppé dans du HTML si HTML absent
              const txt = await window.MM.rpc.getSourceContent(sourceId, notebookId, { format: 'text' });
              const wrappedTxt = (txt || '').replace(/\n/g, '<br>');
              content = `<h1>${sourceTitle}</h1><p>${wrappedTxt}</p><hr>`;
            }
          } else if (format === 'PDF-Simple') {
            const txt = await window.MM.rpc.getSourceContent(sourceId, notebookId, { format: 'text' });
            if (isCancelled) return;
            if (txt) {
              const wrappedTxt = (txt || '').replace(/\n/g, '<br>');
              content = `<h1>${sourceTitle}</h1><p>${wrappedTxt}</p><hr>`;
            }
          } else {
            // Markdown-Riche ou Markdown-Simple
            const isRiche = format === 'Markdown-Riche';
            const txt = await window.MM.rpc.getSourceContent(sourceId, notebookId, {
              format: isRiche ? 'html' : 'text'
            });
            if (isCancelled) return;
            if (isRiche && checkIfTruncated(txt, false)) {
              anyTruncated = true;
            }
            if (txt) {
              content = `# ${sourceTitle}\n\n${txt}\n\n---\n\n`;
            }
          }

          if (content) {
            mergedContent += content;
          } else {
            console.warn(`[MM] Contenu vide reçu pour "${sourceTitle}"`);
          }
        } catch (err) {
          console.error(`[MM] Échec de la récupération du contenu pour "${sourceTitle}" :`, err);
        }

        // Espacement de sécurité anti-rate-limit (400ms)
        if (i < checkboxes.length - 1) {
          await new Promise(r => setTimeout(r, 400));
        }
      }

      if (isCancelled) return;

      if (!mergedContent) {
        throw new Error('Aucun contenu n\'a pu être extrait des sources sélectionnées.');
      }

      statusEl.textContent = 'Création du document fusionné...';
      substatusEl.textContent = 'Envoi vers NotebookLM via RPC';

      if (format === 'Markdown-Riche' || format === 'Markdown-Simple') {
        await window.MM.rpc.addTextSource(notebookId, title, mergedContent);
      } else if (format === 'PDF-Simple') {
        const pdfBlob = await generatePdfBlob(mergedContent, title, { structured: false });
        await window.MM.rpc.uploadBlob(notebookId, pdfBlob, `${title}.pdf`);
      } else if (format === 'PDF-Riche') {
        const pdfBlob = await generatePdfBlob(mergedContent, title, { structured: true, loadImages: true });
        await window.MM.rpc.uploadBlob(notebookId, pdfBlob, `${title}.pdf`);
      }

      if (isCancelled) return;

      // Cacher le spinner
      const spinner = dialog.querySelector('.mm-merge-spinner');
      if (spinner) spinner.style.display = 'none';

      statusEl.textContent = 'Fusion terminée !';
      statusEl.style.color = '#34A853';
      
      if (anyTruncated) {
        substatusEl.replaceChildren(
          document.createTextNode('La nouvelle source a été ajoutée. '),
          document.createElement('br'),
          createElement('strong', {
            style: 'color: #f59e0b;',
            textContent: 'Attention : au moins un document a été tronqué par Google en mode Riche. Si des données manquent, recréez la fusion en mode Simple.'
          })
        );
      } else {
        substatusEl.textContent = 'La nouvelle source a été ajoutée. Elle va apparaître dans votre carnet sous peu.';
      }
      
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


        if (isHeader && !isMobileSticky) {
          const exportBtn = anchor.querySelector('.mm-batch-export-btn');
          const collapseBtn = window.MM.getNativeCollapseBtn(anchor);
          const targetBefore = exportBtn || collapseBtn;
          if (targetBefore) {
            targetBefore.parentNode.insertBefore(batchMergeButton, targetBefore);
          } else {
            anchor.appendChild(batchMergeButton);
          }
        } else {
          anchor.appendChild(batchMergeButton);
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
