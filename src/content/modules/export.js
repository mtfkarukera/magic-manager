// export.js — Module d'exportation de sources individuelles et par lot
// Auteur : MTF Karukera | Licence : MPL-2.0
// Dépendances :
// - window.MM (t, createElement, debounce)
// - lib/jspdf.umd.min.js (window.jspdf)
// - lib/jszip.min.js (window.JSZip)

'use strict';

(function () {
  const { t, createElement, debounce } = window.MM;

  // ═══════════════════════════════════════════════════════════════════════
  // État interne
  // ═══════════════════════════════════════════════════════════════════════

  /** Bouton d'exportation par lot (injecté dynamiquement) */
  let batchExportButton = null;

  /** Observer pour détecter la sélection/désélection des checkboxes */
  let selectionObserver = null;

  /** Observer pour détecter l'affichage du panneau individuel de source */
  let sourceObserver = null;

  // ═══════════════════════════════════════════════════════════════════════
  // Sélecteurs DOM robustes
  // ═══════════════════════════════════════════════════════════════════════

  function findSourcesListContainer() {
    return document.querySelector('.sources-panel, [class*="sources-panel"], [class*="source-list"]');
  }

  function findSelectAllRow() {
    const list = findSourcesListContainer();
    if (!list) return null;
    
    // Trouver le texte "Tout sélectionner" ou équivalent dans d'autres langues
    const divs = Array.from(list.querySelectorAll('div, span, button'));
    for (let el of divs) {
      const txt = (el.textContent || '').trim().toLowerCase();
      if (txt === 'tout sélectionner' || txt === 'select all' || txt === 'seleccionar todo' || txt === 'alle auswählen') {
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
    
    // Retourne toutes les cases à cocher cochées (aria-checked="true")
    // en ignorant la case globale "Tout sélectionner"
    const checkboxes = Array.from(list.querySelectorAll('input[type="checkbox"], [role="checkbox"]'));
    return checkboxes.filter(cb => {
      const isChecked = cb.getAttribute('aria-checked') === 'true' || cb.checked === true;
      const isGlobal = cb.id && cb.id.includes('select-all');
      
      // La checkbox globale "Tout sélectionner" n'a pas d'aria-label avec le titre d'une source
      const hasLabel = cb.getAttribute('aria-label') && cb.getAttribute('aria-label') !== 'Tout sélectionner';
      
      return isChecked && !isGlobal && hasLabel;
    });
  }

  function findIndividualSourceData() {
    const sourceViewer = document.querySelector('source-viewer');
    if (!sourceViewer) return null;

    const titleEl = sourceViewer.querySelector('.source-title');
    if (!titleEl) return null;
    const title = titleEl.textContent.trim();

    // Cloner et nettoyer pour extraire proprement le texte
    const clone = sourceViewer.cloneNode(true);
    const guide = clone.querySelector('button');
    if (guide) guide.remove();
    
    const ourBtns = clone.querySelectorAll('.mm-delete-btn, .mm-individual-export-btn, .mm-individual-delete-btn');
    ourBtns.forEach(b => b.remove());

    const textElements = Array.from(clone.querySelectorAll('p, li, [class*="paragraph"], [class*="text-segment"]'));
    let content = '';
    if (textElements.length > 0) {
      content = textElements.map(el => el.textContent.trim()).filter(t => t.length > 0).join('\n\n');
    } else {
      content = clone.textContent.trim();
    }

    return { title: title, content: content };
  }

  function findSourceContainerByTitle(sourceTitle) {
    const containers = Array.from(document.querySelectorAll('div.single-source-container'));
    for (let ctr of containers) {
      const stretchedBtn = ctr.querySelector('button.source-stretched-button');
      if (stretchedBtn) {
        const label = stretchedBtn.getAttribute('aria-label') || '';
        if (label.includes(sourceTitle) || sourceTitle.includes(label)) {
          return ctr;
        }
      }
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Générateurs de format (PDF / Markdown / ZIP)
  // ═══════════════════════════════════════════════════════════════════════

  function downloadMarkdown(filename, content) {
    const cleanFilename = (filename || 'source').replace(/[\/\\?%*:|"<>\s]/g, '_') + '.md';
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = cleanFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log(`[MM] Fichier MD téléchargé : ${cleanFilename}`);
  }

  function downloadPDF(filename, content) {
    const cleanFilename = (filename || 'source').replace(/[\/\\?%*:|"<>\s]/g, '_') + '.pdf';
    
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    // Configuration police et marges
    const margin = 20;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const maxLineWidth = pageWidth - (margin * 2);

    // Titre du document dans le PDF
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(16);
    const titleLines = doc.splitTextToSize(filename, maxLineWidth);
    let y = 25;
    
    titleLines.forEach(line => {
      if (y > pageHeight - margin) {
        doc.addPage();
        y = 20;
      }
      doc.text(line, margin, y);
      y += 8;
    });

    y += 4; // Espace après le titre

    // Contenu texte
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(11);
    
    const paragraphs = content.split('\n\n');
    paragraphs.forEach(p => {
      const pText = p.replace(/\s+/g, ' ').trim();
      if (!pText) return;

      const lines = doc.splitTextToSize(pText, maxLineWidth);
      lines.forEach(line => {
        if (y > pageHeight - margin) {
          doc.addPage();
          y = 20;
        }
        doc.text(line, margin, y);
        y += 6;
      });
      y += 4; // Espace inter-paragraphe
    });

    // Téléchargement via blob URL (même méthode fiable que downloadMarkdown)
    // doc.save() peut être bloqué en content script Firefox — on passe par un lien <a>
    const pdfBlob = new Blob([doc.output('arraybuffer')], { type: 'application/pdf' });
    const pdfUrl = URL.createObjectURL(pdfBlob);
    const a = document.createElement('a');
    a.href = pdfUrl;
    a.download = cleanFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(pdfUrl);
    console.log(`[MM] Fichier PDF téléchargé : ${cleanFilename}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Pictogrammes SVG
  // ═══════════════════════════════════════════════════════════════════════

  function createDownloadIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'currentColor');
    svg.style.display = 'block';
    svg.style.pointerEvents = 'none';

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M5 20h14v-2H5v2zm7-18L5.33 11h4V16h5.33v-5h4L12 2z');
    
    svg.appendChild(path);
    return svg;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Actions d'exportation
  // ═══════════════════════════════════════════════════════════════════════

  async function triggerBatchExport() {
    const checked = getCheckedSourceCheckboxes();
    if (checked.length === 0) return;

    // Fermer le dialogue global de paramétrage s'il est ouvert pour voir la modale
    const settings = document.getElementById('mm-settings-menu');
    if (settings) settings.style.display = 'none';

    window.MM.showConfirmDialog(
      t('exportButton'),
      t('batchExportDescription'),
      () => startBatchProcess(checked, 'PDF'),
      'PDF',
      () => startBatchProcess(checked, 'Markdown'),
      'Markdown',
      () => startBatchProcess(checked, 'ZIP'),
      'ZIP (Markdown)'
    );
  }

  async function startBatchProcess(checkboxes, format) {
    console.log(`[MM] Lancement de l'exportation par lot au format ${format} pour ${checkboxes.length} sources...`);
    
    const zip = (format === 'ZIP') ? new window.JSZip() : null;
    const activeNotebookName = getActiveNotebookName();
    
    for (let i = 0; i < checkboxes.length; i++) {
      const cb = checkboxes[i];
      const sourceTitle = cb.getAttribute('aria-label') || `Source_${i+1}`;
      
      // Simuler le clic pour ouvrir la source et charger son texte
      const container = findSourceContainerByTitle(sourceTitle);
      if (container) {
        const stretchedBtn = container.querySelector('button.source-stretched-button');
        if (stretchedBtn) {
          stretchedBtn.click();
          // Attendre le rendu dynamique du source-viewer
          await new Promise(r => setTimeout(r, 600));
          
          const data = findIndividualSourceData();
          if (data && data.content) {
            if (format === 'Markdown') {
              downloadMarkdown(data.title, data.content);
            } else if (format === 'PDF') {
              downloadPDF(data.title, data.content);
            } else if (format === 'ZIP') {
              const cleanTitle = (data.title || `Source_${i+1}`).replace(/[\/\\?%*:|"<>\s]/g, '_') + '.md';
              zip.file(cleanTitle, data.content);
            }
          }
        }
      }
    }

    if (format === 'ZIP') {
      const zipName = (activeNotebookName || 'Notebook_Sources').replace(/[\/\\?%*:|"<>\s]/g, '_') + '.zip';
      const content = await zip.generateAsync({ type: 'blob' });
      
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = zipName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      console.log(`[MM] Package ZIP téléchargé : ${zipName}`);
    }

    console.log('[MM] Exportation par lot terminée');
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
    // Vérifier que source-viewer est actif avant toute chose
    const sourceViewer = document.querySelector('source-viewer');
    if (!sourceViewer) return;

    if (document.querySelector('.mm-individual-export-btn')) return;

    // 1. Trouver le panel-header de la SECTION source-panel (pas le header global)
    const sourcePanel = document.querySelector('section.source-panel');
    if (!sourcePanel) return;
    const panelHeader = sourcePanel.querySelector('.panel-header');
    if (!panelHeader) return;

    // 2. Capturer le bouton collapse AVANT toute injection (exclure les nôtres)
    const nativeButtons = Array.from(panelHeader.querySelectorAll(
      'button:not(.mm-individual-delete-btn):not(.mm-individual-export-btn)'
    ));
    if (nativeButtons.length === 0) return;
    const collapseBtn = nativeButtons[nativeButtons.length - 1];

    // Bouton d'exportation individuel circulaire
    const exportBtn = createElement('button', {
      className: 'mm-individual-export-btn',
      title: t('exportButton'),
      style: 'width: 32px; height: 32px; border: none; background: transparent; color: var(--mm-on-surface, #e3e3e3); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; padding: 0; margin-right: 6px; transition: background-color var(--mm-transition-fast), color var(--mm-transition-fast); vertical-align: middle;',
      onClick: function (e) {
        e.stopPropagation();

        // Récupérer les données au moment du clic (pas à l'injection)
        const currentData = findIndividualSourceData();
        if (!currentData) return;

        // Utiliser showFormatChoiceDialog avec le titre "Exporter" (pas "Fusionner")
        window.MM.showFormatChoiceDialog('exportButton', function (format) {
          if (format === 'pdf') {
            downloadPDF(currentData.title, currentData.content);
          } else {
            downloadMarkdown(currentData.title, currentData.content);
          }
        });
      }
    }, [createDownloadIcon()]);

    exportBtn.addEventListener('mouseenter', function () {
      exportBtn.style.backgroundColor = 'rgba(66, 133, 244, 0.08)';
      exportBtn.style.color = 'var(--mm-primary, #4285F4)';
    });
    exportBtn.addEventListener('mouseleave', function () {
      exportBtn.style.backgroundColor = 'transparent';
      exportBtn.style.color = 'var(--mm-on-surface, #e3e3e3)';
    });

    // Insérer à gauche du bouton delete MM s'il existe, sinon devant collapse
    const deleteBtn = panelHeader.querySelector('.mm-individual-delete-btn');
    const anchorBefore = deleteBtn || collapseBtn;
    collapseBtn.parentNode.insertBefore(exportBtn, anchorBefore);
    console.log('[MM] Bouton exportation individuelle injecté dans section.source-panel .panel-header');
  }

  function updateBatchExportButtonState() {
    const checked = getCheckedSourceCheckboxes();
    const selectAllRow = findSelectAllRow();
    if (!selectAllRow) return;

    if (checked.length > 0) {
      if (!batchExportButton || !selectAllRow.contains(batchExportButton)) {
        if (batchExportButton) batchExportButton.remove();

        batchExportButton = createElement('button', {
          className: 'mm-batch-export-btn',
          title: `${t('exportButton')} (${checked.length})`,
          style: 'background: transparent; border: none; color: var(--mm-primary, #4285F4); cursor: pointer; margin-left: 12px; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--mm-radius-sm); padding: 4px; transition: color var(--mm-transition-fast);',
          onClick: triggerBatchExport
        }, [
          createDownloadIcon(),
          createElement('span', {
            style: 'font-size: 11px; font-weight: bold; margin-left: 4px; font-family: var(--mm-font-family);',
            textContent: `(${checked.length})`
          })
        ]);

        selectAllRow.appendChild(batchExportButton);
      } else {
        const span = batchExportButton.querySelector('span');
        if (span) {
          span.textContent = `(${checked.length})`;
        }
        batchExportButton.title = `${t('exportButton')} (${checked.length})`;
      }
    } else {
      if (batchExportButton) {
        batchExportButton.remove();
        batchExportButton = null;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Cycle de vie
  // ═══════════════════════════════════════════════════════════════════════

  function initExport() {
    checkAndInjectIndividualExport();
    updateBatchExportButtonState();

    // Observer léger sur la liste de sources (uniquement pour les cases à cocher)
    // Le sourceObserver (body) est géré de manière centralisée dans panel-observer.js
    const listContainer = findSourcesListContainer();
    if (listContainer && !selectionObserver) {
      selectionObserver = new MutationObserver(debounce(function () {
        updateBatchExportButtonState();
      }, 150));
      selectionObserver.observe(listContainer, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'aria-checked', 'checked']
      });
    }

    console.log('[MM] Module export initialisé');
  }

  function cleanupExport() {
    if (selectionObserver) {
      selectionObserver.disconnect();
      selectionObserver = null;
    }
    // Note : sourceObserver supprimé — géré par panel-observer.js
    if (batchExportButton) {
      batchExportButton.remove();
      batchExportButton = null;
    }
    document.querySelectorAll('.mm-individual-export-btn').forEach(
      function (b) { b.remove(); }
    );
    console.log('[MM] Module export nettoyé');
  }

  window.MM.initExport = initExport;
  window.MM.cleanupExport = cleanupExport;
  // Exposé pour panel-observer.js
  window.MM.checkAndInjectIndividualExport = checkAndInjectIndividualExport;
})();
