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


  // ═══════════════════════════════════════════════════════════════════════
  // Fonction locale spécifique à l'export (extraction du contenu source)
  // Les sélecteurs DOM partagés (findSourcesListContainer, findSelectAllRow,
  // getCheckedSourceCheckboxes, findSourceContainerByTitle,
  // findSourceCardFromCheckbox) sont centralisés dans source-helpers.js
  // et exposés via window.MM.*
  // ═══════════════════════════════════════════════════════════════════════

  function findIndividualSourceData() {
    const sourceViewer = document.querySelector('source-viewer');
    if (!sourceViewer) return null;

    const title = window.MM.findSourceViewerTitleText(sourceViewer) ||
                  (window.MM.findSourceViewerTitle(sourceViewer) || { textContent: '' }).textContent.trim();
    if (!title) return null;

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

  /**
   * Attend que le titre du source-viewer change par rapport à previousTitle.
   * Cela permet de détecter qu'une nouvelle source est chargée, même si
   * le source-viewer était déjà visible (cas de la deuxième source et suivantes).
   *
   * @param {string} previousTitle - Titre affiché dans le viewer avant le clic.
   * @param {number} timeoutMs - Délai maximum d'attente en millisecondes.
   * @returns {Promise<string|null>} Le nouveau titre ou null si timeout.
   */
  async function waitForViewerToChange(previousTitle, timeoutMs) {
    // Délai minimum incompressible : Angular a besoin de ~300ms pour monter le composant
    await new Promise(r => setTimeout(r, 400));

    const TITLE_SELECTOR = '.source-title, [class*="source-title"], .title, [class*="viewer-title"]';
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const viewer = document.querySelector('source-viewer');
      if (viewer) {
        const titleEl = viewer.querySelector(TITLE_SELECTOR);
        const currentTitle = titleEl ? titleEl.textContent.trim() : '';
        // Résoudre si le titre a changé (nouvelle source chargée)
        if (currentTitle && currentTitle !== previousTitle) {
          return currentTitle;
        }
      }
      await new Promise(r => setTimeout(r, 100));
    }
    return null; // Timeout — on continue quand même
  }

  /**
   * Ferme le source-viewer actif en cliquant sur le bouton de retour natif
   * de NotebookLM, situé dans le panel-header (et non pas dans le viewer lui-même).
   *
   * NOTE : Ne jamais utiliser Escape comme fallback — cela provoque l'ouverture
   * automatique de la première source de la liste (comportement Angular natif).
   */
  function closeCurrentSourceViewer() {
    // Vérifier qu'un viewer est bien ouvert
    const viewer = document.querySelector('source-viewer');
    if (!viewer) return;

    // La stratégie fiable : cliquer le bouton natif du panel-header.
    // Quand le viewer est ouvert, le panel-header affiche un bouton "retour" (←)
    // en tant que dernier bouton natif. C'est la même logique que closeSourceViewer dans merge.js.
    const sourcePanel = document.querySelector('section.source-panel, .source-panel, [class*="source-panel"]');
    if (!sourcePanel) return;

    const panelHeader = sourcePanel.querySelector('.panel-header, [class*="panel-header"]');
    if (!panelHeader) return;

    // Sélectionner les boutons natifs uniquement (exclure nos boutons MM injectés)
    const nativeButtons = Array.from(panelHeader.querySelectorAll(
      'button:not(.mm-batch-merge-btn):not(.mm-batch-export-btn):not(.mm-individual-delete-btn):not(.mm-individual-export-btn)'
    ));

    if (nativeButtons.length > 0) {
      // Le bouton de retour est le dernier bouton natif quand le viewer est ouvert
      const backBtn = nativeButtons[nativeButtons.length - 1];
      console.log('[MM] Export batch : fermeture du viewer via bouton natif du header :', backBtn.getAttribute('aria-label') || backBtn.className);
      backBtn.click();
    } else {
      console.warn('[MM] Export batch : impossible de trouver le bouton de retour dans le panel-header. Viewer laissé ouvert.');
    }
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
    const checked = window.MM.getCheckedSourceCheckboxes();
    if (checked.length === 0) return;

    // Fermer le dialogue global de paramétrage s'il est ouvert
    const settings = document.getElementById('mm-settings-menu');
    if (settings) settings.style.display = 'none';

    // Si une seule source est cochée : export direct en Markdown, pas de ZIP ni de modale
    if (checked.length === 1) {
      startBatchProcess(checked, 'Markdown');
      return;
    }

    // Plusieurs sources : proposer un ZIP via la modale de confirmation
    // showConfirmDialog(titleKey, messageKey, substitutions, onConfirm, onCancel)
    window.MM.showConfirmDialog(
      'exportButton',
      'batchExportDescription',
      [],
      () => startBatchProcess(checked, 'ZIP'),
      null
    );
  }

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

  async function startBatchProcess(checkboxes, format) {
    console.log(`[MM] Lancement de l'exportation par lot au format ${format} pour ${checkboxes.length} sources...`);

    const notebookId = window.MM.getActiveNotebookId();
    if (!notebookId) {
      window.MM.showAlertDialog('exportError', 'notebookIdNotFound');
      return;
    }


    // Récupérer toutes les sources du carnet via RPC pour le fallback de matching
    let allSources = [];
    try {
      allSources = await window.MM.rpc.getNotebookSources(notebookId);
    } catch (e) {
      console.warn('[MM] Impossible de lister les sources du notebook via RPC.', e);
    }

    const zipFiles = [];
    const activeNotebookName = getActiveNotebookName();

    for (let i = 0; i < checkboxes.length; i++) {
      const cb = checkboxes[i];

      // Remonter depuis la checkbox vers la carte source parente
      const sourceInfo = window.MM.findSourceCardFromCheckbox(cb);
      if (!sourceInfo) {
        console.warn(`[MM] Export batch : impossible de remonter au conteneur pour la checkbox ${i}`);
        continue;
      }

      const title = cleanSourceTitle(sourceInfo.title);
      console.log(`[MM] Export batch : traitement de "${title.slice(0, 50)}" (${i+1}/${checkboxes.length})`);

      // 1. Extraire l'ID de la source (DOM puis RPC fallback)
      let sourceId = window.MM.extractSourceId(sourceInfo.card);
      if (!sourceId && allSources.length > 0) {
        sourceId = findSourceIdByTitle(title, allSources);
      }

      if (!sourceId) {
        console.error(`[MM] Impossible de trouver l'identifiant de la source pour "${title}"`);
        continue;
      }

      // 2. Récupérer le contenu brut via RPC
      try {
        const content = await window.MM.rpc.getSourceContent(sourceId, notebookId);
        if (content) {
          if (format === 'Markdown') {
            downloadMarkdown(title, content);
          } else if (format === 'PDF') {
            downloadPDF(title, content);
          } else if (format === 'ZIP') {
            const cleanTitle = (title || `Source_${i+1}`).replace(/[\/\\?%*:|"<>\s]/g, '_') + '.md';
            zipFiles.push({ name: cleanTitle, data: content });
          }
        } else {
          console.warn(`[MM] Contenu vide reçu pour "${title}"`);
        }
      } catch (err) {
        console.error(`[MM] Échec de la récupération du contenu pour "${title}" :`, err);
      }

      // Espacement temporel de sécurité pour éviter le rate limiting (429)
      if (i < checkboxes.length - 1) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    if (format === 'ZIP' && zipFiles.length > 0) {
      const zipName = (activeNotebookName || 'Notebook_Sources').replace(/[\/\\?%*:|"<>\s]/g, '_') + '.zip';
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


    // Insérer à gauche du bouton delete MM s'il existe, sinon devant collapse
    const deleteBtn = document.querySelector('.mm-individual-delete-btn');
    const anchorBefore = deleteBtn || collapseBtn;
    collapseBtn.parentNode.insertBefore(exportBtn, anchorBefore);
    console.log('[MM] Bouton exportation individuelle injecté dans section.source-panel .panel-header');
  }

  function updateBatchExportButtonState() {
    const checked = window.MM.getCheckedSourceCheckboxes();
    const count = checked.length;
    console.debug(`[MM] updateBatchExportButtonState : ${count} source(s) cochée(s) détectée(s).`);
    
    // Ancre prioritaire : le panel-header du panneau des sources de NotebookLM (desktop)
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

    if (count > 0) {
      if (!batchExportButton || !anchor.contains(batchExportButton)) {
        if (batchExportButton) batchExportButton.remove();

        console.debug('[MM] updateBatchExportButtonState : création du bouton d\'export par lot.');

        batchExportButton = createElement('button', {
          className: isHeader ? 'mm-batch-export-btn mm-btn-icon' : 'mm-batch-export-btn mm-btn-row',
          title: `${t('exportButton')} (${count})`,
          onClick: triggerBatchExport
        }, [
          createDownloadIcon(),
          createElement('span', {
            className: 'mm-badge-count',
            textContent: `(${count})`
          })
        ]);


        if (isHeader) {
          if (isMobileSticky) {
            anchor.appendChild(batchExportButton);
          } else {
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
          }
        } else {
          anchor.appendChild(batchExportButton);
        }
      } else {
        const span = batchExportButton.querySelector('span');
        if (span) span.textContent = `(${count})`;
        batchExportButton.title = `${t('exportButton')} (${count})`;
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
