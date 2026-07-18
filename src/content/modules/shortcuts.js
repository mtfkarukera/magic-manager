// shortcuts.js — Centralisation et écouteurs des raccourcis clavier
// Auteur : MTF Karukera | Licence : MPL-2.0

(function() {
  'use strict';

  // Namespace global
  window.MM = window.MM || {};

  let isInitialized = false;

  console.log('[MM] Module shortcuts chargé.');

  /**
   * Focus le champ de saisie du chat central de NotebookLM.
   */
  function focusChatInput() {
    const selectors = [
      'section.chat-panel textarea',
      'chat-input textarea',
      'textarea[placeholder*="notebook"]',
      'textarea[placeholder*="carnet"]',
      'textarea[placeholder*="Ask"]',
      'textarea[placeholder*="Poser"]',
      'textarea' // Fallback général
    ];

    for (const sel of selectors) {
      const input = document.querySelector(sel);
      if (input && input.offsetParent !== null) { // Vérifier que l'élément est visible
        input.focus();
        // Placer le curseur à la fin du texte si nécessaire
        const len = input.value.length;
        input.setSelectionRange(len, len);
        console.log('[MM] Focus placé sur le champ de saisie du chat.');
        return true;
      }
    }
    console.warn('[MM] Impossible de localiser le champ de saisie du chat central.');
    return false;
  }

  /**
   * Gère les événements clavier globaux (keydown).
   */
  function handleKeyDown(e) {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

    // Raccourci 1 : Recherche dans le Studio (Ctrl+Alt+F ou Cmd+Option+F)
    const matchesStudioSearch = (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'f') ||
                                (isMac && e.metaKey && e.altKey && e.key.toLowerCase() === 'f');

    if (matchesStudioSearch) {
      e.preventDefault();
      if (typeof window.MM.studioSearch.focusStudioSearch === 'function') {
        window.MM.studioSearch.focusStudioSearch();
      }
      return;
    }

    // Raccourci 2 : Focus sur le chat central (Ctrl+Shift+E ou Cmd+Shift+E)
    const matchesChatFocus = (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'e') ||
                             (isMac && e.metaKey && e.shiftKey && e.key.toLowerCase() === 'e');

    if (matchesChatFocus) {
      e.preventDefault();
      focusChatInput();
      return;
    }

    // Raccourci 3 : Recherche de sources (Ctrl+Shift+F ou Cmd+Shift+F)
    const matchesSourceSearch = (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') ||
                                (isMac && e.metaKey && e.shiftKey && e.key.toLowerCase() === 'f');

    if (matchesSourceSearch) {
      e.preventDefault();
      if (typeof window.MM.focusSourceSearch === 'function') {
        window.MM.focusSourceSearch();
      }
      return;
    }
  }

  /**
   * Initialise les écouteurs de raccourcis clavier.
   */
  function initShortcuts() {
    if (isInitialized) return;

    window.addEventListener('keydown', handleKeyDown, true);
    isInitialized = true;
    console.log('[MM] Raccourcis clavier globaux activés.');
  }

  /**
   * Désactive proprement les écouteurs.
   */
  function cleanupShortcuts() {
    if (!isInitialized) return;

    window.removeEventListener('keydown', handleKeyDown, true);
    isInitialized = false;
    console.log('[MM] Raccourcis clavier globaux désactivés.');
  }

  // Exposition publique pour l'orchestrateur
  window.MM.shortcuts = {
    init: initShortcuts,
    cleanup: cleanupShortcuts,
    focusChatInput: focusChatInput
  };

})();
