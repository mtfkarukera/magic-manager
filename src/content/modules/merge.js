// merge.js — Module de fusion intelligente de plusieurs sources (F2)
// Auteur : MTF Karukera | Licence : MPL-2.0
// Dépendances : window.MM (utils.js, rpcclient.js chargés avant)

'use strict';

(function () {
  const { t, createElement } = window.MM;

  let selectionObserver = null;
  let batchMergeButton = null;

  // ═══════════════════════════════════════════════════════════════════════
  // Sélecteurs DOM robustes (synchro avec export.js)
  // ═══════════════════════════════════════════════════════════════════════

  function findSourcesListContainer() {
    return document.querySelector('section.source-panel, .source-panel, .sources-panel, [class*="source-panel"], [class*="sources-panel"], [class*="source-list"]');
  }

  function findSelectAllRow() {
    const list = findSourcesListContainer();
    if (!list) return null;
    
    const divs = window.MM.findElementsInShadows('div, span, button', list);
    for (let el of divs) {
      const txt = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
      if (txt.includes('tout sélectionner') || txt.includes('select all') || txt.includes('seleccionar todo') || txt.includes('alle auswählen')) {
        let row = el.parentNode;
        while (row && row !== list && row.tagName !== 'DIV') {
          row = row.parentNode;
        }
        return row;
      }
    }
    return null;
  }

  function getCheckedSourceCheckboxes() {
    const list = findSourcesListContainer();
    if (!list) return [];
    
    // 1. Trouver toutes les cartes/lignes de sources physiques
    const sourceCards = window.MM.findElementsInShadows(
      'div[class*="source-card"], div[class*="source-item"], div[class*="sourceItem"], [class*="source-row"], [data-source-id]',
      list
    );
    
    const checkedCheckboxes = [];
    const seenTitles = new Set();
    
    // 2. Pour chaque carte, trouver la checkbox à l'intérieur
    sourceCards.forEach(card => {
      // Trouver les checkboxes candidates sous cette carte uniquement
      const cbs = window.MM.findElementsInShadows(
        'input[type="checkbox"], [role="checkbox"], mat-pseudo-checkbox, .mat-pseudo-checkbox',
        card
      );
      
      if (cbs.length > 0) {
        // On prend le premier élément interactif de checkbox dans la carte
        const cb = cbs[0];
        
        const isChecked = 
          cb.getAttribute('aria-checked') === 'true' || 
          cb.checked === true || 
          cb.classList.contains('mat-pseudo-checkbox-checked') || 
          cb.getAttribute('state') === 'checked' ||
          (typeof cb.className === 'string' && cb.className.includes('checked')) ||
          cb.getAttribute('aria-selected') === 'true';

        if (isChecked) {
          // Extraire le titre de la source depuis cette carte
          const titleEl = card.querySelector('[class*="title"], [class*="name"], button.source-stretched-button');
          let titleText = '';
          if (titleEl) {
            titleText = (titleEl.getAttribute('aria-label') || titleEl.textContent || '').trim();
          }
          
          if (titleText && !seenTitles.has(titleText)) {
            seenTitles.add(titleText);
            // Associer le titre comme aria-label pour que les fonctions de recherche par titre le trouvent
            cb.setAttribute('aria-label', titleText);
            checkedCheckboxes.push(cb);
          }
        }
      }
    });
    
    return checkedCheckboxes;
  }

  function findSourceContainerByTitle(sourceTitle) {
    const list = findSourcesListContainer();
    if (!list) return null;
    const containers = window.MM.findElementsInShadows('.source-card, [class*="source-card"], [class*="source-item"]', list);
    for (let ctr of containers) {
      const stretchedBtn = window.MM.findElementsInShadows('button.source-stretched-button', ctr)[0];
      if (stretchedBtn) {
        const label = stretchedBtn.getAttribute('aria-label') || '';
        if (label.includes(sourceTitle) || sourceTitle.includes(label)) {
          return ctr;
        }
      }
    }
    return null;
  }

  function getActiveNotebookId() {
    const m = window.location.pathname.match(/\/notebook\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : null;
  }

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

    const overlay = createElement('div', { className: 'mm-merge-overlay' });
    const dialog = createElement('div', { className: 'mm-merge-dialog' });
    
    const titleEl = createElement('div', { 
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
      textContent: 'Markdown (.txt)'
    });
    const pdfBtn = createElement('button', {
      className: 'mm-merge-format-btn',
      textContent: 'PDF (.pdf)'
    });

    mdBtn.onclick = () => {
      mdBtn.classList.add('active');
      pdfBtn.classList.remove('active');
      selectedFormat = 'Markdown';
    };
    pdfBtn.onclick = () => {
      pdfBtn.classList.add('active');
      mdBtn.classList.remove('active');
      selectedFormat = 'PDF';
    };

    const formatField = createElement('div', { className: 'mm-merge-field' }, [
      formatLabel,
      createElement('div', { className: 'mm-merge-formats' }, [mdBtn, pdfBtn])
    ]);

    const btnCancel = createElement('button', {
      className: 'mm-merge-btn-cancel',
      textContent: 'Annuler',
      onClick: () => overlay.remove()
    });
    const btnConfirm = createElement('button', {
      className: 'mm-merge-btn-confirm',
      textContent: 'Fusionner',
      onClick: async () => {
        const titleInput = titleField.querySelector('input');
        const finalTitle = titleInput.value.trim() || defaultTitle;
        await runMergeProcess(checkboxes, finalTitle, selectedFormat, dialog, overlay);
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
    
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    setTimeout(() => titleField.querySelector('input').select(), 50);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Processus de Fusion synchrone via DOM + RPC
  // ═══════════════════════════════════════════════════════════════════════

  async function runMergeProcess(checkboxes, title, format, dialog, overlay) {
    const notebookId = getActiveNotebookId();
    if (!notebookId) {
      alert('[MM] Impossible de détecter l\'identifiant du notebook dans l\'URL.');
      overlay.remove();
      return;
    }

    dialog.innerHTML = '';
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
      for (let i = 0; i < checkboxes.length; i++) {
        const cb = checkboxes[i];
        const sourceTitle = cb.getAttribute('aria-label') || `Source_${i + 1}`;
        statusEl.textContent = `Extraction de : ${sourceTitle}`;
        substatusEl.textContent = `${i} / ${checkboxes.length} sources traitées`;

        const container = findSourceContainerByTitle(sourceTitle);
        if (container) {
          const stretchedBtn = container.querySelector('button.source-stretched-button');
          if (stretchedBtn) {
            stretchedBtn.click();
            
            const viewer = await waitForSourceViewer(3500);
            if (viewer) {
              const data = findIndividualSourceData();
              if (data && data.content) {
                mergedContent += `# ${data.title}\n\n${data.content}\n\n---\n\n`;
              }
            } else {
              console.warn(`[MM] Impossible de charger le contenu de la source : ${sourceTitle}`);
            }
          }
        }
      }

      closeSourceViewer();

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

      statusEl.textContent = 'Fusion terminée !';
      statusEl.style.color = '#34A853';
      substatusEl.textContent = 'La nouvelle source a été ajoutée à votre carnet.';
      
      const btnClose = createElement('button', {
        className: 'mm-merge-btn-confirm',
        style: 'margin-top: 16px; background-color: #34A853;',
        textContent: 'Fermer',
        onClick: () => overlay.remove()
      });
      progressContainer.appendChild(btnClose);

    } catch (err) {
      console.error('[MM] Erreur lors de la fusion :', err);
      statusEl.textContent = 'Une erreur est survenue';
      statusEl.style.color = '#EA4335';
      substatusEl.textContent = err.message || err;
      
      const btnClose = createElement('button', {
        className: 'mm-merge-btn-cancel',
        style: 'margin-top: 16px;',
        textContent: 'Fermer',
        onClick: () => overlay.remove()
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
    svg.style.display = 'block';
    svg.style.pointerEvents = 'none';

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M9 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h4v-2H5V5h4V3zm10 0h-4v2h4v14h-4v2h4c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-6 4h-2v4H7v2h4v4h2v-4h4v-2h-4V7z');

    svg.appendChild(path);
    return svg;
  }

  function updateBatchMergeButtonState() {
    const list = findSourcesListContainer();
    if (!list) {
      console.log('[MM] updateBatchMergeButtonState : aucun conteneur de sources trouvé.');
      return;
    }

    // Diagnostic : lister TOUTES les checkboxes trouvées et leur état
    const allCheckboxes = window.MM.findElementsInShadows(
      'input[type="checkbox"], [role="checkbox"], mat-pseudo-checkbox, .mat-pseudo-checkbox, [class*="checkbox"]',
      list
    );
    if (allCheckboxes.length > 0 && allCheckboxes.length <= 30) {
      console.log(`[MM] updateBatchMergeButtonState : ${allCheckboxes.length} checkbox(es) trouvée(s). Diagnostic des 5 premières :`);
      allCheckboxes.slice(0, 5).forEach(function (cb, idx) {
        console.log(`  → [${idx}] tag=${cb.tagName} role=${cb.getAttribute('role')} aria-checked=${cb.getAttribute('aria-checked')} checked=${cb.checked} class=${typeof cb.className === 'string' ? cb.className.slice(0, 80) : 'SVG'} state=${cb.getAttribute('state')}`);
      });
    }

    const checked = getCheckedSourceCheckboxes();
    console.log(`[MM] updateBatchMergeButtonState : ${checked.length} source(s) cochée(s) détectée(s) (sur ${allCheckboxes.length} checkboxes au total).`);
    
    // Ancre prioritaire : le panel-header du panneau des sources de NotebookLM
    const sourcePanel = document.querySelector('section.source-panel, .source-panel, [class*="source-panel"]');
    const panelHeader = sourcePanel ? sourcePanel.querySelector('.panel-header, [class*="header"]') : null;
    
    let anchor = panelHeader;
    let isHeader = true;
    
    if (!anchor) {
      anchor = document.querySelector('.mm-search-bar') || findSelectAllRow();
      isHeader = false;
      console.log('[MM] updateBatchMergeButtonState : pas de panel-header trouvé, utilisation fallback :', anchor ? anchor.tagName : 'non trouvé');
    }
    
    if (!anchor) {
      console.warn('[MM] updateBatchMergeButtonState : aucune ancre trouvée pour injecter le bouton de fusion.');
      return;
    }

    if (checked.length >= 2) {
      if (!batchMergeButton || !anchor.contains(batchMergeButton)) {
        if (batchMergeButton) batchMergeButton.remove();

        console.log('[MM] updateBatchMergeButtonState : création du bouton de fusion.');
        batchMergeButton = createElement('button', {
          className: 'mm-batch-merge-btn',
          title: `${t('mergeButton') || 'Fusionner'} (${checked.length})`,
          style: isHeader
            ? 'background: transparent; border: none; color: #34A853; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; width: 32px; height: 32px; transition: background-color var(--mm-transition-fast), color var(--mm-transition-fast); margin-right: 4px; padding: 0;'
            : 'background: transparent; border: none; color: #34A853; cursor: pointer; margin-left: 8px; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--mm-radius-sm); padding: 4px; transition: color var(--mm-transition-fast);',
          onClick: () => showMergeDialog(checked)
        }, [
          createMergeIcon(),
          createElement('span', {
            style: 'font-size: 10px; font-weight: bold; margin-left: 2px; font-family: var(--mm-font-family);',
            textContent: `(${checked.length})`
          })
        ]);

        // Effets de survol si injecté dans le header
        if (isHeader) {
          batchMergeButton.addEventListener('mouseenter', function () {
            batchMergeButton.style.backgroundColor = 'rgba(52, 168, 83, 0.08)';
          });
          batchMergeButton.addEventListener('mouseleave', function () {
            batchMergeButton.style.backgroundColor = 'transparent';
          });
        }

        if (isHeader) {
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
        if (span) {
          span.textContent = `(${checked.length})`;
        }
        batchMergeButton.title = `${t('mergeButton') || 'Fusionner'} (${checked.length})`;
      }
    } else {
      if (batchMergeButton) {
        console.log('[MM] updateBatchMergeButtonState : retrait du bouton de fusion (moins de 2 sources cochées).');
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
    console.log('[MM] Module merge nettoyé');
  }

  window.MM.initMerge = initMerge;
  window.MM.cleanupMerge = cleanupMerge;
  window.MM.updateBatchMergeButtonState = updateBatchMergeButtonState;
})();
