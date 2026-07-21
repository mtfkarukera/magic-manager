// html-to-md.js — Convertisseur HTML en Markdown utilisant turndown.js
// Auteur : MTF Karukera | Licence : MPL-2.0
// Chargé après turndown.js et turndown-plugin-gfm.js par le manifest.

(function() {
  'use strict';

  // Vérification de la présence de la dépendance principale
  if (typeof TurndownService === 'undefined') {
    console.error('[MM] TurndownService n\'est pas défini. Assure-toi que turndown.js est chargé.');
    return;
  }

  // Configuration de TurndownService avec les options optimales pour NotebookLM
  const service = new TurndownService({
    headingStyle: 'atx',           // # Titre (plus lisible et standard)
    bulletListMarker: '-',          // - Puce (standard)
    codeBlockStyle: 'fenced',      // ```code``` (standard markdown)
    fence: '```',
    emDelimiter: '*',               // *italique*
    strongDelimiter: '**',          // **gras**
    linkStyle: 'inlined',          // [texte](url)
    hr: '---'                      // --- (séparateur horizontal)
  });

  // Activation du plugin GFM si disponible
  if (typeof turndownPluginGfm !== 'undefined' && typeof turndownPluginGfm.gfm === 'function') {
    service.use(turndownPluginGfm.gfm);
  } else {
    console.warn('[MM] turndownPluginGfm n\'est pas disponible. Les tableaux ne seront pas convertis en Markdown GFM.');
  }

  // --- Règles personnalisées (Custom Rules) pour le HTML Google NotebookLM ---

  // 1. Règle pour ignorer les spans vides (omniprésents dans le HTML de Google)
  service.addRule('ignoreEmptySpans', {
    filter: function(node) {
      return node.nodeName === 'SPAN' && !node.textContent.trim();
    },
    replacement: function() {
      return '';
    }
  });

  // 2. Règle pour les spans Google ayant un style de texte en gras (classes obfusquées)
  service.addRule('googleBoldSpan', {
    filter: function(node) {
      if (node.nodeName !== 'SPAN' || !node.style) return false;
      const fw = node.style.fontWeight;
      return fw === '700' || fw === 'bold';
    },
    replacement: function(content) {
      const trimmed = content.trim();
      return trimmed ? '**' + trimmed + '**' : '';
    }
  });

  // 3. Règle pour les spans Google ayant un style de texte en italique (classes obfusquées)
  service.addRule('googleItalicSpan', {
    filter: function(node) {
      if (node.nodeName !== 'SPAN' || !node.style) return false;
      return node.style.fontStyle === 'italic';
    },
    replacement: function(content) {
      const trimmed = content.trim();
      return trimmed ? '*' + trimmed + '*' : '';
    }
  });

  // 4. Règle de fallback pour les images sans attribut alt (attribut title ou fallback standard)
  service.addRule('imgFallbackAlt', {
    filter: 'img',
    replacement: function(content, node) {
      const alt = node.getAttribute('alt') || node.getAttribute('title') || 'image';
      const src = node.getAttribute('src') || '';
      return src ? '![' + alt + '](' + src + ')' : '';
    }
  });

  // 5. Suppression des scripts, styles et balises bruyantes
  service.remove(['script', 'style', 'noscript']);

  // --- Exposition sur le namespace global MM ---

  window.MM = window.MM || {};

  /**
   * Convertit une chaîne HTML brute en Markdown propre.
   * Utilise TurndownService avec des extensions GFM et des règles personnalisées pour NotebookLM.
   * En cas d'erreur ou si le parser échoue, un fallback vers le texte brut est assuré.
   *
   * @param {string} htmlString - Chaîne HTML à convertir.
   * @returns {string} Le Markdown converti et nettoyé.
   */
  window.MM.convertHtmlToMarkdown = function(htmlString) {
    if (!htmlString || typeof htmlString !== 'string') {
      return '';
    }

    try {
      // Pré-nettoyage DOM : suppression des noeuds parasites dans les structures de tableaux
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlString, 'text/html');

      const tables = doc.querySelectorAll('table, tbody, thead, tfoot, tr');
      tables.forEach(parent => {
        const parentTag = parent.tagName;
        const childNodes = Array.from(parent.childNodes);
        childNodes.forEach(child => {
          if (child.nodeType === 3) { // Noeud de texte parasite
            if (!child.textContent.trim()) {
              child.parentNode.removeChild(child);
            }
          } else if (child.nodeType === 1) { // Element enfant
            let isValid = false;
            const childTag = child.tagName;
            if (parentTag === 'TABLE') {
              isValid = ['TBODY', 'THEAD', 'TFOOT', 'TR', 'COL', 'COLGROUP', 'CAPTION'].includes(childTag);
            } else if (['TBODY', 'THEAD', 'TFOOT'].includes(parentTag)) {
              isValid = childTag === 'TR';
            } else if (parentTag === 'TR') {
              isValid = ['TD', 'TH'].includes(childTag);
            }
            if (!isValid) {
              child.parentNode.removeChild(child);
            }
          }
        });
      });

      // Conversion via Turndown en passant le DOM body nettoyé
      let markdown = service.turndown(doc.body);

      // Nettoyage post-conversion : suppression des lignes vides consécutives en excès (> 2)
      markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();

      return markdown;
    } catch (err) {
      console.error('[MM] Erreur lors de la conversion avec TurndownService :', err);

      // Fallback sécurisé : extraction du texte brut via DOMParser
      try {
        const doc = new DOMParser().parseFromString(htmlString, 'text/html');
        return doc.body.textContent || '';
      } catch (parserErr) {
        console.error('[MM] Erreur lors du fallback DOMParser :', parserErr);
        return htmlString; // En désespoir de cause, retourner la chaîne brute
      }
    }
  };

  console.log('[MM] html-to-md.js chargé avec succès (turndown + GFM).');
})();
