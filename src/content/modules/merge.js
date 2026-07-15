// merge.js — Module de fusion intelligente de plusieurs sources (F2)
// Auteur : MTF Karukera | Licence : MPL-2.0
// Dépendances : window.MM (utils.js, rpcclient.js chargés avant)

'use strict';

(function () {
  const { t, createElement } = window.MM;

  let selectionObserver = null;
  let batchMergeButton = null;
  let stylesElement = null;

  // CSS injecté pour la modale de fusion et les animations
  const CSS_STYLES = `
    .mm-merge-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      font-family: var(--mm-font-family, system-ui, -apple-system, sans-serif);
      animation: mmFadeIn 0.2s ease-out;
    }
    .mm-merge-dialog {
      background: var(--mm-surface, #1e1e1e);
      border: 1px solid var(--mm-border, #333);
      border-radius: var(--mm-radius-md, 12px);
      padding: 24px;
      width: 400px;
      max-width: 90%;
      color: var(--mm-on-surface, #e3e3e3);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      animation: mmSlideUp 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .mm-merge-title {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 16px;
      color: var(--mm-primary, #4285F4);
    }
    .mm-merge-field {
      margin-bottom: 16px;
    }
    .mm-merge-label {
      display: block;
      font-size: 12px;
      color: #aaa;
      margin-bottom: 6px;
    }
    .mm-merge-input {
      width: 100%;
      padding: 10px 12px;
      border-radius: 6px;
      border: 1px solid #444;
      background: #2b2b2b;
      color: #fff;
      font-size: 14px;
      box-sizing: border-box;
    }
    .mm-merge-input:focus {
      border-color: var(--mm-primary, #4285F4);
      outline: none;
    }
    .mm-merge-formats {
      display: flex;
      gap: 12px;
      margin-top: 8px;
    }
    .mm-merge-format-btn {
      flex: 1;
      padding: 10px;
      border-radius: 6px;
      border: 1px solid #444;
      background: #2b2b2b;
      color: #ccc;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    .mm-merge-format-btn.active {
      border-color: var(--mm-primary, #4285F4);
      background: rgba(66, 133, 244, 0.1);
      color: var(--mm-primary, #4285F4);
    }
    .mm-merge-buttons {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      margin-top: 24px;
    }
    .mm-merge-btn-cancel {
      padding: 8px 16px;
      border-radius: 6px;
      border: 1px solid #444;
      background: transparent;
      color: #ccc;
      cursor: pointer;
      font-size: 13px;
    }
    .mm-merge-btn-confirm {
      padding: 8px 16px;
      border-radius: 6px;
      border: none;
      background: var(--mm-primary, #4285F4);
      color: #fff;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
    }
    .mm-merge-btn-confirm:hover {
      background: #357ae8;
    }
    .mm-merge-progress-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 20px 0;
      text-align: center;
    }
    .mm-merge-spinner {
      border: 3px solid rgba(255, 255, 255, 0.1);
      border-top: 3px solid var(--mm-primary, #4285F4);
      border-radius: 50%;
      width: 28px;
      height: 28px;
      animation: mmSpin 1s linear infinite;
      margin-bottom: 16px;
    }
    @keyframes mmFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes mmSlideUp {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    @keyframes mmSpin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;

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
    
    // Sélecteurs précis : exclure [class*="checkbox"] qui capture les wrappers Angular
    const checkboxes = window.MM.findElementsInShadows(
      'input[type="checkbox"], [role="checkbox"], mat-pseudo-checkbox, .mat-pseudo-checkbox',
      list
    );
    return checkboxes.filter(cb => {
      const isChecked = 
        cb.getAttribute('aria-checked') === 'true' || 
        cb.checked === true || 
        cb.classList.contains('mat-pseudo-checkbox-checked') || 
        cb.getAttribute('state') === 'checked' ||
        (typeof cb.className === 'string' && cb.className.includes('checked')) ||
        cb.getAttribute('aria-selected') === 'true';

      // Exclure la case globale "Tout sélectionner" de façon sémantique
      const selectAllRow = findSelectAllRow();
      const isGlobal = selectAllRow && (cb === selectAllRow || selectAllRow.contains(cb));

      return isChecked && !isGlobal;
    });
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

  /**
   * Remonte depuis une checkbox jusqu'à la carte source parente.
   * Retourne { card, title, stretchedBtn } ou null.
   */
  function findSourceCardFromCheckbox(cb) {
    let el = cb;
    // Remonter au plus 15 niveaux jusqu'à trouver un conteneur de source
    for (let i = 0; i < 15 && el; i++) {
      el = el.parentElement || (el.parentNode && el.parentNode.host) || null;
      if (!el) break;
      // Chercher un bouton source-stretched-button dans ce conteneur
      const stretchedBtn = el.querySelector('button.source-stretched-button');
      if (stretchedBtn) {
        const title = stretchedBtn.getAttribute('aria-label') || el.textContent.trim().split('\n')[0].slice(0, 80);
        return { card: el, title: title, stretchedBtn: stretchedBtn };
      }
    }
    return null;
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

  async function runMergeProcess(checkboxes, title, format, dialog, overlay) {
    const notebookId = window.MM.getActiveNotebookId();
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
      // Récupérer toutes les sources du carnet via RPC pour le fallback de matching
      let allSources = [];
      try {
        allSources = await window.MM.rpc.getNotebookSources(notebookId);
      } catch (e) {
        console.warn('[MM] Impossible de lister les sources du notebook via RPC.', e);
      }

      for (let i = 0; i < checkboxes.length; i++) {
        const cb = checkboxes[i];

        // Remonter depuis la checkbox vers la carte source parente
        const sourceInfo = findSourceCardFromCheckbox(cb);
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

      // Cacher le spinner
      const spinner = dialog.querySelector('.mm-merge-spinner');
      if (spinner) spinner.style.display = 'none';

      statusEl.textContent = 'Fusion terminée !';
      statusEl.style.color = '#34A853';
      substatusEl.textContent = 'La nouvelle source a été ajoutée à votre carnet. Actualisation en cours...';
      
      const btnClose = createElement('button', {
        className: 'mm-merge-btn-confirm',
        style: 'margin-top: 16px; background-color: #34A853;',
        textContent: 'Fermer',
        onClick: () => {
          overlay.remove();
          window.location.reload();
        }
      });
      progressContainer.appendChild(btnClose);

      // Rechargement automatique de la page après 1.5s pour synchroniser l'affichage
      setTimeout(() => {
        if (overlay && overlay.parentNode) {
          overlay.remove();
          window.location.reload();
        }
      }, 1500);

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
    if (!stylesElement) {
      stylesElement = document.createElement('style');
      stylesElement.id = 'mm-merge-styles';
      stylesElement.textContent = CSS_STYLES;
      document.head.appendChild(stylesElement);
    }

    updateBatchMergeButtonState();
    console.log('[MM] Module merge initialisé');
  }

  function cleanupMerge() {
    if (batchMergeButton) {
      batchMergeButton.remove();
      batchMergeButton = null;
    }
    if (stylesElement) {
      stylesElement.remove();
      stylesElement = null;
    }
    console.log('[MM] Module merge nettoyé');
  }

  window.MM.initMerge = initMerge;
  window.MM.cleanupMerge = cleanupMerge;
  window.MM.updateBatchMergeButtonState = updateBatchMergeButtonState;
})();
