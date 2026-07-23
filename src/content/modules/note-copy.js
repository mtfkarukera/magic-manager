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
   * Nettoie le texte brut (Markdown) en retirant toutes les citations [1], [2], [1, 2].
   * @param {string} text
   * @returns {string}
   */
  function cleanMarkdownCitations(text) {
    if (!text) return '';
    return text
      // Retirer les motifs de citations crochets [1], [2], [1, 2], [10, 11]
      .replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, '')
      // Retirer les résidus de mots-clés d'icônes Google Symbols (more_horiz, lock)
      .replace(/\b(more_horiz|lock)\b/g, '')
      // Nettoyer les espaces multiples superflus
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  /**
   * Nettoie un élément HTML de note en supprimant les balises de citations et puces de sources,
   * puis normalise les composants Tailwind Angular en balises HTML5 standards (p, h1-h4, blockquote, li).
   * @param {Element} contentNode
   * @returns {string}
   */
  function cleanHtmlCitations(contentNode) {
    if (!contentNode) return '';

    // Cloner le nœud pour travailler sur une copie isolée du DOM live
    const clone = contentNode.cloneNode(true);

    // 1. Supprimer les éléments de citations connus dans NotebookLM
    const citationSelectors = [
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
      'button[dialoglabel*="Citation" i]'
    ];

    citationSelectors.forEach(function (sel) {
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

    // 2. Normaliser les Web Components & classes Tailwind de NotebookLM en balises HTML5 sémantiques (h1-h4, p, blockquote, li)
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

    // Nettoyer le texte restant dans le clone HTML pour supprimer les reliquats [1]
    let html = clone.innerHTML || '';
    html = html.replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, '');

    return html;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Heuristiques de Détection DOM
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Trouve le conteneur principal de la note active ouverte.
   * @returns {Element|null}
   */
  function findNoteContainer() {
    // 1. Exclure explicitement tous les artefacts non-notes (infographies, cartes mentales, résumés audio, etc.)
    const activeArtifact = document.querySelector(
      'artifact-viewer, [class*="artifact-view"], [class*="infographic"], [class*="mindmap"], [class*="audio-player"]'
    );

    // 2. Balises et classes exactes de NotebookLM pour les NOTES textuelles uniquement
    const explicit = document.querySelector('note-editor, .note-editor, form.note-form, .note-title-container');
    if (explicit) {
      // S'assurer qu'il ne s'agit pas d'un sous-élément d'artefact
      if (!explicit.closest('artifact-viewer, [class*="artifact-view"]')) {
        return explicit.closest('note-editor, form.note-form') || explicit;
      }
    }

    // 3. Fallback via le bouton corbeille natif DE NOTE uniquement (note-editor-delete-button)
    const deleteBtn = document.querySelector('button.note-editor-delete-button');
    if (deleteBtn && !deleteBtn.closest('artifact-viewer, [class*="artifact-view"]')) {
      return deleteBtn.closest('note-editor, form.note-form, div.note-title-container') || deleteBtn.parentElement;
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
   * Extrait le titre et le contenu de la note active et effectue la copie Dual-MIME sans sources.
   * @param {Element} noteContainer
   * @param {HTMLButtonElement} btnElement
   */
  async function handleCopyNoteWithoutSources(noteContainer, btnElement) {
    try {
      if (!noteContainer) {
        noteContainer = findNoteContainer();
      }
      if (!noteContainer) return;

      // 1. Extraire le titre de la note (cibler uniquement les champs de saisie ou balises H1-H3)
      let titleText = '';
      const inputEl = noteContainer.querySelector(
        'input.note-header__editable-title, input[aria-label*="titre" i], input[formcontrolname="name"], input.title-input'
      );
      if (inputEl && typeof inputEl.value === 'string' && inputEl.value.trim().length > 0) {
        titleText = inputEl.value.trim();
      } else {
        const headingEl = noteContainer.querySelector('h1, h2, h3');
        if (headingEl && headingEl.textContent && headingEl.textContent.trim().length > 0) {
          titleText = headingEl.textContent.trim();
        }
      }

      // Garde-fou ultime : si le titre extrait est anormalement le mot de l'icône corbeille, l'ignorer
      if (titleText.toLowerCase() === 'delete' || titleText.toLowerCase() === 'delete_outline') {
        titleText = '';
      }

      // 2. Extraire le corps de la note
      const contentEl = noteContainer.querySelector(
        'labs-tailwind-doc-viewer, element-list-renderer, .note-editor--readonly, .content, .note-content, [contenteditable], .ProseMirror, [class*="content"], [class*="body"]'
      ) || noteContainer;

      if (!contentEl) {
        console.warn('[MM] NoteCopy : Aucun conteneur de contenu trouvé dans la note.');
        return;
      }

      // 3. Générer le HTML nettoyé et convertir ce HTML nettoyé en Markdown riche via Turndown (html-to-md.js)
      const cleanHtmlBody = cleanHtmlCitations(contentEl);

      let markdownBody = '';
      const converter = window.MM.convertHtmlToMarkdown || window.MM.htmlToMd;
      if (typeof converter === 'function') {
        markdownBody = converter(cleanHtmlBody);
      } else {
        const rawTextBody = contentEl.textContent || '';
        markdownBody = cleanMarkdownCitations(rawTextBody);
      }

      // Purger d'éventuels résidus parasites dans le Markdown
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

      console.log('[MM] Note copiée sans sources (Dual-MIME text/plain & text/html)');

      // 5. Feedback visuel sur le bouton
      if (btnElement) {
        const oldTitle = btnElement.title;
        btnElement.classList.add('mm-copy-success');
        btnElement.title = t('noteCopySuccess') || 'Note copiée sans sources !';

        setTimeout(function () {
          btnElement.classList.remove('mm-copy-success');
          btnElement.title = oldTitle;
        }, 2000);
      }

      // Afficher un dialogue/toast rapide de confirmation si disponible
      if (typeof window.MM.showToast === 'function') {
        window.MM.showToast(t('noteCopySuccess') || 'Note copiée sans sources !');
      }
    } catch (err) {
      console.error('[MM] Erreur lors de la copie de la note sans sources :', err);
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
   * Vérifie la présence d'un note-viewer actif et y injecte le bouton "Copier sans sources"
   * immédiatement à gauche de l'icône corbeille (suppression native).
   */
  function checkAndInjectNoteCopy() {
    // Garde-fou préférence active
    if (typeof window.MM.isFeatureEnabled === 'function' && !window.MM.isFeatureEnabled('noteCopy')) {
      const existing = document.querySelectorAll('.mm-note-copy-btn');
      existing.forEach(function (el) { el.remove(); });
      return;
    }

    const noteContainer = findNoteContainer();
    if (!noteContainer) return;

    // Si le bouton est déjà injecté dans ce conteneur, ne rien faire
    if (noteContainer.querySelector('.mm-note-copy-btn')) return;

    // Chercher le bouton de suppression natif (icône corbeille) pour l'utiliser comme ancre
    const deleteBtn = findDeleteButton(noteContainer);

    const copyBtn = createElement('button', {
      className: 'mm-note-copy-btn',
      type: 'button',
      'aria-label': t('noteCopyButton') || 'Copier sans sources',
      title: t('noteCopyTooltip') || 'Copier la note avec sa mise en page, sans les références aux sources',
      onClick: function (e) {
        e.stopPropagation();
        handleCopyNoteWithoutSources(noteContainer, copyBtn);
      }
    });

    copyBtn.appendChild(createNoteCopyIcon());

    if (deleteBtn && deleteBtn.parentNode) {
      // Injecter le bouton immédiatement à gauche de l'icône corbeille
      deleteBtn.parentNode.insertBefore(copyBtn, deleteBtn);
      console.log('[MM] NoteCopy : Bouton "Copier sans sources" injecté à gauche de la corbeille');
    } else {
      // Fallback strict : injecter uniquement dans la barre de titre explicite d'une note
      const titleHeader = noteContainer.querySelector('.note-title-container');
      if (titleHeader) {
        titleHeader.appendChild(copyBtn);
        console.log('[MM] NoteCopy : Bouton "Copier sans sources" injecté dans note-title-container (fallback)');
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
