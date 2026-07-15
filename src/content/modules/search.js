// search.js — Module de recherche globale dans les sources (F1)
// Auteur : MTF Karukera | Licence : MPL-2.0
// Dépendance : window.MM (utils.js chargé avant)

'use strict';

(function () {
  const { t, createElement, debounce } = window.MM;

  // ═══════════════════════════════════════════════════════════════════════
  // État interne
  // ═══════════════════════════════════════════════════════════════════════

  /** Référence à la barre de recherche injectée */
  let searchBarContainer = null;

  /** Référence à l'élément de message d'erreur/vide */
  let noResultsElement = null;

  /** Observer permanent surveillant les mutations de la page pour ré-injecter si la SPA reconstruit le DOM */
  let pageObserver = null;

  // ═══════════════════════════════════════════════════════════════════════
  // Sélecteurs et Heuristiques DOM
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Recherche le conteneur de la liste des sources avec des heuristiques résilientes.
   * @returns {Element|null}
   */
  function findSourcesListContainer() {
    // Heuristique 1 : Classe contenant source-list ou sources-list
    let el = document.querySelector(
      '[data-sources-list], [class*="source-list"], [class*="sources-list"], [class*="sourceList"], [class*="sourcesList"]'
    );
    if (el) return el;

    // Heuristique 2 : Recherche par contenu sémantique du panneau Sources
    const panels = Array.from(document.querySelectorAll('div, aside, section'));
    for (let i = 0; i < panels.length; i++) {
      const panel = panels[i];
      const text = panel.textContent || '';
      if (text.includes('Sources') && text.includes('Ajouter des sources')) {
        const scrollable = panel.querySelector('[class*="scroll"], div[style*="overflow"]');
        if (scrollable) return scrollable;
        return panel;
      }
    }

    return null;
  }

  /**
   * Recherche le panel-header du panneau des sources.
   * Cet élément est hors de la zone scrollable et reste toujours visible.
   * @returns {Element|null}
   */
  function findSourcePanelHeader() {
    const sourcePanel = document.querySelector(
      'section.source-panel, .source-panel, [class*="source-panel"]'
    );
    if (sourcePanel) {
      const header = sourcePanel.querySelector('.panel-header, [class*="panel-header"]');
      if (header) return header;
    }
    return null;
  }

  /**
   * Identifie de manière robuste toutes les lignes de sources individuelles.
   * Se base sur la présence des checkboxes individuelles de sélection.
   * @returns {Array<Element>}
   */
  function findSourceCards() {
    const container = findSourcesListContainer();
    if (!container) return [];

    const checkboxes = Array.from(container.querySelectorAll('input[type="checkbox"], [role="checkbox"]'));
    const cards = [];

    checkboxes.forEach(function (cb) {
      const parentText = cb.parentNode ? cb.parentNode.textContent : '';
      if (parentText.includes('Tout sélectionner') || 
          cb.closest('[class*="select-all"]') || 
          cb.closest('[class*="selectAll"]')) {
        return;
      }

      let line = cb;
      while (line && line.parentNode && line.parentNode !== container && line.parentNode !== document.body) {
        if (line.classList && (
          line.classList.contains('source-card') ||
          (typeof line.className === 'string' && (
            line.className.includes('source') ||
            line.className.includes('item') ||
            line.className.includes('card')
          ))
        )) {
          break;
        }
        line = line.parentNode;
      }

      if (line && line !== container && !cards.includes(line)) {
        cards.push(line);
      }
    });

    if (cards.length === 0) {
      return Array.from(container.querySelectorAll(
        'div[class*="source-card"], div[class*="source-item"], div[class*="sourceItem"], [class*="source-row"], [data-source-id]'
      ));
    }

    return cards;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Logique de filtrage
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Filtre les sources selon la valeur de recherche.
   */
  const performSearch = debounce(function () {
    if (!searchBarContainer) return;

    const input = searchBarContainer.querySelector('.mm-search-input');
    if (!input) return;

    const query = input.value.trim().toLowerCase();
    const cards = findSourceCards();
    let visibleCount = 0;

    cards.forEach(function (card) {
      const text = (card.textContent || '').trim().toLowerCase();

      if (text.includes(query)) {
        card.style.display = '';
        visibleCount++;
      } else {
        card.style.display = 'none';
      }
    });

    if (visibleCount === 0 && query.length > 0) {
      showNoResultsMessage();
    } else {
      hideNoResultsMessage();
    }
  }, 150);

  /**
   * Affiche le message de résultats vides.
   */
  function showNoResultsMessage() {
    const container = findSourcesListContainer();
    if (!container) return;

    if (!noResultsElement) {
      noResultsElement = createElement('div', {
        className: 'mm-search-no-results',
        textContent: t('searchNoResults')
      });
    }

    if (!noResultsElement.parentNode) {
      container.appendChild(noResultsElement);
    }
  }

  /**
   * Masque le message de résultats vides.
   */
  function hideNoResultsMessage() {
    if (noResultsElement && noResultsElement.parentNode) {
      noResultsElement.remove();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Raccourci clavier de recherche
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Gère le raccourci global Cmd+Shift+F (Mac) ou Ctrl+Shift+F (Linux/Windows)
   * pour focaliser la recherche de sources.
   * @param {KeyboardEvent} e
   */
  function handleGlobalShortcut(e) {
    const isCmdOrCtrl = e.metaKey || e.ctrlKey;
    if (isCmdOrCtrl && e.shiftKey && e.key.toLowerCase() === 'f') {
      const input = document.querySelector('.mm-search-input');
      if (input) {
        e.preventDefault();
        input.focus();
        input.select();
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Injection et Cycle de vie
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Vérifie la présence du conteneur et y injecte la barre de recherche si absente.
   *
   * Stratégie d'injection :
   * 1. Priorité : panel-header (hors zone scrollable) → la barre reste toujours visible
   * 2. Fallback  : prepend dans la liste scrollable avec position:sticky
   */
  function checkAndInjectSearch() {
    // Si la barre est déjà dans le DOM et visible → rien à faire
    if (searchBarContainer && document.contains(searchBarContainer)) {
      return;
    }

    // Nettoyer une référence orpheline éventuelle
    if (searchBarContainer) searchBarContainer = null;

    // Chercher le conteneur de la liste scrollable
    const container = findSourcesListContainer();
    if (!container) return;

    // Construire la barre de recherche
    const input = createElement('input', {
      type: 'text',
      className: 'mm-search-input',
      placeholder: t('searchPlaceholder'),
      onInput: performSearch,
      onKeydown: function (e) {
        if (e.key === 'Escape') {
          input.value = '';
          performSearch();
          input.blur();
        }
      }
    });

    searchBarContainer = createElement('div', {
      className: 'mm-search-bar'
    }, [input]);

    // Injecter en tête de la liste scrollable avec position:sticky
    container.prepend(searchBarContainer);
    searchBarContainer.style.position = 'sticky';
    searchBarContainer.style.top = '0';
    searchBarContainer.style.zIndex = '99';
    const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    searchBarContainer.style.backgroundColor = isDark ? '#1e1f22' : '#ffffff';
    console.log('[MM] Barre de recherche injectée (sticky dans la liste)');
  }

  /**
   * Initialise le module de recherche de façon autonome et résiliente.
   */
  function initSearch() {
    // 1. Effectuer une détection et injection immédiate
    checkAndInjectSearch();

    // 2. Installer un observer permanent pour surveiller les transitions SPA
    if (!pageObserver) {
      pageObserver = new MutationObserver(debounce(function () {
        checkAndInjectSearch();
      }, 200));

      pageObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
    }

    // 3. Ajouter l'écouteur de raccourci clavier global
    window.removeEventListener('keydown', handleGlobalShortcut);
    window.addEventListener('keydown', handleGlobalShortcut);

    console.log('[MM] Module recherche initialisé');
  }

  /**
   * Nettoie les éléments injectés par le module.
   */
  function cleanupSearch() {
    if (pageObserver) {
      pageObserver.disconnect();
      pageObserver = null;
    }

    window.removeEventListener('keydown', handleGlobalShortcut);

    // Restaurer le style d'affichage de toutes les cartes masquées
    const cards = findSourceCards();
    cards.forEach(function (card) {
      card.style.display = '';
    });

    hideNoResultsMessage();

    if (searchBarContainer) {
      searchBarContainer.remove();
      searchBarContainer = null;
    }

    console.log('[MM] Module recherche nettoyé');
  }

  // Exposition dans le namespace global MM
  window.MM.initSearch = initSearch;
  window.MM.cleanupSearch = cleanupSearch;
})();
