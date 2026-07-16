/**
 * panel-observer.js — Magic Manager for NotebookLM
 * Auteur : MTF Karukera — MPL-2.0
 *
 * Observer centralisé et ciblé sur section.source-panel et document.body.
 * Coordonne la détection des éléments dynamiques et l'injection des boutons MM.
 */
(function () {
  'use strict';

  // Le debounce central permet de grouper les rafales de mutations de la SPA
  const DEBOUNCE_DELAY = 250;

  let panelObserver = null;
  let globalPageObserver = null;
  let currentObservedPanel = null;

  /**
   * Supprime les boutons MM injectés dans le panel-header.
   */
  function cleanupPanelButtons() {
    document.querySelectorAll('.mm-individual-delete-btn, .mm-individual-export-btn').forEach(
      function (btn) { btn.remove(); }
    );
  }

  /**
   * Gère le clic dans le panneau des sources pour mettre à jour les boutons batch de façon réactive.
   */
  function onPanelInteraction() {
    // Petit délai pour laisser Angular mettre à jour les attributs de sélection (checked, state...)
    setTimeout(function () {
      if (window.MM.isFeatureEnabled('export') && typeof window.MM.updateBatchExportButtonState === 'function') {
        window.MM.updateBatchExportButtonState();
      }
      if (window.MM.isFeatureEnabled('merge') && typeof window.MM.updateBatchMergeButtonState === 'function') {
        window.MM.updateBatchMergeButtonState();
      }
    }, 100);
  }

  /**
   * Callback exécuté à chaque mutation d'enfants dans section.source-panel.
   * Détecte l'apparition/disparition de source-viewer pour injecter les boutons individuels.
   */
  function onPanelMutation() {
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
      if (currentObservedPanel) {
        currentObservedPanel.removeEventListener('click', onPanelInteraction);
        currentObservedPanel.removeEventListener('change', onPanelInteraction);
      }

      // Observer local léger : uniquement childList de premier niveau (pas subtree, pas d'attributes)
      panelObserver = new MutationObserver(onPanelMutation);
      panelObserver.observe(sourcePanel, {
        childList: true
      });

      // Écouter les interactions de clic/changement pour mettre à jour les boutons batch de façon performante
      sourcePanel.addEventListener('click', onPanelInteraction);
      sourcePanel.addEventListener('change', onPanelInteraction);

      currentObservedPanel = sourcePanel;
      console.log('[MM] Panel observer connecté à la nouvelle instance de section.source-panel (mode léger + events)');
      
      // Exécuter une première vérification des éléments
      onPanelMutation();
      onPanelInteraction();
    }
    // Cas 2 : Le panneau a été détruit/retiré du DOM actif
    else if (!sourcePanel && currentObservedPanel) {
      if (panelObserver) {
        panelObserver.disconnect();
        panelObserver = null;
      }
      if (currentObservedPanel) {
        currentObservedPanel.removeEventListener('click', onPanelInteraction);
        currentObservedPanel.removeEventListener('change', onPanelInteraction);
      }
      currentObservedPanel = null;
      cleanupPanelButtons();
      console.log('[MM] Panel observer déconnecté (panneau absent du DOM)');
    }
  }

  /**
   * Exécute les vérifications et injections pour l'ensemble des modules actifs.
   * Appelé de manière centralisée lors des mutations globales.
   */
  function dispatchCentralInjections() {
    // 1. Gérer l'observation du panneau des sources
    tryObservePanel();

    // 2. Recherche : Barre de recherche
    if (window.MM.isFeatureEnabled('search') && typeof window.MM.checkAndInjectSearch === 'function') {
      window.MM.checkAndInjectSearch();
    }

    // 3. Chat Export : Bouton d'export de conversation
    if (window.MM.isFeatureEnabled('chatExport') && typeof window.MM.checkAndInjectChatExport === 'function') {
      window.MM.checkAndInjectChatExport();
    }

    // 4. Syntaxe : Coloration des blocs de code
    if (window.MM.isFeatureEnabled('syntax') && typeof window.MM.scanAndHighlight === 'function') {
      window.MM.scanAndHighlight();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Cycle de vie
  // ═══════════════════════════════════════════════════════════════════════

  function initPanelObserver() {
    if (globalPageObserver) return;

    // MutationObserver central et unique sur document.body
    globalPageObserver = new MutationObserver(window.MM.debounce(function () {
      dispatchCentralInjections();
    }, DEBOUNCE_DELAY));

    globalPageObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Lancer une première détection immédiate
    dispatchCentralInjections();
    console.log('[MM] Observer global de page centralisé initialisé');
  }

  function cleanupPanelObserver() {
    if (globalPageObserver) {
      globalPageObserver.disconnect();
      globalPageObserver = null;
    }
    if (panelObserver) {
      panelObserver.disconnect();
      panelObserver = null;
    }
    if (currentObservedPanel) {
      currentObservedPanel.removeEventListener('click', onPanelInteraction);
      currentObservedPanel.removeEventListener('change', onPanelInteraction);
      currentObservedPanel = null;
    }
    cleanupPanelButtons();
    console.log('[MM] Observer global de page centralisé nettoyé');
  }

  window.MM.initPanelObserver = initPanelObserver;
  window.MM.cleanupPanelObserver = cleanupPanelObserver;
})();
