// shortcuts.js — Module centralisé de raccourcis clavier
// Auteur : MTF Karukera | Licence : MPL-2.0
// Dépendance : window.MM (utils.js chargé avant)

'use strict';

(function () {
  // Sélecteurs CSS pour les champs cibles
  const SEARCH_INPUT = '.mm-search-input';
  const STUDIO_SEARCH_INPUT = '.mm-studio-search-input';
  const CHAT_INPUT_SELECTORS = [
    'chat-input textarea',
    'section.chat-panel textarea',
    '.ql-editor[contenteditable="true"]',
    'textarea[placeholder*="question"]',
    'textarea[placeholder*="Posez"]',
    'textarea[placeholder*="Ask"]',
    'textarea[placeholder*="typing"]',
    'textarea[aria-label*="typing"]',
    'textarea' // Fallback général
  ];

  /**
   * Tente de focaliser le premier élément correspondant à un sélecteur CSS.
   * @param {string|string[]} selectors
   * @param {boolean} shouldSelect - Si true, sélectionne tout le texte
   * @returns {boolean} true si un élément a été focalisé
   */
  function focusFirst(selectors, shouldSelect = false) {
    const list = Array.isArray(selectors) ? selectors : [selectors];
    for (const sel of list) {
      const el = document.querySelector(sel);
      if (el) {
        el.focus();
        if (shouldSelect && typeof el.select === 'function') {
          el.select();
        } else if (el.tagName === 'TEXTAREA') {
          // Placer le curseur à la fin
          const len = el.value.length;
          if (typeof el.setSelectionRange === 'function') {
            el.setSelectionRange(len, len);
          }
        }
        return true;
      }
    }
    return false;
  }

  /**
   * Handler global keydown.
   * @param {KeyboardEvent} e
   */
  function handleShortcut(e) {
    // Si la feature n'est pas activée, on ne fait rien
    if (typeof window.MM.isFeatureEnabled === 'function' && !window.MM.isFeatureEnabled('shortcuts')) {
      return;
    }

    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
    const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
    const key = e.key.toLowerCase();

    // Cmd/Ctrl + Shift + F → Focus recherche sources
    if (cmdOrCtrl && e.shiftKey && !e.altKey && key === 'f') {
      if (focusFirst(SEARCH_INPUT, true)) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }

    // Option/Alt + Shift + F → Focus recherche Studio (Sprint 4)
    if (e.altKey && e.shiftKey && !cmdOrCtrl && key === 'f') {
      if (focusFirst(STUDIO_SEARCH_INPUT, true)) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }

    // Cmd/Ctrl + Shift + E → Focus saisie chat
    if (cmdOrCtrl && e.shiftKey && !e.altKey && key === 'e') {
      if (focusFirst(CHAT_INPUT_SELECTORS, false)) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
  }

  function initShortcuts() {
    document.removeEventListener('keydown', handleShortcut, true);
    document.addEventListener('keydown', handleShortcut, true);
    console.log('[MM] Module raccourcis clavier initialisé');
  }

  function cleanupShortcuts() {
    document.removeEventListener('keydown', handleShortcut, true);
    console.log('[MM] Module raccourcis clavier nettoyé');
  }

  window.MM.initShortcuts = initShortcuts;
  window.MM.cleanupShortcuts = cleanupShortcuts;
})();
