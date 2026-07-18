// studio-search.js — Recherche et filtrage d'artéfacts dans le Studio
// Auteur : MTF Karukera | Licence : MPL-2.0

(function() {
  'use strict';

  // Namespace global
  window.MM = window.MM || {};

  const t = window.MM.t;
  const createElement = window.MM.createElement;

  let searchBarContainer = null;
  let activeFilters = new Set(); // Filtres d'artéfacts sélectionnés

  // Définition des types d'artéfacts et de leurs mots-clés d'identification DOM
  const ARTIFACT_TYPES = {
    audio: {
      label: 'Discussion Audio / Podcast',
      keywords: ['audio', 'podcast', 'discussion audio', 'debriefing', 'casque', 'headset', 'écoute', 'listen'],
      icon: 'headset'
    },
    faq: {
      label: 'Foire Aux Questions (FAQ)',
      keywords: ['faq', 'questions', 'foire aux questions', 'réponses', 'q&a'],
      icon: 'quiz'
    },
    timeline: {
      label: 'Chronologie',
      keywords: ['chronologie', 'timeline', 'dates', 'historique', 'étapes'],
      icon: 'date_range'
    },
    briefing: {
      label: 'Fiche / Briefing',
      keywords: ['briefing', 'fiche', 'document de briefing', 'rapport', 'synthèse'],
      icon: 'description'
    },
    toc: {
      label: 'Table des matières',
      keywords: ['table des matières', 'sommaire', 'plan', 'structure', 'index'],
      icon: 'list'
    },
    user_note: {
      label: 'Notes utilisateur',
      keywords: [], // Géré par exclusion (si ce n'est pas un artéfact d'IA)
      icon: 'edit'
    }
  };

  console.log('[MM] Module studio-search chargé.');

  // ═══════════════════════════════════════════════════════════════════════
  // 1. DÉTECTION DU CONTEXTE STUDIO
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Détecte si la vue courante est le Studio (guide d'étude / grille de notes).
   * Doit retourner false si un artéfact individuel ou le chat est affiché en plein écran.
   */
  function isStudioActive() {
    // 1. Il faut être dans un notebook ouvert
    const path = window.location.pathname;
    if (!path.includes('/notebook/')) return false;

    // 2. Si un viewer d'artéfact ou de note individuelle est affiché en grand
    const hasActiveViewer = document.querySelector('.artifact-viewer, [class*="artifact-viewer"], source-viewer, note-viewer') !== null;
    if (hasActiveViewer) return false;

    // 3. Tenter de localiser la grille de notes ou le conteneur du studio
    const hasNotesGrid = document.querySelector('.notes-grid, .grid-container, mat-grid-list, [class*="notes-list"]') !== null;
    const hasStudioElements = document.querySelector('button[aria-label*="Note"], button:has-text("Note"), [class*="studio"]') !== null;

    return hasNotesGrid || hasStudioElements;
  }

  /**
   * Détermine le type d'une carte d'artéfact à partir de son DOM.
   *
   * @param {HTMLElement} card - L'élément de carte à analyser.
   * @returns {string} Le type d'artéfact ('audio', 'faq', etc.) ou 'user_note'.
   */
  function detectCardType(card) {
    const textContent = (card.textContent || '').toLowerCase();
    
    // Tenter de détecter l'icône de type (si présente)
    const icon = card.querySelector('mat-icon, svg, [class*="icon"]');
    const iconName = icon ? (icon.textContent || icon.getAttribute('aria-label') || '').toLowerCase() : '';

    // 1. Test Audio
    if (iconName.includes('head') || iconName.includes('volume') || ARTIFACT_TYPES.audio.keywords.some(kw => textContent.includes(kw))) {
      return 'audio';
    }
    // 2. Test FAQ
    if (iconName.includes('help') || iconName.includes('quiz') || iconName.includes('question') || ARTIFACT_TYPES.faq.keywords.some(kw => textContent.includes(kw))) {
      return 'faq';
    }
    // 3. Test Chronologie
    if (iconName.includes('today') || iconName.includes('calendar') || iconName.includes('date') || ARTIFACT_TYPES.timeline.keywords.some(kw => textContent.includes(kw))) {
      return 'timeline';
    }
    // 4. Test Table des matières
    if (iconName.includes('list') || iconName.includes('toc') || ARTIFACT_TYPES.toc.keywords.some(kw => textContent.includes(kw))) {
      return 'toc';
    }
    // 5. Test Briefing / Rapport
    if (iconName.includes('description') || iconName.includes('article') || ARTIFACT_TYPES.briefing.keywords.some(kw => textContent.includes(kw))) {
      return 'briefing';
    }

    // Par défaut, s'il n'y a pas d'icône d'artéfact d'IA ou s'il s'agit d'une note modifiable
    return 'user_note';
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2. APPLICATION DU FILTRAGE
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Filtre en temps réel les notes et artéfacts du studio selon la recherche et les types cochés.
   */
  function applyStudioFilters() {
    if (!searchBarContainer) return;

    const input = searchBarContainer.querySelector('.mm-studio-search-input');
    const query = input ? input.value.toLowerCase().trim() : '';

    // Trouver toutes les cartes d'artéfacts/notes du studio
    const cards = Array.from(document.querySelectorAll(
      '.notes-grid > *, .grid-container > *, mat-grid-tile, mat-card, [class*="note-card"], [class*="studio-card"]'
    )).filter(el => {
      // Exclure la barre de recherche elle-même et les éléments de structure globaux
      return !el.classList.contains('mm-studio-search-bar') && !el.closest('.mm-studio-search-bar');
    });

    let matchCount = 0;

    cards.forEach(card => {
      const text = (card.textContent || '').toLowerCase();
      const type = detectCardType(card);

      const matchesQuery = !query || text.includes(query);
      const matchesType = activeFilters.size === 0 || activeFilters.has(type);

      if (matchesQuery && matchesType) {
        card.style.display = '';
        matchCount++;
      } else {
        card.style.display = 'none';
      }
    });

    // Message d'absence de résultats
    let noResultsMsg = document.querySelector('.mm-studio-no-results');
    if (matchCount === 0 && cards.length > 0) {
      if (!noResultsMsg) {
        noResultsMsg = createElement('div', {
          className: 'mm-studio-no-results',
          role: 'status',
          textContent: t('noResultsStudio') || 'Aucune note ou artéfact correspondant.'
        });
        const container = document.querySelector('.notes-grid, .grid-container, [class*="notes-list"]') || document.body;
        container.appendChild(noResultsMsg);
      }
    } else if (noResultsMsg) {
      noResultsMsg.remove();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3. CRÉATION ET INJECTION DE LA BARRE
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Crée l'élément HTML de la pilule de recherche.
   */
  function createSearchBar() {
    const searchInput = createElement('input', {
      type: 'text',
      className: 'mm-studio-search-input',
      placeholder: t('searchStudioPlaceholder') || 'Rechercher une note ou un artéfact...'
    });

    searchInput.addEventListener('input', applyStudioFilters);

    // Bouton de réinitialisation croix
    const clearBtn = createElement('button', {
      className: 'mm-studio-search-clear mm-btn-icon',
      title: t('clearSearch') || 'Vider la recherche',
      'aria-label': t('clearSearch') || 'Vider la recherche',
      onClick: (e) => {
        e.stopPropagation();
        searchInput.value = '';
        applyStudioFilters();
        searchInput.focus();
      }
    }, [
      createElement('svg', {
        viewBox: '0 0 24 24',
        className: 'mm-icon-svg',
        'aria-hidden': 'true',
        innerHTML: '<path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/>'
      })
    ]);

    // Dropdown de filtres
    const filterBtn = createElement('button', {
      className: 'mm-studio-filter-btn mm-btn-icon',
      title: t('filterArtifacts') || 'Filtrer les types',
      'aria-label': t('filterArtifacts') || 'Filtrer les types',
      onClick: (e) => {
        e.stopPropagation();
        toggleFilterMenu();
      }
    }, [
      createElement('svg', {
        viewBox: '0 0 24 24',
        className: 'mm-icon-svg',
        'aria-hidden': 'true',
        innerHTML: '<path d="M3,2H21V2H21V4H20.09L15,10.09V19L9,22V10.09L3.91,4H3V2M15,4H9V4H15V4M11,10.09V18.12L13,17.12V10.09L13,10.09L18.12,4H5.88L11,10.09Z"/>'
      })
    ]);

    const bar = createElement('div', { className: 'mm-studio-search-bar' }, [
      createElement('svg', {
        viewBox: '0 0 24 24',
        className: 'mm-icon-svg mm-search-icon',
        'aria-hidden': 'true',
        innerHTML: '<path d="M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z"/>'
      }),
      searchInput,
      clearBtn,
      filterBtn
    ]);

    return bar;
  }

  /**
   * Affiche / Masque le menu déroulant de filtres multi-sélection.
   */
  function toggleFilterMenu() {
    let menu = document.querySelector('.mm-studio-filter-menu');
    if (menu) {
      menu.remove();
      return;
    }

    menu = createElement('div', {
      className: 'mm-studio-filter-menu mm-settings-popover',
      role: 'dialog',
      'aria-label': 'Menu de filtres d\'artéfacts'
    });

    Object.entries(ARTIFACT_TYPES).forEach(([type, info]) => {
      const checkbox = createElement('input', {
        type: 'checkbox',
        id: `filter-cb-${type}`,
        checked: activeFilters.has(type),
        onChange: () => {
          if (checkbox.checked) {
            activeFilters.add(type);
          } else {
            activeFilters.delete(type);
          }
          applyStudioFilters();
        }
      });

      const label = createElement('label', {
        htmlFor: `filter-cb-${type}`,
        textContent: info.label
      });

      const option = createElement('div', { className: 'mm-filter-option' }, [checkbox, label]);
      menu.appendChild(option);
    });

    // Positionner le menu de manière absolue sous le bouton de filtre
    const filterBtn = searchBarContainer.querySelector('.mm-studio-filter-btn');
    const rect = filterBtn.getBoundingClientRect();
    menu.style.top = `${rect.bottom + window.scrollY + 6}px`;
    menu.style.left = `${rect.right - 200 + window.scrollX}px`;

    document.body.appendChild(menu);

    // Fermeture en cliquant en dehors
    const closeMenu = (e) => {
      if (!menu.contains(e.target) && !filterBtn.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  /**
   * Vérifie et injecte la pilule de recherche dans le Studio.
   */
  function checkAndInjectStudioSearch() {
    if (!window.MM.isFeatureEnabled('studioSearch')) {
      cleanupStudioSearch();
      return;
    }

    const isActive = isStudioActive();
    if (!isActive) {
      if (searchBarContainer) {
        searchBarContainer.style.display = 'none';
      }
      return;
    }

    // Trouver l'ancre d'injection : le conteneur principal du Studio ou le premier panneau
    const notesGrid = document.querySelector('.notes-grid, .grid-container, mat-grid-list, [class*="notes-list"]');
    if (!notesGrid) return;

    if (searchBarContainer) {
      searchBarContainer.style.display = '';
      if (!notesGrid.parentNode.contains(searchBarContainer)) {
        notesGrid.parentNode.insertBefore(searchBarContainer, notesGrid);
      }
      return;
    }

    searchBarContainer = createSearchBar();
    notesGrid.parentNode.insertBefore(searchBarContainer, notesGrid);
    console.log('[MM] Pilule de recherche du Studio injectée.');
  }

  /**
   * Focus la barre de recherche du studio (déclenché par raccourci).
   */
  function focusStudioSearch() {
    if (searchBarContainer && searchBarContainer.style.display !== 'none') {
      const input = searchBarContainer.querySelector('.mm-studio-search-input');
      if (input) input.focus();
    }
  }

  /**
   * Supprime proprement tous les éléments injectés par la recherche du studio.
   */
  function cleanupStudioSearch() {
    if (searchBarContainer) {
      searchBarContainer.remove();
      searchBarContainer = null;
    }
    const menu = document.querySelector('.mm-studio-filter-menu');
    if (menu) menu.remove();
    const noResults = document.querySelector('.mm-studio-no-results');
    if (noResults) noResults.remove();
    activeFilters.clear();
    console.log('[MM] Recherche du Studio nettoyée.');
  }

  // Exposition publique pour l'observer
  window.MM.studioSearch = {
    checkAndInjectStudioSearch: checkAndInjectStudioSearch,
    focusStudioSearch: focusStudioSearch,
    cleanup: cleanupStudioSearch
  };

})();
