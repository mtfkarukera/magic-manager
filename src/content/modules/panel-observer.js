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
  let globalPageObserver = null;
  let currentObservedPanel = null;
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
        // source-viewer présent → s'assurer que les boutons sont injectés (si les features sont actives)
        if (window.MM.isFeatureEnabled('delete') && typeof window.MM.checkAndInjectIndividualDelete === 'function') {
          window.MM.checkAndInjectIndividualDelete();
        }
        if (window.MM.isFeatureEnabled('export') && typeof window.MM.checkAndInjectIndividualExport === 'function') {
          window.MM.checkAndInjectIndividualExport();
        }
      } else {
        // source-viewer absent → nettoyer les boutons orphelins
        cleanupPanelButtons();
      }

      // Toujours rafraîchir l'état des boutons batch (fusion, export par lot) si actifs
      if (window.MM.isFeatureEnabled('export') && typeof window.MM.updateBatchExportButtonState === 'function') {
        window.MM.updateBatchExportButtonState();
      } else if (typeof window.MM.updateBatchExportButtonState === 'function') {
        // Retirer le bouton si la feature a été désactivée
        const btn = document.querySelector('.mm-batch-export-btn');
        if (btn) btn.remove();
      }

      if (window.MM.isFeatureEnabled('merge') && typeof window.MM.updateBatchMergeButtonState === 'function') {
        window.MM.updateBatchMergeButtonState();
      } else if (typeof window.MM.updateBatchMergeButtonState === 'function') {
        // Retirer le bouton si la feature a été désactivée
        const btn = document.querySelector('.mm-batch-merge-btn');
        if (btn) btn.remove();
      }
    }, DEBOUNCE_DELAY);
  }

  /**
   * Tente de connecter le MutationObserver de panneau sur l'élément actif du DOM.
   */
  function tryObservePanel() {
    const sourcePanel = document.querySelector('section.source-panel');

    // Cas 1 : Nouveau panneau détecté
    if (sourcePanel && sourcePanel !== currentObservedPanel) {
      if (panelObserver) {
        panelObserver.disconnect();
      }

      panelObserver = new MutationObserver(onPanelMutation);
      panelObserver.observe(sourcePanel, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'aria-checked', 'checked', 'state', 'aria-selected']
      });

      currentObservedPanel = sourcePanel;
      console.log('[MM] Panel observer connecté à la nouvelle instance de section.source-panel');
      onPanelMutation();
    }
    // Cas 2 : Le panneau a été détruit/retiré du DOM actif
    else if (!sourcePanel && currentObservedPanel) {
      if (panelObserver) {
        panelObserver.disconnect();
        panelObserver = null;
      }
      currentObservedPanel = null;
      cleanupPanelButtons();
      console.log('[MM] Panel observer déconnecté (panneau absent du DOM)');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Cycle de vie
  // ═══════════════════════════════════════════════════════════════════════

  function initPanelObserver() {
    if (globalPageObserver) return;

    // MutationObserver global sur document.body pour détecter les changements de carnet
    globalPageObserver = new MutationObserver(window.MM.debounce(function () {
      tryObservePanel();
    }, 200));

    globalPageObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Lancer une première détection immédiate
    tryObservePanel();
    console.log('[MM] Observer global de page initialisé dans panel-observer.js');
  }

  function cleanupPanelObserver() {
    clearTimeout(debounceTimer);
    if (globalPageObserver) {
      globalPageObserver.disconnect();
      globalPageObserver = null;
    }
    if (panelObserver) {
      panelObserver.disconnect();
      panelObserver = null;
    }
    currentObservedPanel = null;
    cleanupPanelButtons();
    console.log('[MM] Panel observer nettoyé complet');
  }

  window.MM.initPanelObserver = initPanelObserver;
  window.MM.cleanupPanelObserver = cleanupPanelObserver;
})();
