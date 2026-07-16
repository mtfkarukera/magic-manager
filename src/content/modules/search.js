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

  /** Requête de recherche courante pour assurer la persistance lors des transitions SPA */
  let currentQuery = '';

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
   * Applique le filtre de recherche sur les cartes de sources.
   * @param {string} query - Requête nettoyée en minuscules.
   */
  function applyFilter(query) {
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
  }

  /**
   * Filtre les sources selon la valeur de recherche (debouncé).
   */
  const performSearch = debounce(function () {
    if (!searchBarContainer) return;

    const input = searchBarContainer.querySelector('.mm-search-input');
    if (!input) return;

    currentQuery = input.value.trim().toLowerCase();
    applyFilter(currentQuery);
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
    // Garde-fou préférence active
    if (typeof window.MM.isFeatureEnabled === 'function' && !window.MM.isFeatureEnabled('search')) {
      if (searchBarContainer) {
        searchBarContainer.remove();
        searchBarContainer = null;
      }
      return;
    }

    // 1. Détecter si l'utilisateur consulte une source active (mode lecture)
    const isViewingSource = document.querySelector('source-viewer, [class*="source-viewer"]') !== null;

    if (isViewingSource) {
      // Masquer la barre de recherche si elle est présente pour économiser de l'espace
      if (searchBarContainer) {
        searchBarContainer.style.display = 'none';
      }
      return;
    }

    // Si on n'est plus en train de lire et que la barre était masquée, on la réaffiche
    if (searchBarContainer && searchBarContainer.style.display === 'none') {
      searchBarContainer.style.display = '';
      // Ré-appliquer le filtrage persistant
      applyFilter(currentQuery);
      return;
    }

    // Si la barre est déjà dans le DOM et visible → on s'assure d'appliquer le filtre courant
    if (searchBarContainer && document.contains(searchBarContainer)) {
      applyFilter(currentQuery);
      return;
    }

    // Nettoyer une référence orpheline éventuelle
    if (searchBarContainer) {
      searchBarContainer.remove();
      searchBarContainer = null;
    }

    // Chercher le conteneur de la liste scrollable
    const container = findSourcesListContainer();
    if (!container) return;

    // Construire la barre de recherche
    const input = createElement('input', {
      type: 'text',
      className: 'mm-search-input',
      placeholder: t('searchPlaceholder'),
      value: currentQuery, // Pré-remplir avec la requête courante (persistance)
      onInput: performSearch,
      onKeydown: function (e) {
        if (e.key === 'Escape') {
          input.value = '';
          currentQuery = '';
          applyFilter('');
          input.blur();
        }
      }
    });

    searchBarContainer = createElement('div', {
      className: 'mm-search-bar'
    }, [input]);

    const header = findSourcePanelHeader();
    const sourcePanel = document.querySelector('section.source-panel, .source-panel, [class*="source-panel"]');

    if (sourcePanel && header) {
      // Nettoyer l'en-tête collant mobile s'il existe (transition mobile → desktop)
      const mobileHeader = sourcePanel.querySelector('.mm-sticky-header');
      if (mobileHeader) {
        mobileHeader.remove();
      }

      // Injecter juste après le header (hors zone scrollable, fixe dans le flux flexbox)
      header.parentNode.insertBefore(searchBarContainer, header.nextSibling);
      searchBarContainer.style.position = 'relative';
      searchBarContainer.style.margin = '8px 16px';
      searchBarContainer.style.zIndex = '99';
      console.log('[MM] Barre de recherche injectée de façon fixe après le header');
    } else {
      // Mode mobile / sans-header : utilisation de l'en-tête collant MM (.mm-sticky-header)
      const stickyHeader = window.MM.getOrCreateStickyHeader();
      if (stickyHeader) {
        const searchWrapper = stickyHeader.querySelector('.mm-sticky-header-search');
        if (searchWrapper && !searchWrapper.contains(searchBarContainer)) {
          searchWrapper.appendChild(searchBarContainer);
          // Réinitialiser les styles de fallback obsolètes
          searchBarContainer.style.position = '';
          searchBarContainer.style.margin = '0';
          searchBarContainer.style.zIndex = '';
          searchBarContainer.style.backgroundColor = 'transparent';
          console.log('[MM] Barre de recherche injectée dans l\'en-tête collant mobile');
        }
      }
    }

    // Ré-appliquer le filtrage s'il y a une recherche active
    applyFilter(currentQuery);
  }

  /**
   * Initialise le module de recherche de façon autonome et résiliente.
   */
  function initSearch() {
    // 1. Effectuer une détection et injection immédiate
    checkAndInjectSearch();

    // 2. Ajouter l'écouteur de raccourci clavier global
    window.removeEventListener('keydown', handleGlobalShortcut);
    window.addEventListener('keydown', handleGlobalShortcut);

    console.log('[MM] Module recherche initialisé');
  }

  /**
   * Nettoie les éléments injectés par le module.
   */
  function cleanupSearch() {
    window.removeEventListener('keydown', handleGlobalShortcut);

    // Réinitialiser la requête de recherche courante
    currentQuery = '';

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
  window.MM.checkAndInjectSearch = checkAndInjectSearch;
})();
