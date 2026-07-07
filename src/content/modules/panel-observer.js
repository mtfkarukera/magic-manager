/**
 * panel-observer.js — Magic Manager for NotebookLM
 * Auteur : MTF Karukera — MPL-2.0
 *
 * Observer centralisé et ciblé sur section.source-panel.
 * Remplace les deux observers séparés de delete.js et export.js sur document.body.
 *
 * Responsabilités :
 *  - Détecter l'apparition de source-viewer → injecter les boutons MM
 *  - Détecter la disparition de source-viewer → nettoyer les boutons MM
 *  - Scope restreint à section.source-panel (perf >> document.body)
 */
(function () {
  'use strict';

  // Délai de debounce pour limiter les appels répétés lors des rafales de mutations
  const DEBOUNCE_DELAY = 200;

  let panelObserver = null;
  let debounceTimer = null;

  /**
   * Supprime les boutons MM injectés dans le panel-header.
   */
  function cleanupPanelButtons() {
    document.querySelectorAll('.mm-individual-delete-btn, .mm-individual-export-btn').forEach(
      function (btn) { btn.remove(); }
    );
  }

  /**
   * Callback exécuté à chaque mutation dans section.source-panel.
   * Vérifie la présence de source-viewer et agit en conséquence.
   */
  function onPanelMutation() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      const sourceViewer = document.querySelector('source-viewer');

      if (sourceViewer) {
        // source-viewer présent → s'assurer que les boutons sont injectés
        if (typeof window.MM.checkAndInjectIndividualDelete === 'function') {
          window.MM.checkAndInjectIndividualDelete();
        }
        if (typeof window.MM.checkAndInjectIndividualExport === 'function') {
          window.MM.checkAndInjectIndividualExport();
        }
      } else {
        // source-viewer absent → nettoyer les boutons orphelins
        cleanupPanelButtons();
      }

      // Toujours rafraîchir l'état des boutons batch (fusion, export par lot)
      if (typeof window.MM.updateBatchExportButtonState === 'function') {
        window.MM.updateBatchExportButtonState();
      }
      if (typeof window.MM.updateBatchMergeButtonState === 'function') {
        window.MM.updateBatchMergeButtonState();
      }
    }, DEBOUNCE_DELAY);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Cycle de vie
  // ═══════════════════════════════════════════════════════════════════════

  function initPanelObserver() {
    if (panelObserver) return;

    // Attendre que section.source-panel soit dans le DOM
    // (il apparaît quelques instants après document_idle sur les SPA)
    function tryObserve() {
      const sourcePanel = document.querySelector('section.source-panel');
      if (!sourcePanel) {
        // Réessayer après un court délai si le panel n'est pas encore là
        setTimeout(tryObserve, 500);
        return;
      }

      panelObserver = new MutationObserver(onPanelMutation);

      // Scope restreint : uniquement section.source-panel (pas document.body)
      // On observe aussi les attributs pour capturer le cochage/décochage des cases
      panelObserver.observe(sourcePanel, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'aria-checked', 'checked', 'state', 'aria-selected']
      });

      // Vérification initiale au démarrage
      onPanelMutation();

      console.log('[MM] Panel observer initialisé sur section.source-panel');
    }

    tryObserve();
  }

  function cleanupPanelObserver() {
    clearTimeout(debounceTimer);
    if (panelObserver) {
      panelObserver.disconnect();
      panelObserver = null;
    }
    cleanupPanelButtons();
    console.log('[MM] Panel observer nettoyé');
  }

  window.MM.initPanelObserver = initPanelObserver;
  window.MM.cleanupPanelObserver = cleanupPanelObserver;
})();
