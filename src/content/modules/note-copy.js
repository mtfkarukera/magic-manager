// note-copy.js — Copie de note sans références aux sources (Sprint 4)
// Auteur : MTF Karukera | Licence : MPL-2.0
// Dépendance : window.MM (utils.js)

'use strict';

(function () {
  const { t, createElement } = window.MM;

  // ═══════════════════════════════════════════════════════════════════════
  // Utilitaires de Nettoyage de Citations
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Nettoie le texte brut (Markdown) en retirant toutes les citations [1], [2], [1, 2] et résidus UI.
   * @param {string} text
   * @returns {string}
   */
  function cleanMarkdownCitations(text) {
    if (!text) return '';
    return text
      // Retirer les motifs de citations crochets [1], [2], [1, 2], [10, 11]
      .replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, '')
      // Retirer les lignes d'en-tête de boîtes de code résiduelles
      .replace(/^(?:CODE|code)?\s*(?:Copier|Copy|codeCopier)\s*$/gim, '')
      .replace(/(?:^|\n)\s*(?:codeCopier|Copier|Copy)\s*(?=\n|$)/gi, '')
      // Retirer les mots-clés d'interface résiduels
      .replace(/\b(codeCopier|Copier|Copy|undoredo|keyboard_arrow_down|format_bold|format_italic|linkcodecode_blocks|format_list_bulletedformat_list_numberedhorizontal_ruleformat_clear|more_horiz|lock)\b/gi, '')
      // Nettoyer les espaces multiples superflus
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  /**
   * Nettoie un élément HTML de note ou artefact en supprimant les balises de citations,
   * puces de sources, barres d'outils d'édition, en-têtes de boîtes de code et boutons Google,
   * puis normalise les composants Tailwind Angular en balises HTML5 standards (p, h1-h4, blockquote, li, pre/code).
   * @param {Element} contentNode
   * @returns {string}
   */
  function cleanHtmlCitations(contentNode) {
    if (!contentNode) return '';

    // Cloner le nœud pour travailler sur une copie isolée du DOM live
    const clone = contentNode.cloneNode(true);

    // 1. Supprimer les éléments parasites d'interface Google (citations, barres d'outils, boutons de code, feedback)
    const noiseSelectors = [
      // Citations et puces de sources
      'sup',
      'button.citation-marker',
      '.citation-marker',
      '.xap-inline-dialog',
      '.inaccessible',
      '.inaccessible-icon',
      'a[class*="citation"]',
      'a[href*="source"]',
      '[data-source-id]',
      '.source-chip',
      '.citation-chip',
      'button[aria-label*="source" i]',
      'button[aria-label*="Source" i]',
      'button[aria-label*="citation" i]',
      'button[aria-label*="Citation" i]',
      'button[dialoglabel*="citation" i]',
      'button[dialoglabel*="Citation" i]',

      // Barre d'outils d'édition de notes (Undo, Redo, Format, Titre, Bold, Italic, Link, etc.)
      '.note-editor-toolbar',
      '.toolbar',
      '[class*="toolbar"]',
      'mat-toolbar',
      '.editor-actions',
      '.note-form-header',
      '.format-bar',
      '.format-bar-container',
      '.note-editor-header',

      // En-têtes et boutons de copie natifs des boîtes de code Google ("codeCopier")
      '.code-header',
      '.code-block-header',
      '.code-actions',
      '.copy-code-button',
      '.code-copy-button',
      '.mm-code-header',
      'button.copy-button',
      'button.mm-code-copy-btn',
      'button[aria-label*="Copier" i]',
      'button[aria-label*="Copy" i]',

      // Boutons d'actions et d'évaluation / feedback Google
      '.feedback-container',
      '.actions-container',
      'button[aria-label*="Thumb" i]',
      'button[aria-label*="Bon contenu" i]',
      'button[aria-label*="Mauvais contenu" i]',
      'button[aria-label*="Good response" i]',
      'button[aria-label*="Bad response" i]',
      'button[aria-label*="Partager" i]',
      'button[aria-label*="Share" i]',
      'button[aria-label*="Convertir en source" i]'
    ];

    noiseSelectors.forEach(function (sel) {
      const elements = clone.querySelectorAll(sel);
      elements.forEach(function (el) {
        // Si le parent du bouton de citation est un span conteneur isolé, le supprimer aussi
        const parentSpan = el.closest('span.ng-star-inserted');
        if (parentSpan && parentSpan.children.length <= 1) {
          parentSpan.remove();
        } else {
          el.remove();
        }
      });
    });

    // 2. Épuration ciblée des conteneurs de boîtes de code (Google et Magic Manager)
    const codeContainers = clone.querySelectorAll(
      'pre, .code-block, [class*="code-block"], .code-container, [class*="code-container"], labs-tailwind-code-block, .mm-code-block'
    );
    codeContainers.forEach(function (container) {
      const headers = container.querySelectorAll(
        'button, .code-header, .mm-code-header, [class*="header"], [class*="copy"], [class*="action"], mat-icon'
      );
      headers.forEach(function (h) { h.remove(); });
    });

    // 3. Supprimer tout élément précédant immédiatement un <pre> s'il s'agit d'un en-tête de code résiduel
    clone.querySelectorAll('pre').forEach(function (pre) {
      const prev = pre.previousElementSibling;
      if (prev) {
        const prevText = (prev.textContent || '').trim();
        if (/^(?:code\s*copier|codeCopier|CODE|Copier|Copy)$/i.test(prevText) || prev.querySelector('button, mat-icon')) {
          prev.remove();
        }
      }
    });

    // 4. Normaliser les Web Components & classes Tailwind de NotebookLM en balises HTML5 sémantiques (h1-h4, p, blockquote, li)
    const paragraphElements = Array.from(clone.querySelectorAll('.paragraph'));
    paragraphElements.forEach(function (el) {
      const cls = el.className || '';
      let targetTag = 'p';

      if (cls.includes('heading1')) targetTag = 'h1';
      else if (cls.includes('heading2')) targetTag = 'h2';
      else if (cls.includes('heading3')) targetTag = 'h3';
      else if (cls.includes('heading4')) targetTag = 'h4';
      else if (cls.includes('blockquote')) targetTag = 'blockquote';
      else if (cls.includes('list-item') || el.tagName === 'LI') targetTag = 'li';
      else targetTag = 'p';

      if (el.tagName.toLowerCase() !== targetTag) {
        const newEl = document.createElement(targetTag);
        while (el.firstChild) {
          newEl.appendChild(el.firstChild);
        }
        if (el.parentNode) {
          el.parentNode.replaceChild(newEl, el);
        }
      }
    });

    // 5. Nettoyer le texte restant dans le clone HTML pour supprimer les reliquats
    let html = clone.innerHTML || '';
    html = html
      .replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, '')
      .replace(/<[^>]+>\s*(?:code\s*copier|codeCopier|CODE\s*Copier|Copier|Copy)\s*<\/[^>]+>/gi, '');

    return html;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Heuristiques de Détection DOM
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Trouve le conteneur de l'élément à copier (Note classique ou artefact Markdown).
   * @returns {{el: Element, type: 'note'|'markdown'}|null}
   */
  function findCopyableContainer() {
    // 1. Détection des Notes classiques
    const explicitNote = document.querySelector('note-editor, .note-editor, form.note-form, .note-title-container');
    if (explicitNote && !explicitNote.closest('artifact-viewer, [class*="artifact-view"]')) {
      return { el: explicitNote.closest('note-editor, form.note-form') || explicitNote, type: 'note' };
    }

    const deleteBtn = document.querySelector('button.note-editor-delete-button');
    if (deleteBtn && !deleteBtn.closest('artifact-viewer, [class*="artifact-view"]')) {
      return { el: deleteBtn.closest('note-editor, form.note-form, div.note-title-container') || deleteBtn.parentElement, type: 'note' };
    }

    // 2. Détection des artefacts Markdown (.md / .markdown) dans le Studio
    const artifactViewer = document.querySelector('artifact-viewer, [class*="artifact-view"]');
    if (artifactViewer) {
      const titleInput = artifactViewer.querySelector('input.artifact-title, .title-label-inner, input[aria-label*="titre" i], input.title-input');
      if (titleInput) {
        const titleText = (titleInput.value || titleInput.textContent || '').trim().toLowerCase();
        if (titleText.endsWith('.md') || titleText.endsWith('.markdown')) {
          return { el: artifactViewer, type: 'markdown' };
        }
      }
    }

    return null;
  }

  /**
   * Trouve le bouton de suppression natif (icône corbeille) de la note.
   * @param {Element} noteContainer
   * @returns {Element|null}
   */
  function findDeleteButton(noteContainer) {
    if (!noteContainer) return null;

    // 1. Recherche par classe CSS explicite et attributs sémantiques
    const byAttr = noteContainer.querySelector(
      "button.note-editor-delete-button, button[aria-label*='Delete' i], button[aria-label*='Supprim' i], button[mattooltip*='Delete' i], button[mattooltip*='Supprim' i], .delete-button"
    );
    if (byAttr) return byAttr;

    // 2. Recherche par icône Material (delete / delete_outline) ou texte
    const buttons = noteContainer.querySelectorAll('button');
    for (const btn of buttons) {
      const text = (btn.textContent || '').trim().toLowerCase();
      const label = (btn.getAttribute('aria-label') || btn.getAttribute('mattooltip') || '').toLowerCase();
      if (text === 'delete' || text === 'delete_outline' || text === 'delete_forever' || label.includes('delete') || label.includes('supprim')) {
        return btn;
      }
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Logique d'Extraction & Copie Dual-MIME
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Extrait le titre et le contenu de la note/artefact active et effectue la copie Dual-MIME sans sources.
   * @param {{el: Element, type: 'note'|'markdown'}} containerInfo
   * @param {HTMLButtonElement} btnElement
   */
  async function handleCopyNoteWithoutSources(containerInfo, btnElement) {
    try {
      if (!containerInfo) {
        containerInfo = findCopyableContainer();
      }
      if (!containerInfo) return;

      const { el: container, type } = containerInfo;

      // 1. Extraire le titre
      let titleText = '';
      const inputEl = container.querySelector(
        'input.note-header__editable-title, input.artifact-title, input[aria-label*="titre" i], input[formcontrolname="name"], input.title-input'
      );
      if (inputEl && typeof inputEl.value === 'string' && inputEl.value.trim().length > 0) {
        titleText = inputEl.value.trim();
      } else {
        const headingEl = container.querySelector('h1, h2, h3, .title-label-inner');
        if (headingEl && headingEl.textContent && headingEl.textContent.trim().length > 0) {
          titleText = headingEl.textContent.trim();
        }
      }

      // Garde-fou ultime : si le titre extrait est anormalement le mot de l'icône corbeille, l'ignorer
      if (titleText.toLowerCase() === 'delete' || titleText.toLowerCase() === 'delete_outline') {
        titleText = '';
      }

      // 2. Extraire le corps en ciblant en priorité la zone de contenu sémantique
      let contentEl = null;
      if (type === 'note') {
        contentEl = container.querySelector(
          '.note-editor-content, [contenteditable="true"], .ProseMirror, labs-tailwind-doc-viewer, .note-editor--readonly, .content, .note-content'
        );
      } else if (type === 'markdown') {
        contentEl = container.querySelector(
          'labs-tailwind-doc-viewer, element-list-renderer, .artifact-content, .content, [class*="content"], [class*="body"]'
        );
      }

      if (!contentEl) {
        contentEl = container.querySelector(
          'labs-tailwind-doc-viewer, element-list-renderer, [contenteditable], .ProseMirror, [class*="content"]'
        ) || container;
      }

      if (!contentEl) {
        console.warn('[MM] NoteCopy : Aucun conteneur de contenu trouvé.');
        return;
      }

      // 3. Générer le HTML nettoyé et convertir ce HTML nettoyé en Markdown structuré via Turndown
      const cleanHtmlBody = cleanHtmlCitations(contentEl);

      let markdownBody = '';
      const converter = window.MM.convertHtmlToMarkdown || window.MM.htmlToMd;
      if (typeof converter === 'function') {
        markdownBody = converter(cleanHtmlBody);
      } else {
        markdownBody = cleanMarkdownCitations(contentEl.textContent || '');
      }

      markdownBody = cleanMarkdownCitations(markdownBody);

      // Combiner le titre avec le contenu
      const fullText = titleText ? `# ${titleText}\n\n${markdownBody}` : markdownBody;
      const fullHtml = titleText ? `<h1>${titleText}</h1>${cleanHtmlBody}` : cleanHtmlBody;

      // 4. Écriture Dual-MIME dans le Presse-papier (text/plain + text/html)
      const blobText = new Blob([fullText], { type: 'text/plain' });
      const blobHtml = new Blob([fullHtml], { type: 'text/html' });

      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': blobText,
          'text/html': blobHtml
        })
      ]);

      console.log(`[MM] Note/Artéfact (${type}) copié sans sources (Dual-MIME text/plain & text/html)`);

      // 5. Feedback visuel sur le bouton
      if (btnElement) {
        const oldTitle = btnElement.title;
        btnElement.classList.add('mm-copy-success');
        btnElement.title = t('noteCopySuccess') || 'Copié sans sources !';

        setTimeout(function () {
          btnElement.classList.remove('mm-copy-success');
          btnElement.title = oldTitle;
        }, 2000);
      }

      // Afficher un dialogue/toast rapide de confirmation si disponible
      if (typeof window.MM.showToast === 'function') {
        window.MM.showToast(t('noteCopySuccess') || 'Copié sans sources !');
      }
    } catch (err) {
      console.error('[MM] Erreur lors de la copie sans sources :', err);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Crée l'icône SVG du bouton Copier sans sources (content_paste Material)
  // ═══════════════════════════════════════════════════════════════════════
  function createNoteCopyIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');

    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d',
      'M19 2h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14' +
      'c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm7 16H5V5h2v2h10V5h2v13z'
    );
    svg.appendChild(path);
    return svg;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Detection & Injection
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Vérifie la présence d'un note-viewer ou artefact md actif et y injecte le bouton "Copier sans sources".
   */
  function checkAndInjectNoteCopy() {
    // Garde-fou préférence active
    if (typeof window.MM.isFeatureEnabled === 'function' && !window.MM.isFeatureEnabled('noteCopy')) {
      const existing = document.querySelectorAll('.mm-note-copy-btn');
      existing.forEach(function (el) { el.remove(); });
      return;
    }

    const containerInfo = findCopyableContainer();
    if (!containerInfo) return;

    const { el: container, type } = containerInfo;

    // Si le bouton est déjà injecté dans ce conteneur, ne rien faire
    if (container.querySelector('.mm-note-copy-btn')) return;

    const copyBtn = createElement('button', {
      className: 'mm-note-copy-btn',
      type: 'button',
      'aria-label': t('noteCopyButton') || 'Copier sans sources',
      title: t('noteCopyTooltip') || 'Copier avec sa mise en page, sans les références aux sources',
      onClick: function (e) {
        e.stopPropagation();
        handleCopyNoteWithoutSources(containerInfo, copyBtn);
      }
    });

    copyBtn.appendChild(createNoteCopyIcon());

    if (type === 'note') {
      // Notes classiques : injection à gauche de la corbeille native
      const deleteBtn = findDeleteButton(container);
      if (deleteBtn && deleteBtn.parentNode) {
        deleteBtn.parentNode.insertBefore(copyBtn, deleteBtn);
        console.log('[MM] NoteCopy : Bouton "Copier sans sources" injecté à gauche de la corbeille (Note classique)');
      } else {
        const titleHeader = container.querySelector('.note-title-container');
        if (titleHeader) {
          titleHeader.appendChild(copyBtn);
          console.log('[MM] NoteCopy : Bouton "Copier sans sources" injecté dans note-title-container (fallback)');
        }
      }
    } else if (type === 'markdown') {
      // Artefact Markdown du Studio
      // 1. Chercher le bouton expand_content (Desktop)
      const allIcons = container.querySelectorAll('mat-icon');
      let expandBtn = null;
      for (const icon of allIcons) {
        if ((icon.textContent || '').trim() === 'expand_content') {
          expandBtn = icon.closest('button');
          break;
        }
      }

      if (expandBtn && expandBtn.parentNode) {
        expandBtn.parentNode.insertBefore(copyBtn, expandBtn);
        console.log('[MM] NoteCopy : Bouton "Copier sans sources" injecté à gauche de expand_content (Desktop Studio .md)');
      } else {
        // 2. Mode Mobile ou Fallback : injection dans l'en-tête de l'artéfact
        const header = container.querySelector('.header, [class*="header"], .title-container, [class*="title"]');
        if (header) {
          header.appendChild(copyBtn);
          console.log('[MM] NoteCopy : Bouton "Copier sans sources" injecté dans le header d\'artéfact (Mobile/Fallback)');
        }
      }
    }
  }

  /**
   * Initialise le module Note Copy.
   */
  function initNoteCopy() {
    checkAndInjectNoteCopy();
    console.log('[MM] Module noteCopy initialisé');
  }

  /**
   * Nettoie les éléments injectés par le module.
   */
  function cleanupNoteCopy() {
    document.querySelectorAll('.mm-note-copy-btn').forEach(function (btn) {
      btn.remove();
    });
    console.log('[MM] Module noteCopy nettoyé');
  }

  // Exposition dans le namespace global MM
  window.MM.initNoteCopy = initNoteCopy;
  window.MM.cleanupNoteCopy = cleanupNoteCopy;
  window.MM.checkAndInjectNoteCopy = checkAndInjectNoteCopy;
})();
