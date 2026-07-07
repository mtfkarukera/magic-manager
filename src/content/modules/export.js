// export.js — Module d'exportation de sources individuelles et par lot
// Auteur : MTF Karukera | Licence : MPL-2.0
// Dépendances :
// - window.MM (t, createElement, debounce)
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

  /** Observer pour détecter la sélection/désélection des checkboxes */
  let selectionObserver = null;

  /** Observer pour détecter l'affichage du panneau individuel de source */
  let sourceObserver = null;

  // ═══════════════════════════════════════════════════════════════════════
  // Sélecteurs DOM robustes
  // ═══════════════════════════════════════════════════════════════════════

  function findSourcesListContainer() {
    return document.querySelector('section.source-panel, .source-panel, .sources-panel, [class*="source-panel"], [class*="sources-panel"], [class*="source-list"]');
  }

  function findSelectAllRow() {
    const list = findSourcesListContainer();
    if (!list) return null;
    
    // Trouver le texte "Tout sélectionner" ou équivalent dans d'autres langues
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

      // Exclure la case globale "Tout sélectionner"
      const isGlobal = 
        (cb.id && cb.id.includes('select-all')) || 
        (cb.getAttribute('aria-label') && cb.getAttribute('aria-label').includes('Tout sélectionner')) ||
        window.MM.isInsideSelector(cb, '[class*="select-all"]');

      return isChecked && !isGlobal;
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

  // ═══════════════════════════════════════════════════════════════════════
  // Générateurs de format (PDF / Markdown / ZIP)
  // Implémentation ZIP en pur JS sans librairie externe (format STORE, non compressé)
  // afin d'éviter l'avertissement AMO lié au constructeur Function de JSZip.
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Calcule le CRC-32 d'un Uint8Array (algorithme standard ZIP).
   * @param {Uint8Array} data
   * @returns {number}
   */
  function crc32(data) {
    // Table CRC-32 précalculée (IEEE 802.3)
    const table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c;
    }
    let crc = -1;
    for (let i = 0; i < data.length; i++) {
      crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ -1) >>> 0;
  }

  /**
   * Construit un fichier ZIP (format STORE — sans compression) en pur JS.
   * Élimine toute dépendance à JSZip et son usage de Function constructor.
   *
   * @param {Array<{name: string, data: string}>} files - Liste {name, data} de fichiers texte
   * @returns {Blob} Fichier ZIP prêt à télécharger
   */
  function buildZipBlob(files) {
    const enc = new TextEncoder();
    const parts = [];
    const centralDir = [];
    let offset = 0;

    for (const file of files) {
      const nameBytes = enc.encode(file.name);
      const dataBytes = enc.encode(file.data);
      const crc      = crc32(dataBytes);
      const size     = dataBytes.length;
      const now      = new Date();

      // Date/heure DOS
      const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
      const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);

      // En-tête local (30 octets + nom)
      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0,  0x04034B50, true);  // Signature PK
      lv.setUint16(4,  20,         true);  // Version minimum
      lv.setUint16(6,  0,          true);  // Flags
      lv.setUint16(8,  0,          true);  // Compression : STORE
      lv.setUint16(10, dosTime,    true);
      lv.setUint16(12, dosDate,    true);
      lv.setUint32(14, crc,        true);
      lv.setUint32(18, size,       true);  // Taille compressée
      lv.setUint32(22, size,       true);  // Taille non-compressée
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0,          true);  // Extra length
      local.set(nameBytes, 30);

      // Enregistrement dans le répertoire central
      const central = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0,  0x02014B50, true); // Signature
      cv.setUint16(4,  20,         true); // Version auteur
      cv.setUint16(6,  20,         true); // Version minimum
      cv.setUint16(8,  0,          true); // Flags
      cv.setUint16(10, 0,          true); // Compression : STORE
      cv.setUint16(12, dosTime,    true);
      cv.setUint16(14, dosDate,    true);
      cv.setUint32(16, crc,        true);
      cv.setUint32(20, size,       true);
      cv.setUint32(24, size,       true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0,  true); // Extra
      cv.setUint16(32, 0,  true); // Comment
      cv.setUint16(34, 0,  true); // Disk start
      cv.setUint16(36, 0,  true); // Internal attr
      cv.setUint32(38, 0,  true); // External attr
      cv.setUint32(42, offset, true); // Offset
      central.set(nameBytes, 46);

      parts.push(local, dataBytes);
      centralDir.push(central);
      offset += local.length + size;
    }

    // Enregistrement de fin (End of Central Directory)
    const cdSize = centralDir.reduce((s, c) => s + c.length, 0);
    const eocd   = new Uint8Array(22);
    const ev     = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054B50, true); // Signature
    ev.setUint16(4, 0, true); ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    return new Blob([...parts, ...centralDir, eocd], { type: 'application/zip' });
  }
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Retire l'extension de document éventuellement incluse dans le titre affiché
   * par NotebookLM (ex : "rapport.pdf" → "rapport", "notes.docx" → "notes").
   * NotebookLM conserve parfois l'extension d'origine dans le titre de la source,
   * ce qui provoquerait des noms de fichier du type "rapport.pdf.md" ou "rapport.pdf.pdf".
   *
   * @param {string} title - Titre brut de la source
   * @returns {string} Titre sans extension de document
   */
  function stripSourceExtension(title) {
    // Extensions courantes que NotebookLM peut conserver dans le titre
    const KNOWN_EXTS = /\.(pdf|docx?|xlsx?|pptx?|txt|md|odt|ods|odp|rtf|csv|json|html?|xml|epub)$/i;
    return (title || '').replace(KNOWN_EXTS, '');
  }

  function downloadMarkdown(filename, content) {
    // Nettoyer le titre : retirer l'extension source éventuelle puis ajouter .md
    const baseName = stripSourceExtension(filename || 'source');
    const cleanFilename = baseName.replace(/[\/\\?%*:|"<>\s]/g, '_') + '.md';
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
    // Résolution jsPDF : sandbox XPCOM Firefox → globalThis, puis self, puis window
    const jspdfLib = window.jspdf
      || (typeof globalThis !== 'undefined' && globalThis.jspdf)
      || (typeof self !== 'undefined' && self.jspdf);

    // Log de diagnostic — visible dans la console de notebooklm.google.com (F12)
    console.log('[MM] downloadPDF() appelé —', {
      filename: filename,
      contentLength: content ? content.length : 0,
      jspdfDispo: !!(jspdfLib && jspdfLib.jsPDF)
    });

    // En Firefox, les content scripts s'exécutent dans un sandbox XPCOM isolé.
    // jsPDF UMD s'attache au global sandbox (this), pas à window (page).
    // jspdfLib est résolu ci-dessus (avant le log) pour couvrir les 3 contextes.
    if (!jspdfLib || !jspdfLib.jsPDF) {
      console.error('[MM] jsPDF non résolu (window / globalThis / self). Export PDF annulé.', {
        window_jspdf: typeof window.jspdf,
        globalThis_jspdf: typeof globalThis !== 'undefined' ? typeof globalThis.jspdf : 'N/A',
        self_jspdf: typeof self !== 'undefined' ? typeof self.jspdf : 'N/A'
      });
      return;
    }

    // Retirer l'extension source existante (ex: rapport.pdf → rapport) avant d'ajouter .pdf
    const baseName = stripSourceExtension(filename || 'source');
    const cleanFilename = baseName.replace(/[\/\\?%*:|"<>\s]/g, '_') + '.pdf';

    try {
      const { jsPDF } = jspdfLib;
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
      const titleLines = doc.splitTextToSize(filename || 'Document', maxLineWidth);
      let y = 25;

      titleLines.forEach(function (line) {
        if (y > pageHeight - margin) { doc.addPage(); y = 20; }
        doc.text(line, margin, y);
        y += 8;
      });

      y += 4; // Espace après le titre

      // Contenu texte
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(11);

      const paragraphs = content.split('\n\n');
      paragraphs.forEach(function (p) {
        const pText = p.replace(/\s+/g, ' ').trim();
        if (!pText) return;
        const lines = doc.splitTextToSize(pText, maxLineWidth);
        lines.forEach(function (line) {
          if (y > pageHeight - margin) { doc.addPage(); y = 20; }
          doc.text(line, margin, y);
          y += 6;
        });
        y += 4; // Espace inter-paragraphe
      });

      // Téléchargement via blob (méthode fiable en content script Firefox)
      // doc.output('blob') retourne un vrai Blob PDF sans étape intermédiaire
      const pdfBlob = doc.output('blob');
      const pdfUrl  = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href     = pdfUrl;
      a.download = cleanFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Libérer l'URL après un délai (le clic est asynchrone)
      setTimeout(function () { URL.revokeObjectURL(pdfUrl); }, 1000);
      console.log('[MM] Fichier PDF téléchargé :', cleanFilename);

    } catch (err) {
      console.error('[MM] Erreur lors de la génération PDF :', err);
    }
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
  // Actions d'exportation par lot
  // ═══════════════════════════════════════════════════════════════════════

  async function triggerBatchExport() {
    const checked = getCheckedSourceCheckboxes();
    if (checked.length === 0) return;

    // Fermer le dialogue global de paramétrage s'il est ouvert
    const settings = document.getElementById('mm-settings-menu');
    if (settings) settings.style.display = 'none';

    // showConfirmDialog(titleKey, messageKey, substitutions, onConfirm, onCancel)
    window.MM.showConfirmDialog(
      'exportButton',
      'batchExportDescription',
      [],
      () => startBatchProcess(checked, 'ZIP'),
      null
    );
  }

  async function startBatchProcess(checkboxes, format) {
    console.log(`[MM] Lancement de l'exportation par lot au format ${format} pour ${checkboxes.length} sources...`);

    // Collecte des fichiers pour l'export ZIP (format STORE natif, sans JSZip)
    const zipFiles = [];
    const activeNotebookName = getActiveNotebookName();

    for (let i = 0; i < checkboxes.length; i++) {
      const cb = checkboxes[i];

      // Remonter depuis la checkbox vers la carte source parente
      const sourceInfo = findSourceCardFromCheckbox(cb);
      if (!sourceInfo) {
        console.warn(`[MM] Export batch : impossible de remonter au conteneur pour la checkbox ${i}`);
        continue;
      }

      console.log(`[MM] Export batch : traitement de "${sourceInfo.title.slice(0, 50)}"`);
      sourceInfo.stretchedBtn.click();

      // Attendre le rendu dynamique du source-viewer
      await new Promise(r => setTimeout(r, 800));

      const data = findIndividualSourceData();
      if (data && data.content) {
        if (format === 'Markdown') {
          downloadMarkdown(data.title, data.content);
        } else if (format === 'PDF') {
          downloadPDF(data.title, data.content);
        } else if (format === 'ZIP') {
          const cleanTitle = (data.title || `Source_${i+1}`).replace(/[\/\\?%*:|"<>\s]/g, '_') + '.md';
          zipFiles.push({ name: cleanTitle, data: data.content });
        }
      } else {
        console.warn(`[MM] Export batch : aucun contenu extractible pour "${sourceInfo.title.slice(0, 50)}"`);
      }
    }

    if (format === 'ZIP' && zipFiles.length > 0) {
      const zipName = (activeNotebookName || 'Notebook_Sources').replace(/[\/\\?%*:|"<>\s]/g, '_') + '.zip';
      // buildZipBlob : implémentation ZIP native sans JSZip (format STORE)
      const zipBlob = buildZipBlob(zipFiles);

      const url = URL.createObjectURL(zipBlob);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = zipName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      console.log(`[MM] Package ZIP téléchargé : ${zipName} (${zipFiles.length} fichiers)`);
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
    console.log(`[MM] updateBatchExportButtonState : ${checked.length} source(s) cochée(s) détectée(s).`);
    
    // Ancre prioritaire : le panel-header du panneau des sources de NotebookLM
    const sourcePanel = document.querySelector('section.source-panel, .source-panel, [class*="source-panel"]');
    const panelHeader = sourcePanel ? sourcePanel.querySelector('.panel-header, [class*="header"]') : null;
    
    let anchor = panelHeader;
    let isHeader = true;
    
    if (!anchor) {
      anchor = document.querySelector('.mm-search-bar') || findSelectAllRow();
      isHeader = false;
      console.log('[MM] updateBatchExportButtonState : pas de panel-header trouvé, utilisation fallback :', anchor ? anchor.tagName : 'non trouvé');
    }
    
    if (!anchor) {
      console.warn('[MM] updateBatchExportButtonState : aucune ancre trouvée pour injecter le bouton d\'export par lot.');
      return;
    }

    if (checked.length > 0) {
      if (!batchExportButton || !anchor.contains(batchExportButton)) {
        if (batchExportButton) batchExportButton.remove();

        console.log('[MM] updateBatchExportButtonState : création du bouton d\'export par lot.');

        batchExportButton = createElement('button', {
          className: 'mm-batch-export-btn',
          title: `${t('exportButton')} (${checked.length})`,
          style: isHeader
            ? 'background: transparent; border: none; color: var(--mm-primary, #4285F4); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; width: 32px; height: 32px; transition: background-color var(--mm-transition-fast), color var(--mm-transition-fast); margin-right: 4px; padding: 0;'
            : 'background: transparent; border: none; color: var(--mm-primary, #4285F4); cursor: pointer; margin-left: 12px; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--mm-radius-sm); padding: 4px; transition: color var(--mm-transition-fast);',
          onClick: triggerBatchExport
        }, [
          createDownloadIcon(),
          createElement('span', {
            style: 'font-size: 10px; font-weight: bold; margin-left: 2px; font-family: var(--mm-font-family);',
            textContent: `(${checked.length})`
          })
        ]);

        // Effets de survol si injecté dans le header
        if (isHeader) {
          batchExportButton.addEventListener('mouseenter', function () {
            batchExportButton.style.backgroundColor = 'rgba(66, 133, 244, 0.08)';
          });
          batchExportButton.addEventListener('mouseleave', function () {
            batchExportButton.style.backgroundColor = 'transparent';
          });
        }

        if (isHeader) {
          // Trouver le bouton collapse natif
          const nativeButtons = Array.from(anchor.querySelectorAll(
            'button:not(.mm-batch-merge-btn):not(.mm-batch-export-btn):not(.mm-individual-delete-btn):not(.mm-individual-export-btn)'
          ));
          const collapseBtn = nativeButtons[nativeButtons.length - 1];
          if (collapseBtn) {
            // Insérer à gauche du bouton de fusion s'il existe déjà
            const mergeBtn = anchor.querySelector('.mm-batch-merge-btn');
            const targetBefore = mergeBtn || collapseBtn;
            targetBefore.parentNode.insertBefore(batchExportButton, targetBefore);
          } else {
            anchor.appendChild(batchExportButton);
          }
        } else {
          anchor.appendChild(batchExportButton);
        }
      } else {
        const span = batchExportButton.querySelector('span');
        if (span) {
          span.textContent = `(${checked.length})`;
        }
        batchExportButton.title = `${t('exportButton')} (${checked.length})`;
      }
    } else {
      if (batchExportButton) {
        console.log('[MM] updateBatchExportButtonState : retrait du bouton d\'export par lot (0 source cochée).');
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
