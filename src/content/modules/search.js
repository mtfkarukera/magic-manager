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

  /** Requête de recherche courante pour assurer la persistance lors des transitions SPA */
  let currentQuery = '';

  /** Filtre pour n'afficher que les doublons potentiels */
  let showOnlyDuplicates = false;

  // ═══════════════════════════════════════════════════════════════════════
  // Sélecteurs et Heuristiques DOM
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Recherche le conteneur de la liste des sources avec des heuristiques résilientes.
   * @returns {Element|null}
   */
  function findSourcesListContainer() {
    return typeof window.MM.findSourcesListContainer === 'function'
      ? window.MM.findSourcesListContainer()
      : null;
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
   * Calcule la distance de Levenshtein entre deux chaînes de caractères.
   */
  function levenshteinDistance(s1, s2) {
    if (s1.length < s2.length) {
      return levenshteinDistance(s2, s1);
    }
    if (s2.length === 0) {
      return s1.length;
    }
    let previousRow = Array.from({ length: s2.length + 1 }, (_, i) => i);
    for (let i = 0; i < s1.length; i++) {
      let currentRow = [i + 1];
      for (let j = 0; j < s2.length; j++) {
        let insertions = previousRow[j + 1] + 1;
        let deletions = currentRow[j] + 1;
        let substitutions = previousRow[j] + (s1[i] === s2[j] ? 0 : 1);
        currentRow.push(Math.min(insertions, deletions, substitutions));
      }
      previousRow = currentRow;
    }
    return previousRow[s2.length];
  }

  /**
   * Détermine si deux titres de sources sont très similaires (seuil 85%).
   */
  function areSimilar(title1, title2) {
    const t1 = title1.toLowerCase().trim();
    const t2 = title2.toLowerCase().trim();
    if (t1 === t2) return true;
    const dist = levenshteinDistance(t1, t2);
    const maxLen = Math.max(t1.length, t2.length);
    if (maxLen === 0) return true;
    const similarity = 1 - dist / maxLen;
    return similarity > 0.85;
  }

  /**
   * Identifie tous les doublons dans la liste des sources.
   * Compare les titres des cartes.
   */
  function findDuplicateCards(cards) {
    const duplicates = new Set();
    const parsed = cards.map(card => {
      const stretchedBtn = card.querySelector('button.source-stretched-button');
      const title = stretchedBtn ? (stretchedBtn.getAttribute('aria-label') || '') : (card.textContent || '').trim().split('\n')[0];
      return { card, title: title.trim() };
    });

    for (let i = 0; i < parsed.length; i++) {
      for (let j = i + 1; j < parsed.length; j++) {
        if (parsed[i].title && parsed[j].title && areSimilar(parsed[i].title, parsed[j].title)) {
          duplicates.add(parsed[i].card);
          duplicates.add(parsed[j].card);
        }
      }
    }
    return duplicates;
  }

  /**
   * Applique le filtre de recherche sur les cartes de sources.
   * @param {string} query - Requête nettoyée en minuscules.
   */
  function applyFilter(query) {
    const cards = findSourceCards();
    let visibleCount = 0;

    const duplicateCards = findDuplicateCards(cards);

    cards.forEach(function (card) {
      const text = (card.textContent || '').trim().toLowerCase();
      const isDup = duplicateCards.has(card);

      if (isDup) {
        card.classList.add('mm-source-duplicate');
        card.setAttribute('title', 'Doublon potentiel détecté (Magic Manager)');
      } else {
        card.classList.remove('mm-source-duplicate');
        card.removeAttribute('title');
      }

      const matchesQuery = !query || text.includes(query);
      const matchesDup = !showOnlyDuplicates || isDup;

      if (matchesQuery && matchesDup) {
        card.style.display = '';
        visibleCount++;
      } else {
        card.style.display = 'none';
      }
    });

    if (visibleCount === 0 && (query.length > 0 || showOnlyDuplicates)) {
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
        role: 'status',
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
  function focusSourceSearch() {
    const input = document.querySelector('.mm-search-input');
    if (input) {
      input.focus();
      input.select();
      return true;
    }
    return false;
  }

  function handleGlobalShortcut(e) {
    const isCmdOrCtrl = e.metaKey || e.ctrlKey;
    if (isCmdOrCtrl && e.shiftKey && e.key.toLowerCase() === 'f') {
      if (focusSourceSearch()) {
        e.preventDefault();
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

    // Détecter si le panneau des sources est présent et visible, ou s'il est minimisé/replié.
    const sourcePanel = document.querySelector('section.source-panel, .source-panel, [class*="source-panel"]');
    if (sourcePanel) {
      const rect = sourcePanel.getBoundingClientRect();
      // Si la largeur physique est trop petite (< 120px), le panneau est replié.
      // On masque la barre de recherche pour éviter qu'elle ne déborde.
      if (rect.width < 120) {
        if (searchBarContainer) {
          searchBarContainer.style.display = 'none';
        }
        return;
      }
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
      'aria-label': t('searchPlaceholder'),
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

    const searchIcon = createElement('svg', {
      viewBox: '0 0 24 24',
      className: 'mm-icon-svg mm-search-icon',
      'aria-hidden': 'true',
      innerHTML: '<path d="M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z"/>'
    });

    const clearBtn = createElement('button', {
      className: 'mm-search-clear mm-btn-icon',
      title: t('clearSearch') || 'Vider la recherche',
      'aria-label': t('clearSearch') || 'Vider la recherche',
      onClick: function (e) {
        e.stopPropagation();
        input.value = '';
        currentQuery = '';
        applyFilter('');
        input.focus();
      }
    }, [
      createElement('svg', {
        viewBox: '0 0 24 24',
        className: 'mm-icon-svg',
        'aria-hidden': 'true',
        innerHTML: '<path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/>'
      })
    ]);

    const dedupBtn = createElement('button', {
      className: 'mm-search-dedup-btn mm-btn-icon',
      title: 'Afficher uniquement les doublons',
      'aria-label': 'Afficher uniquement les doublons',
      onClick: function (e) {
        e.stopPropagation();
        showOnlyDuplicates = !showOnlyDuplicates;
        dedupBtn.classList.toggle('active', showOnlyDuplicates);
        applyFilter(currentQuery);
      }
    }, [
      createElement('svg', {
        viewBox: '0 0 24 24',
        className: 'mm-icon-svg',
        'aria-hidden': 'true',
        innerHTML: '<path d="M15 9H5V5H15V9M19 13H9V9H19V13M23 17H13V13H23V17M15 3H5C3.9 3 3 3.9 3 5V9C3 10.1 3.9 11 5 11H15C16.1 11 17 10.1 17 9V5C17 3.9 16.1 3 15 3Z"/>'
      })
    ]);

    searchBarContainer = createElement('div', {
      className: 'mm-search-bar'
    }, [searchIcon, input, clearBtn, dedupBtn]);

    const header = findSourcePanelHeader();

    if (sourcePanel && header) {
      // Nettoyer l'en-tête collant mobile s'il existe (transition mobile → desktop)
      const mobileHeader = sourcePanel.querySelector('.mm-sticky-header');
      if (mobileHeader) {
        mobileHeader.remove();
      }

      // Injecter juste après le header (hors zone scrollable, fixe dans le flux flexbox)
      header.parentNode.insertBefore(searchBarContainer, header.nextSibling);
      searchBarContainer.classList.add('mm-desktop-header');
      console.log('[MM] Barre de recherche injectée de façon fixe après le header');
    } else {
      // Mode mobile / sans-header : utilisation de l'en-tête collant MM (.mm-sticky-header)
      const stickyHeader = window.MM.getOrCreateStickyHeader();
      if (stickyHeader) {
        const searchWrapper = stickyHeader.querySelector('.mm-sticky-header-search');
        if (searchWrapper && !searchWrapper.contains(searchBarContainer)) {
          searchWrapper.appendChild(searchBarContainer);
          // Réinitialiser la classe desktop pour le mode mobile
          searchBarContainer.classList.remove('mm-desktop-header');
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
  window.MM.focusSourceSearch = focusSourceSearch;
})();
