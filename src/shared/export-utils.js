// export-utils.js — Utilitaires d'exportation partagés (Sprint 5)
// Auteur : MTF Karukera | Licence : MPL-2.0
// Chargé après html-to-md.js, avant export.js et merge.js par le manifest.

(function () {
  'use strict';

  window.MM = window.MM || {};
  window.MM.exportUtils = {};

  // ═══════════════════════════════════════════════════════════════════════
  // 1. Fonctions utilitaires de chaînes et ZIP
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Nettoie le titre brut récupéré d'une source pour éliminer les préfixes de l'aria-label.
   *
   * @param {string} rawTitle - Titre brut
   * @returns {string} Titre nettoyé
   */
  function cleanSourceTitle(rawTitle) {
    if (!rawTitle) return '';
    let title = rawTitle.trim();
    const prefixes = [
      /^(Ouvrir la source|Ouvrir le document|Ouvrir|Visualiser)\s+/i,
      /^(Open source|Open document|Open|View)\s+/i,
      /^(Abrir la fuente|Abrir|Visualizar)\s+/i,
      /^(Quelle öffnen|Öffnen|Anzeigen)\s+/i
    ];
    for (const regex of prefixes) {
      title = title.replace(regex, '');
    }
    return title.trim();
  }

  /**
   * Retire l'extension de document éventuellement incluse dans le titre affiché
   * par NotebookLM (ex : "rapport.pdf" → "rapport").
   *
   * @param {string} title - Titre brut
   * @returns {string} Titre sans extension
   */
  function stripSourceExtension(title) {
    const KNOWN_EXTS = /\.(pdf|docx?|xlsx?|pptx?|txt|md|odt|ods|odp|rtf|csv|json|html?|xml|epub)$/i;
    return (title || '').replace(KNOWN_EXTS, '');
  }

  /**
   * Trouve l'identifiant de source correspondant au titre par matching robuste.
   * Normalise en enlevant les extensions des deux côtés avant comparaison.
   *
   * @param {string} cleanedTitle - Titre de la source nettoyé
   * @param {Array<{id: string, title: string}>} allSources - Liste des sources du carnet
   * @returns {string|null} ID de la source ou null
   */
  function findSourceIdByTitle(cleanedTitle, allSources) {
    if (!cleanedTitle || !allSources) return null;
    
    const clean = (t) => stripSourceExtension(cleanSourceTitle(t)).trim().toLowerCase();
    const target = clean(cleanedTitle);

    // 1. Match exact sans extension
    let match = allSources.find(s => s.title && clean(s.title) === target);
    if (match) return match.id;

    // 2. Match par sous-chaîne ou inclusion sans extension
    match = allSources.find(s => s.title && (target.includes(clean(s.title)) || clean(s.title).includes(target)));
    if (match) return match.id;

    return null;
  }

  /**
   * Retourne la date et l'heure actuelles au format YYYY-MM-DD_HHhmm.
   *
   * @returns {string} L'horodatage formaté
   */
  function getFormattedTimestamp() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const yyyy = now.getFullYear();
    const mm = pad(now.getMonth() + 1);
    const dd = pad(now.getDate());
    const hh = pad(now.getHours());
    const min = pad(now.getMinutes());
    return `${yyyy}-${mm}-${dd}_${hh}h${min}`;
  }

  /**
   * Nettoie et sanitise le texte pour jsPDF (évite les caractères exotiques non supportés par la police standard).
   *
   * @param {string} text - Le texte brut à nettoyer
   * @returns {string} Le texte nettoyé
   */
  function sanitizePdfText(text) {
    if (!text) return '';
    return text
      // Checkboxes et puces communes
      .replace(/[\u2610☐]/g, '[ ]')
      .replace(/[\u2611☑\u2714✔]/g, '[x]')
      .replace(/[\u2794➔\u279c➜\u2192→]/g, '->')
      .replace(/[\u2022•\u25e6◦\u25aa▪\u25ab▫\u2043⁃]/g, '- ')
      // Ligatures françaises
      .replace(/Œ/g, 'OE')
      .replace(/œ/g, 'oe')
      // Guillemets et apostrophes typographiques
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/\u2013/g, '-') // demi-tiret
      .replace(/\u2014/g, '--') // tiret cadratin
      // Ellipse
      .replace(/\u2026/g, '...')
      // Exposants
      .replace(/\u00b2/g, '2')
      .replace(/\u00b3/g, '3')
      // Diamètre / ensemble vide
      .replace(/[\u2205Ø]/g, 'O')
      // Remplacer tous les autres caractères hors de la plage WinAnsi standard (basic Latin + Latin-1 Supplement)
      .replace(/[\u2000-\u200b\u202f\u205f\u3000]/g, ' ')
      .replace(/[^\u0000-\u007F\u00A0-\u00FF]/g, '');
  }

  /**
   * Calcule le CRC-32 d'un Uint8Array (pour construction ZIP standard).
   */
  function crc32(data) {
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
   * Construit un fichier ZIP au format STORE (sans compression) en pur JS.
   *
   * @param {Array<{name: string, data: string}>} files - Liste d'objets {name, data}
   * @returns {Blob} Fichier ZIP
   */
  function buildZipBlob(files) {
    const enc = new TextEncoder();
    const parts = [];
    const centralDir = [];
    let offset = 0;

    for (const file of files) {
      const nameBytes = enc.encode(file.name);
      const dataBytes = typeof file.data === 'string' ? enc.encode(file.data) : file.data;
      const crc      = crc32(dataBytes);
      const size     = dataBytes.length;
      const now      = new Date();

      const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
      const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);

      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0,  0x04034B50, true);
      lv.setUint16(4,  20,         true);
      lv.setUint16(6,  0,          true);
      lv.setUint16(8,  0,          true);
      lv.setUint16(10, dosTime,    true);
      lv.setUint16(12, dosDate,    true);
      lv.setUint32(14, crc,        true);
      lv.setUint32(18, size,       true);
      lv.setUint32(22, size,       true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0,          true);
      local.set(nameBytes, 30);

      const central = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0,  0x02014B50, true);
      cv.setUint16(4,  20,         true);
      cv.setUint16(6,  20,         true);
      cv.setUint16(8,  0,          true);
      cv.setUint16(10, 0,          true);
      cv.setUint16(12, dosTime,    true);
      cv.setUint16(14, dosDate,    true);
      cv.setUint32(16, crc,        true);
      cv.setUint32(20, size,       true);
      cv.setUint32(24, size,       true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0,  true);
      cv.setUint16(32, 0,  true);
      cv.setUint16(34, 0,  true);
      cv.setUint16(36, 0,  true);
      cv.setUint32(38, 0,  true);
      cv.setUint32(42, offset, true);
      central.set(nameBytes, 46);

      parts.push(local, dataBytes);
      centralDir.push(central);
      offset += local.length + size;
    }

    const cdSize = centralDir.reduce((s, c) => s + c.length, 0);
    const eocd   = new Uint8Array(22);
    const ev     = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054B50, true);
    ev.setUint16(4, 0, true); ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    return new Blob([...parts, ...centralDir, eocd], { type: 'application/zip' });
  }

  /**
   * Déclenche le téléchargement d'un Blob et libère la mémoire après 10s.
   *
   * @param {Blob} blob - Le Blob à télécharger
   * @param {string} filename - Le nom de fichier cible
   */
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function() {
      URL.revokeObjectURL(url);
    }, 10000); // 10 secondes pour garantir le début du téléchargement
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Fonctions DOM (Fallbacks historiques d'extraction et navigation)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Extrait le titre et le texte brut actuellement affichés dans le viewer de source DOM.
   * Utilisé en fallback si l'ID de source n'est pas disponible pour un appel RPC.
   */
  function findIndividualSourceData() {
    const sourceViewer = document.querySelector('source-viewer');
    if (!sourceViewer) return null;

    const title = window.MM.findSourceViewerTitleText(sourceViewer) ||
                  (window.MM.findSourceViewerTitle(sourceViewer) || { textContent: '' }).textContent.trim();
    if (!title) return null;

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

    return { title: cleanSourceTitle(title), content: content };
  }

  /**
   * Attend de manière asynchrone le chargement d'une nouvelle source dans le viewer.
   */
  async function waitForViewerToChange(previousTitle, timeoutMs = 4000) {
    await new Promise(r => setTimeout(r, 400));
    const TITLE_SELECTOR = '.source-title, [class*="source-title"], .title, [class*="viewer-title"]';
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const viewer = document.querySelector('source-viewer');
      if (viewer) {
        const titleEl = viewer.querySelector(TITLE_SELECTOR);
        const currentTitle = titleEl ? titleEl.textContent.trim() : '';
        if (currentTitle && currentTitle !== previousTitle) {
          return currentTitle;
        }
      }
      await new Promise(r => setTimeout(r, 100));
    }
    return null;
  }

  /**
   * Ferme le source-viewer natif de NotebookLM.
   */
  function closeCurrentSourceViewer() {
    const viewer = document.querySelector('source-viewer');
    if (!viewer) return;

    const sourcePanel = document.querySelector('section.source-panel, .source-panel, [class*="source-panel"]');
    if (!sourcePanel) return;

    const panelHeader = sourcePanel.querySelector('.panel-header, [class*="panel-header"]');
    if (!panelHeader) return;

    const nativeButtons = Array.from(panelHeader.querySelectorAll(
      'button:not(.mm-batch-merge-btn):not(.mm-batch-export-btn):not(.mm-individual-delete-btn):not(.mm-individual-export-btn)'
    ));

    if (nativeButtons.length > 0) {
      const backBtn = nativeButtons[nativeButtons.length - 1];
      backBtn.click();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3. Dessin PDF Structuré (Custom Walker DOM récursif pour jsPDF)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Exécute un traitement avec une police temporaire, puis restaure l'état précédent.
   *
   * @param {jsPDF} doc - Instance de jsPDF
   * @param {string} fontName - Nom de la police ('Helvetica', 'Courier', etc.)
   * @param {string} fontStyle - Style de la police ('normal', 'bold', 'italic')
   * @param {number|null} fontSize - Taille (ou null pour conserver)
   * @param {Function} callback - Traitement
   */
  function withFont(doc, fontName, fontStyle, fontSize, callback) {
    const prevFont = doc.getFont();
    const prevSize = doc.getFontSize();
    doc.setFont(fontName, fontStyle);
    if (fontSize !== null && fontSize !== undefined) doc.setFontSize(fontSize);
    callback();
    doc.setFont(prevFont.fontName, prevFont.fontStyle);
    doc.setFontSize(prevSize);
  }

  /**
   * Convertit et télécharge des images distantes (Google) en Data URI base64.
   * Doit être exécuté sur le DOM Parser AVANT de lancer walkDOM.
   */
  async function preloadImagesAsBase64(rootEl) {
    const images = rootEl.querySelectorAll('img[src]');
    for (const img of images) {
      const src = img.getAttribute('src');
      if (!src || src.startsWith('data:')) continue; // Déjà en base64

      try {
        const dataUri = await fetchImageAsBase64(src);
        if (dataUri) {
          img.setAttribute('src', dataUri);
          if (!img.getAttribute('width') && img.naturalWidth) {
            img.setAttribute('data-width', String(img.naturalWidth));
            img.setAttribute('data-height', String(img.naturalHeight));
          }
        }
      } catch (err) {
        console.warn('[MM] Image ignorée (CORS ou erreur de chargement) :', src, err.message);
        // Fallback textuel pour l'image
        const placeholder = document.createElement('span');
        placeholder.textContent = ` [Image : ${img.getAttribute('alt') || 'sans description'}] `;
        img.replaceWith(placeholder);
      }
    }
  }

  /**
   * Télécharge une image de manière sécurisée (avec credentials de session Google)
   * et retourne sa représentation en Data URL base64 compressée JPEG (70%).
   */
  async function fetchImageAsBase64(url) {
    const response = await fetch(url, {
      credentials: 'include', // Nécessaire pour les images privées de la session Google
      mode: 'cors'
    });

    if (!response.ok) {
      throw new Error(`Erreur de téléchargement HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const contentType = blob.type || 'image/jpeg';

    // Rendu Canvas offscreen
    const imageBitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = imageBitmap.width;
    canvas.height = imageBitmap.height;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(imageBitmap, 0, 0);

    const format = contentType.includes('png') ? 'image/png' : 'image/jpeg';
    const quality = format === 'image/jpeg' ? 0.7 : undefined;
    const dataUri = canvas.toDataURL(format, quality);

    // Libération mémoire
    imageBitmap.close();
    canvas.width = 0;
    canvas.height = 0;

    return dataUri;
  }

  /**
   * Rendu d'un bloc de code avec fond gris arrondi et police Courier.
   */
  function renderCodeBlock(doc, preNode, margin, indent, maxWidth, cursorYRef, ensureSpaceFn) {
    const codeFontSize = 9.5;
    const codeLineHeight = 4.5;
    const padding = 3;
    const pageHeight = doc.internal.pageSize.getHeight();
    const bottomMargin = 20;

    const codeNode = preNode.querySelector('code') || preNode;
    const rawLines = codeNode.textContent.split('\n');
    const wrappedLines = [];

    rawLines.forEach(rawLine => {
      const sanitized = sanitizePdfText(rawLine);
      if (sanitized.trim() === '') {
        wrappedLines.push('');
      } else {
        const split = doc.splitTextToSize(sanitized, maxWidth - indent - (padding * 2));
        if (split.length > 0) {
          wrappedLines.push(...split);
        }
      }
    });

    // Dessiner les lignes de code en Courier
    withFont(doc, 'Courier', 'normal', codeFontSize, () => {
      let codeY = cursorYRef.y + padding;
      
      // Calculer le rectangle initial sur la page courante
      let startIdx = 0;
      while (startIdx < wrappedLines.length) {
        // Déterminer combien de lignes tiennent sur la page courante
        let linesOnPage = 0;
        let testY = codeY;
        while (startIdx + linesOnPage < wrappedLines.length && testY + codeLineHeight <= pageHeight - bottomMargin) {
          testY += codeLineHeight;
          linesOnPage++;
        }

        // Si aucune ligne ne tient (par exemple parce qu'on est en bas de page), ajouter une page
        if (linesOnPage === 0) {
          doc.addPage();
          codeY = margin + padding;
          cursorYRef.y = margin;
          continue;
        }

        // Dessiner le rectangle de fond pour ces lignes
        const currentBlockHeight = linesOnPage * codeLineHeight + (padding * 2);
        doc.setFillColor(245, 245, 245);
        doc.roundedRect(
          margin + indent,
          codeY - padding,
          maxWidth - indent,
          currentBlockHeight,
          1, 1, 'F'
        );

        // Dessiner le texte de ces lignes
        for (let i = 0; i < linesOnPage; i++) {
          const line = wrappedLines[startIdx + i];
          doc.text(line || ' ', margin + indent + padding, codeY + 2.5);
          codeY += codeLineHeight;
        }

        startIdx += linesOnPage;

        // Si d'autres lignes restent à dessiner, on passe à la page suivante
        if (startIdx < wrappedLines.length) {
          doc.addPage();
          codeY = margin + padding;
          cursorYRef.y = margin;
        } else {
          cursorYRef.y = codeY + padding;
        }
      }
    });
  }

  /**
   * Rendu d'une image base64 dans le PDF.
   */
  function renderImage(doc, imgNode, margin, indent, maxWidth, cursorYRef, ensureSpaceFn, lineHeight) {
    const imgData = imgNode.getAttribute('src');
    if (!imgData || !imgData.startsWith('data:image')) {
      const alt = imgNode.getAttribute('alt') || 'image';
      withFont(doc, 'Helvetica', 'italic', 10, () => {
        doc.text(`[Image : ${alt}]`, margin + indent, cursorYRef.y);
      });
      cursorYRef.y += lineHeight;
      return;
    }

    const format = imgData.startsWith('data:image/png') ? 'PNG' : 'JPEG';
    const dataWidth = parseInt(imgNode.getAttribute('data-width'), 10) || imgNode.naturalWidth || 200;
    const dataHeight = parseInt(imgNode.getAttribute('data-height'), 10) || imgNode.naturalHeight || 150;
    const ratio = dataHeight / dataWidth;
    const drawWidth = Math.min(maxWidth - indent, dataWidth * 0.264583);
    const drawHeight = drawWidth * ratio;

    ensureSpaceFn(drawHeight + 4);
    try {
      doc.addImage(imgData, format, margin + indent, cursorYRef.y, drawWidth, drawHeight);
    } catch (e) {
      console.warn('[MM] Échec addImage dans le PDF :', e.message);
      const alt = imgNode.getAttribute('alt') || 'image';
      doc.text(`[Image : ${alt}]`, margin + indent, cursorYRef.y);
    }
    cursorYRef.y += drawHeight + 4;
  }

  /**
   * Rendu d'un tableau HTML simple avec enveloppement du texte multi-lignes.
   */
  function renderTable(doc, tableNode, margin, indent, maxWidth, cursorYRef, ensureSpaceFn, lineHeight, bottomMargin, pageHeight) {
    const rows = tableNode.querySelectorAll('tr');
    if (rows.length === 0) return;

    const firstRow = rows[0];
    const cellsSample = firstRow.querySelectorAll('th, td');
    const colCount = cellsSample.length;
    if (colCount === 0) return;

    const tableWidth = maxWidth - indent;
    const colWidth = tableWidth / colCount;
    const cellPadding = 2;

    const tableX = margin + indent;
    let tableY = cursorYRef.y;

    const prevSize = doc.getFontSize();
    doc.setFontSize(8.5); // Police réduite pour le tableau

    for (let r = 0; r < rows.length; r++) {
      const cells = rows[r].querySelectorAll('th, td');
      const isHeader = rows[r].querySelector('th') !== null;

      // 1. Calculer les lignes enveloppées pour chaque cellule et trouver le maxLines de la ligne
      const cellLines = [];
      let maxLines = 1;
      for (let c = 0; c < cells.length && c < colCount; c++) {
        const cellText = sanitizePdfText(cells[c].textContent.trim());
        const truncated = doc.splitTextToSize(cellText, colWidth - (cellPadding * 2));
        cellLines.push(truncated);
        if (truncated.length > maxLines) {
          maxLines = truncated.length;
        }
      }

      // Calcul de la hauteur de ligne dynamique
      const rowHeight = maxLines * 4 + 4;

      // Saut de page si dépassement
      if (tableY + rowHeight > pageHeight - bottomMargin) {
        doc.addPage();
        tableY = margin;
      }

      // Fond pour l'en-tête
      if (isHeader) {
        doc.setFillColor(235, 235, 235);
        doc.rect(tableX, tableY, tableWidth, rowHeight, 'F');
        doc.setFont('Helvetica', 'bold');
      } else {
        doc.setFont('Helvetica', 'normal');
      }

      // Dessiner les cellules et le texte
      for (let c = 0; c < cells.length && c < colCount; c++) {
        const cellX = tableX + (c * colWidth);
        
        // Bordure de la cellule
        doc.setDrawColor(180);
        doc.rect(cellX, tableY, colWidth, rowHeight);

        // Texte multi-lignes
        const lines = cellLines[c] || [];
        let lineY = tableY + cellPadding + 3;
        for (const line of lines) {
          doc.text(line, cellX + cellPadding, lineY);
          lineY += 4;
        }
      }
      tableY += rowHeight;
    }

    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(prevSize);
    doc.setDrawColor(0);

    cursorYRef.y = tableY + 4;
  }

  /**
   * Parcourt récursivement un élément HTML et le dessine dans l'instance jsPDF.
   */
  function walkDOM(doc, rootEl) {
    const margin = 15;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const maxWidth = pageWidth - margin * 2;
    const bottomMargin = 20;
    const lineHeight = 6;
    
    // Objet curseur mutable pour partager la position Y verticale
    const cursorYRef = { y: 25 };

    const headingSizes = { H1: 22, H2: 18, H3: 15, H4: 13, H5: 12, H6: 11 };

    function ensureSpace(neededHeight) {
      if (cursorYRef.y + neededHeight > pageHeight - bottomMargin) {
        doc.addPage();
        cursorYRef.y = margin;
      }
    }

    function processNode(node, indent = 0, listIndex = 0) {
      // 1. Nœud Texte Brut
      if (node.nodeType === Node.TEXT_NODE) {
        const rawText = node.textContent.trim();
        if (!rawText) return;
        const text = sanitizePdfText(rawText);
        if (!text) return;

        const lines = doc.splitTextToSize(text, maxWidth - indent);
        for (const line of lines) {
          ensureSpace(lineHeight);
          doc.text(line, margin + indent, cursorYRef.y);
          cursorYRef.y += lineHeight;
        }
        return;
      }

      // Ignorer tout ce qui n'est pas élément HTML
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const tag = node.tagName;

      // --- Titres H1-H6 ---
      if (headingSizes[tag]) {
        const cleanText = sanitizePdfText(node.textContent.trim());
        if (!cleanText) return;

        cursorYRef.y += 3; // Petit espacement avant titre
        const size = headingSizes[tag];
        const headingLineHeight = size * 0.35 + 2;

        withFont(doc, 'Helvetica', 'bold', size, () => {
          const lines = doc.splitTextToSize(cleanText, maxWidth - indent);
          for (const line of lines) {
            ensureSpace(headingLineHeight);
            doc.text(line, margin + indent, cursorYRef.y);
            cursorYRef.y += headingLineHeight;
          }
          cursorYRef.y += 2; // Espacement après titre
        });
        return;
      }

      // --- Gras inline (STRONG/B) ---
      if (tag === 'STRONG' || tag === 'B') {
        withFont(doc, 'Helvetica', 'bold', null, () => {
          for (const child of node.childNodes) {
            processNode(child, indent, 0);
          }
        });
        return;
      }

      // --- Italique inline (EM/I) ---
      if (tag === 'EM' || tag === 'I') {
        withFont(doc, 'Helvetica', 'italic', null, () => {
          for (const child of node.childNodes) {
            processNode(child, indent, 0);
          }
        });
        return;
      }

      // --- Code inline (CODE hors PRE) ---
      if (tag === 'CODE' && node.parentNode?.tagName !== 'PRE') {
        const cleanText = sanitizePdfText(node.textContent);
        if (cleanText.trim()) {
          withFont(doc, 'Courier', 'normal', 9.5, () => {
            const lines = doc.splitTextToSize(cleanText, maxWidth - indent);
            for (const line of lines) {
              ensureSpace(lineHeight);
              doc.text(line, margin + indent, cursorYRef.y);
              cursorYRef.y += lineHeight;
            }
          });
        }
        return;
      }

      // --- Blocs de code (PRE) ---
      if (tag === 'PRE') {
        renderCodeBlock(doc, node, margin, indent, maxWidth, cursorYRef, ensureSpace);
        return;
      }

      // --- Images ---
      if (tag === 'IMG') {
        renderImage(doc, node, margin, indent, maxWidth, cursorYRef, ensureSpace, lineHeight);
        return;
      }

      // --- Listes non ordonnées (UL) ---
      if (tag === 'UL') {
        for (const child of node.children) {
          processNode(child, indent + 6, 0);
        }
        cursorYRef.y += 2;
        return;
      }

      // --- Listes ordonnées (OL) ---
      if (tag === 'OL') {
        let idx = 1;
        for (const child of node.children) {
          processNode(child, indent + 6, idx++);
        }
        cursorYRef.y += 2;
        return;
      }

      // --- Éléments de liste (LI) ---
      if (tag === 'LI') {
        const bullet = listIndex > 0 ? `${listIndex}. ` : '• ';
        ensureSpace(lineHeight);
        doc.text(bullet, margin + indent, cursorYRef.y);
        const bulletWidth = doc.getTextWidth(bullet);
        const savedY = cursorYRef.y;

        for (const child of node.childNodes) {
          processNode(child, indent + bulletWidth + 1, 0);
        }
        if (cursorYRef.y === savedY) {
          cursorYRef.y += lineHeight;
        }
        return;
      }

      // --- Bloc de citation (BLOCKQUOTE) ---
      if (tag === 'BLOCKQUOTE') {
        const barX = margin + indent + 1;
        const startY = cursorYRef.y;
        withFont(doc, 'Helvetica', 'italic', null, () => {
          for (const child of node.childNodes) {
            processNode(child, indent + 8, 0);
          }
        });
        doc.setDrawColor(180);
        doc.setLineWidth(0.8);
        doc.line(barX, startY - 2, barX, cursorYRef.y);
        doc.setDrawColor(0);
        doc.setLineWidth(0.2);
        return;
      }

      // --- Liens (A) ---
      if (tag === 'A') {
        const prevColor = doc.getTextColor();
        doc.setTextColor(0, 102, 204); // Bleu de lien cliquable
        for (const child of node.childNodes) {
          processNode(child, indent, 0);
        }
        doc.setTextColor(prevColor);
        return;
      }

      // --- Ligne horizontale (HR) ---
      if (tag === 'HR') {
        ensureSpace(6);
        cursorYRef.y += 2;
        doc.setDrawColor(200);
        doc.setLineWidth(0.3);
        doc.line(margin, cursorYRef.y, pageWidth - margin, cursorYRef.y);
        doc.setDrawColor(0);
        cursorYRef.y += 4;
        return;
      }

      // --- Saut de ligne (BR) ---
      if (tag === 'BR') {
        cursorYRef.y += lineHeight;
        return;
      }

      // --- Tableaux ---
      if (tag === 'TABLE') {
        renderTable(doc, tag === 'TABLE' ? node : null, margin, indent, maxWidth, cursorYRef, ensureSpace, lineHeight, bottomMargin, pageHeight);
        return;
      }

      // --- Fallback conteneurs complexes (DIV, P, SPAN...) ---
      for (const child of node.childNodes) {
        processNode(child, indent, 0);
      }

      if (tag === 'P' || tag === 'DIV') {
        cursorYRef.y += 2;
      }
    }

    processNode(rootEl);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 4. Générateur unifié PDF (Simple & Structuré)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Génère un Blob PDF en utilisant jsPDF, avec support du mode simple ou structuré.
   *
   * @param {string} contentOrHtml - Texte brut ou chaîne HTML à rendre
   * @param {string} title - Titre du document
   * @param {Object} [options] - Options de rendu
   * @param {boolean} [options.structured=false] - True pour activer le Walker DOM et le rendu riche
   * @param {boolean} [options.loadImages=true] - True pour pré-charger les images en base64 (si structuré)
   * @returns {Promise<Blob>} Blob PDF prêt au téléchargement
   */
  async function generatePdfBlob(contentOrHtml, title, { structured = false, loadImages = true } = {}) {
    const jspdfLib = window.jspdf
      || (typeof globalThis !== 'undefined' && globalThis.jspdf)
      || (typeof self !== 'undefined' && self.jspdf);

    if (!jspdfLib || !jspdfLib.jsPDF) {
      throw new Error('[MM] Bibliothèque jsPDF indisponible dans le scope d\'extension.');
    }

    const { jsPDF } = jspdfLib;
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    if (structured) {
      // --- PDF STRUCTURÉ (Rendu riche via Walker DOM) ---
      try {
        const parser = new DOMParser();
        const parsed = parser.parseFromString(contentOrHtml || '', 'text/html');

        if (loadImages) {
          // Résoudre et convertir les images en base64 avant de parser le DOM
          await preloadImagesAsBase64(parsed.body);
        }

        // Dessiner le DOM enrichi
        walkDOM(doc, parsed.body);
      } catch (err) {
        console.error('[MM] Échec du rendu PDF structuré, fallback vers rendu texte brut :', err);
        // Fallback vers rendu simple si le Walker échoue
        renderSimplePdf(doc, contentOrHtml, title);
      }
    } else {
      // --- PDF SIMPLE (Rendu brut historique) ---
      renderSimplePdf(doc, contentOrHtml, title);
    }

    return doc.output('blob');
  }

  /**
   * Rendu de texte brut historique (PDF Simple).
   */
  function renderSimplePdf(doc, textContent, title) {
    const margin = 20;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const maxLineWidth = pageWidth - (margin * 2);

    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(16);
    const titleLines = doc.splitTextToSize(title || 'Document', maxLineWidth);
    let y = 25;

    titleLines.forEach(function (line) {
      if (y > pageHeight - margin) { doc.addPage(); y = 20; }
      doc.text(line, margin, y);
      y += 8;
    });

    y += 4; // Espace

    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(11);

    const paragraphs = (textContent || '').split('\n\n');
    paragraphs.forEach(function (p) {
      const pText = p.replace(/\s+/g, ' ').trim();
      if (!pText) return;
      const lines = doc.splitTextToSize(pText, maxLineWidth);
      lines.forEach(function (line) {
        if (y > pageHeight - margin) { doc.addPage(); y = 20; }
        doc.text(line, margin, y);
        y += 6;
      });
      y += 4;
    });
  }

  /**
   * Vérifie si un contenu (HTML ou Markdown) semble avoir été tronqué par Google.
   */
  function checkIfTruncated(content, isHtml) {
    if (!content) return false;
    const size = content.length;
    const hasBase64 = content.includes('data:image/');
    if (isHtml) {
      if (size > 1500000 && hasBase64) {
        const lower = content.toLowerCase();
        return !lower.includes('</html>') && !lower.includes('</body>');
      }
    } else {
      if (size > 1500000 && hasBase64) {
        return true; // En Markdown, la taille brute + présence de base64 est un indicateur fiable
      }
    }
    return false;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Exposition publique
  // ═══════════════════════════════════════════════════════════════════════

  window.MM.exportUtils = {
    cleanSourceTitle,
    stripSourceExtension,
    findSourceIdByTitle,
    getFormattedTimestamp,
    sanitizePdfText,
    crc32,
    buildZipBlob,
    downloadBlob,
    findIndividualSourceData,
    waitForViewerToChange,
    closeCurrentSourceViewer,
    withFont,
    preloadImagesAsBase64,
    fetchImageAsBase64,
    walkDOM,
    generatePdfBlob,
    checkIfTruncated
  };

  console.log('[MM] export-utils.js initialisé avec succès (Walker DOM enrichi).');
})();
