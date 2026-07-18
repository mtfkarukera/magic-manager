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
  let globalObservedTarget = null;

  // Références des handlers filtrés pour permettre le removeEventListener
  let panelClickHandler = null;
  let panelChangeHandler = null;

  /** État courant du layout (true = desktop 3 colonnes, false = onglets mobile) */
  let isDesktopLayout = null;

  /** Timer du second dispatch retardé pour éviter les doublons */
  let lateDispatchTimer = null;

  /** Timer du clic sur onglet mobile pour nettoyage */
  let tabClickTimer = null;

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

  /** Sélecteurs CSS des checkboxes natives Gemini Notebook (Angular Material) */
  const CHECKBOX_SELECTOR = 'mat-pseudo-checkbox, .mat-pseudo-checkbox, [role="checkbox"], input[type="checkbox"]';

  /**
   * Callback exécuté à chaque mutation d'enfants dans section.source-panel.
   * Détecte l'apparition/disparition de source-viewer pour injecter les boutons individuels.
   */
  /**
   * Callback exécuté à chaque mutation dans section.source-panel.
   * Détecte l'apparition/disparition de source-viewer pour injecter les boutons individuels,
   * ainsi que les changements d'état des checkboxes pour les boutons de lot.
   * @param {MutationRecord[]} [mutations] - Liste des mutations (undefined lors de l'appel initial).
   */
  function onPanelMutation(mutations) {
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

    // Détecter si la mutation est pertinente pour un recalcul des boutons batch.
    // Cela évite la surécoute CPU en ignorant les mutations cosmétiques (survol souris, scroll).
    let shouldRecalculate = false;
    if (mutations) {
      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i];
        if (m.type === 'childList') {
          // Ajout ou suppression de nœuds (cartes de sources, chargement initial, etc.)
          shouldRecalculate = true;
          break;
        } else if (m.type === 'attributes') {
          const target = m.target;
          // Si le changement concerne une checkbox (Angular Material mat-pseudo-checkbox)
          if (target && (target.matches(CHECKBOX_SELECTOR) || target.closest(CHECKBOX_SELECTOR))) {
            shouldRecalculate = true;
            break;
          }
        }
      }
    } else {
      // Pas de mutations passées (appel initial/fallback) → recalculer par sécurité
      shouldRecalculate = true;
    }

    if (shouldRecalculate) {
      debouncedPanelInteraction();
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

      // Observer local du panneau avec subtree pour capter l'apparition des sources
      // et attributes avec attributeFilter pour capter l'état des checkboxes Angular en temps réel.
      panelObserver = new MutationObserver(onPanelMutation);
      panelObserver.observe(sourcePanel, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'aria-checked']
      });

      currentObservedPanel = sourcePanel;
      console.log('[MM] Panel observer connecté (childList + attributes checkboxes)');
      
      // Exécuter une première vérification des éléments
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
    const panelObserveOptions = { childList: true, subtree: true };
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
    } catch (err) {
      console.error('[MM] Erreur lors des injections globales :', err);
    } finally {
      // Reconnecter les observers APRÈS toutes les modifications
      if (globalPageObserver && globalObservedTarget) globalPageObserver.observe(globalObservedTarget, observeOptions);
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
  // Cycle de vie et gestion des onglets
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Gère les clics sur les onglets mobiles pour forcer une réévaluation de l'UI.
   * Angular Material modifie les classes de visibilité des conteneurs sans
   * muter la structure globale d'enfants (invisible pour l'observer global).
   * @param {MouseEvent} e - L'événement de clic.
   */
  function handleTabClick(e) {
    const tab = e.target.closest('.mat-mdc-tab, [role="tab"], .mat-tab-label');
    if (tab) {
      console.log('[MM] Clic onglet détecté (mobile), planification du rafraîchissement UI...');
      if (tabClickTimer) {
        clearTimeout(tabClickTimer);
      }
      // Laisser Angular effectuer la transition d'onglet et hydrater le DOM
      tabClickTimer = setTimeout(function () {
        tabClickTimer = null;
        dispatchCentralInjections();
        if (window.MM.isFeatureEnabled('export') && typeof window.MM.updateBatchExportButtonState === 'function') {
          window.MM.updateBatchExportButtonState();
        }
        if (window.MM.isFeatureEnabled('merge') && typeof window.MM.updateBatchMergeButtonState === 'function') {
          window.MM.updateBatchMergeButtonState();
        }
      }, 300);
    }
  }

  function initPanelObserver() {
    if (globalPageObserver) return;

    // Initialiser l'état du layout courant
    isDesktopLayout = detectDesktopLayout();

    // MutationObserver central et ciblé sur la racine de l'application
    globalPageObserver = new MutationObserver(window.MM.debounce(function () {
      dispatchCentralInjections();
    }, DEBOUNCE_DELAY));

    globalObservedTarget = document.querySelector('app-root, [class*="app-root"]') || document.body;
    globalPageObserver.observe(globalObservedTarget, {
      childList: true,
      subtree: true
    });

    // Écouter explicitement les clics sur les onglets mobiles
    document.addEventListener('click', handleTabClick);

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
    if (tabClickTimer) {
      clearTimeout(tabClickTimer);
      tabClickTimer = null;
    }
    if (currentObservedPanel) {
      currentObservedPanel = null;
    }
    document.removeEventListener('click', handleTabClick);
    panelClickHandler = null;
    panelChangeHandler = null;
    cleanupPanelButtons();
    const mobileHeader = document.querySelector('.mm-sticky-header');
    if (mobileHeader) {
      mobileHeader.remove();
    }
    isDesktopLayout = null;
    globalObservedTarget = null;
    console.log('[MM] Observer global de page centralisé nettoyé');
  }

  window.MM.initPanelObserver = initPanelObserver;
  window.MM.cleanupPanelObserver = cleanupPanelObserver;
  window.MM.detectDesktopLayout = detectDesktopLayout;
})();
