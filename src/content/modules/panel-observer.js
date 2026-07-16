/**
 * panel-observer.js — Magic Manager for NotebookLM
 * Auteur : MTF Karukera — MPL-2.0
 *
 * Observer centralisé et ciblé sur section.source-panel et document.body.
 * Coordonne la détection des éléments dynamiques et l'injection des boutons MM.
 * Intègre un ResizeObserver pour survivre au basculement responsive
 * (desktop 3 colonnes ↔ onglets mobile) de NotebookLM.
 */
(function () {
  'use strict';

  // Le debounce central permet de grouper les rafales de mutations de la SPA
  const DEBOUNCE_DELAY = 250;

  // Délai du second dispatch de sécurité (attrape les hydratations Angular tardives)
  const LATE_DISPATCH_DELAY = 500;

  let panelObserver = null;
  let globalPageObserver = null;
  let resizeObserver = null;
  let currentObservedPanel = null;

  /** État courant du layout (true = desktop 3 colonnes, false = onglets mobile) */
  let isDesktopLayout = null;

  /** Timer du second dispatch retardé pour éviter les doublons */
  let lateDispatchTimer = null;

  /** Indique si un dispatch est déjà en cours d'exécution (protection anti-réentrance synchrone) */
  let isDispatching = false;

  /**
   * Supprime les boutons MM injectés dans le panel-header.
   */
  function cleanupPanelButtons() {
    document.querySelectorAll('.mm-individual-delete-btn, .mm-individual-export-btn').forEach(
      function (btn) { btn.remove(); }
    );
  }

  /**
   * Exécute les mises à jour des boutons batch de façon réactive.
   * Debouncé pour regrouper les rafales de clics et d'événements change.
   */
  const debouncedPanelInteraction = window.MM.debounce(function () {
    if (window.MM.isFeatureEnabled('export') && typeof window.MM.updateBatchExportButtonState === 'function') {
      window.MM.updateBatchExportButtonState();
    }
    if (window.MM.isFeatureEnabled('merge') && typeof window.MM.updateBatchMergeButtonState === 'function') {
      window.MM.updateBatchMergeButtonState();
    }
  }, 150);

  /**
   * Gère le clic dans le panneau des sources pour mettre à jour les boutons batch.
   * Utilise un debounce au lieu d'un setTimeout pour regrouper les interactions rapides.
   */
  function onPanelInteraction() {
    debouncedPanelInteraction();
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

      // Écouter les interactions de clic/changement pour mettre à jour les boutons batch
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
  /**
   * Exécute les injections MM en déconnectant temporairement les observers.
   * Garantit que les mutations générées par l'extension ne déclenchent pas
   * une nouvelle itération, éliminant la boucle infinie à la racine.
   */
  function dispatchCentralInjections() {
    // Protection anti-réentrance synchrone (cas d'appels imbriqués)
    if (isDispatching) return;
    isDispatching = true;

    // Déconnecter les observers AVANT toute modification du DOM
    // — les mutations générées par nos injections seront ainsi silencieuses
    const observeOptions = { childList: true, subtree: true };
    const panelObserveOptions = { childList: true };
    if (globalPageObserver) globalPageObserver.disconnect();
    if (panelObserver && currentObservedPanel) panelObserver.disconnect();

    try {
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

      // 5. Injections individuelles (Poubelle & Export) s'il y a un source-viewer actif
      const sourceViewer = document.querySelector('source-viewer');
      if (sourceViewer) {
        if (window.MM.isFeatureEnabled('delete') && typeof window.MM.checkAndInjectIndividualDelete === 'function') {
          window.MM.checkAndInjectIndividualDelete();
        }
        if (window.MM.isFeatureEnabled('export') && typeof window.MM.checkAndInjectIndividualExport === 'function') {
          window.MM.checkAndInjectIndividualExport();
        }
      }

      // 6. Mise à jour des boutons batch (export + merge)
      // Protégé contre la boucle par le disconnect/reconnect des observers ci-dessus.
      // L'idempotence interne des fonctions évite toute mutation DOM redondante.
      if (window.MM.isFeatureEnabled('export') && typeof window.MM.updateBatchExportButtonState === 'function') {
        window.MM.updateBatchExportButtonState();
      }
      if (window.MM.isFeatureEnabled('merge') && typeof window.MM.updateBatchMergeButtonState === 'function') {
        window.MM.updateBatchMergeButtonState();
      }
    } catch (err) {
      console.error('[MM] Erreur lors des injections globales :', err);
    } finally {
      // Reconnecter les observers APRÈS toutes les modifications
      if (globalPageObserver) globalPageObserver.observe(document.body, observeOptions);
      if (panelObserver && currentObservedPanel) panelObserver.observe(currentObservedPanel, panelObserveOptions);
      isDispatching = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Détection du changement de layout responsive
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Détecte si le layout courant est en mode desktop (3 colonnes) ou mobile (onglets).
   * Vérifie la VISIBILITÉ RÉELLE des panneaux (pas leur simple présence dans le DOM),
   * car Angular masque les panneaux via CSS en mode onglets sans les supprimer du DOM.
   * @returns {boolean} true si le layout desktop est détecté.
   */
  function detectDesktopLayout() {
    const sourcePanel = document.querySelector('section.source-panel');
    const chatPanel = document.querySelector('section.chat-panel, [class*="chat-panel"]');

    // Vérifier que les deux panneaux sont VISIBLES (pas juste présents dans le DOM)
    // offsetParent === null pour les éléments masqués via display:none
    // getBoundingClientRect().width > 0 comme fallback si visibility:hidden est utilisé
    function isVisible(el) {
      if (!el) return false;
      if (el.offsetParent !== null) return true;
      // Fallback pour les éléments avec position:fixed ou visibility:hidden
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    return isVisible(sourcePanel) && isVisible(chatPanel);
  }

  /**
   * Callback du ResizeObserver — détecte le basculement de layout et force
   * un cycle complet de réinjection uniquement si le mode a changé.
   */
  const onLayoutResize = window.MM.debounce(function () {
    const currentLayout = detectDesktopLayout();

    // Ne réagir que si le layout a effectivement changé (franchissement de seuil)
    if (isDesktopLayout !== currentLayout) {
      const previousLayout = isDesktopLayout;
      isDesktopLayout = currentLayout;
      console.log(
        '[MM] Changement de layout détecté :',
        previousLayout === null ? 'initial' : (previousLayout ? 'desktop' : 'mobile'),
        '→', currentLayout ? 'desktop' : 'mobile'
      );

      // Premier dispatch immédiat pour la reconstruction rapide
      dispatchCentralInjections();

      // Mettre à jour les boutons batch après changement de layout
      // (ne pas inclure dans dispatchCentralInjections pour éviter les boucles)
      if (window.MM.isFeatureEnabled('export') && typeof window.MM.updateBatchExportButtonState === 'function') {
        window.MM.updateBatchExportButtonState();
      }
      if (window.MM.isFeatureEnabled('merge') && typeof window.MM.updateBatchMergeButtonState === 'function') {
        window.MM.updateBatchMergeButtonState();
      }

      // Second dispatch retardé — filet de sécurité pour les hydratations Angular tardives
      if (lateDispatchTimer) {
        clearTimeout(lateDispatchTimer);
      }
      lateDispatchTimer = setTimeout(function () {
        lateDispatchTimer = null;
        dispatchCentralInjections();
        console.debug('[MM] Second dispatch post-resize exécuté (filet de sécurité)');
      }, LATE_DISPATCH_DELAY);
    }
  }, 500);

  // ═══════════════════════════════════════════════════════════════════════
  // Cycle de vie
  // ═══════════════════════════════════════════════════════════════════════

  function initPanelObserver() {
    if (globalPageObserver) return;

    // Initialiser l'état du layout courant
    isDesktopLayout = detectDesktopLayout();

    // MutationObserver central et unique sur document.body
    globalPageObserver = new MutationObserver(window.MM.debounce(function () {
      dispatchCentralInjections();
    }, DEBOUNCE_DELAY));

    globalPageObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    // ResizeObserver pour détecter les basculements de layout responsive
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(onLayoutResize);
      resizeObserver.observe(document.documentElement);
      console.log('[MM] ResizeObserver initialisé pour la détection de layout responsive');
    }

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
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (lateDispatchTimer) {
      clearTimeout(lateDispatchTimer);
      lateDispatchTimer = null;
    }
    if (currentObservedPanel) {
      currentObservedPanel.removeEventListener('click', onPanelInteraction);
      currentObservedPanel.removeEventListener('change', onPanelInteraction);
      currentObservedPanel = null;
    }
    cleanupPanelButtons();
    const mobileHeader = document.querySelector('.mm-sticky-header');
    if (mobileHeader) {
      mobileHeader.remove();
    }
    isDesktopLayout = null;
    console.log('[MM] Observer global de page centralisé nettoyé');
  }

  window.MM.initPanelObserver = initPanelObserver;
  window.MM.cleanupPanelObserver = cleanupPanelObserver;
})();
