// studio-search.js — Recherche et filtrage des éléments du Studio (Notes & Artéfacts)
// Auteur : MTF Karukera | Licence : MPL-2.0
// Dépendance : window.MM (utils.js, panel-observer.js)

'use strict';

(function () {
  const { t, createElement, debounce } = window.MM;

  // ═══════════════════════════════════════════════════════════════════════
  // État interne
  // ═══════════════════════════════════════════════════════════════════════
  let searchBarContainer = null;   // Conteneur de la barre de recherche
  let noResultsElement = null;     // Élément de message "aucun résultat"
  let currentQuery = '';           // Requête texte courante
  let activeTypeFilters = new Set(); // Filtres par type actifs (vide = tous)
  let filterPopoverEl = null;      // Référence au popover de filtre ouvert

  // Cache RPC pour une détection à 100% de fiabilité
  let cachedDbItems = null;        // Liste unifiée des éléments du Studio [{ id, title, type, typeCode }]
  let lastFetchedNotebookId = null; // ID du carnet lors du dernier fetch
  let isFetchingDbItems = false;   // Verrou d'appel RPC en cours

  // ═══ Types filtrables du Studio ═══
  // Code d'artéfact issu de la documentation de référence / rpc-reference.md
  // iconTexts contient les valeurs textuelles ou attributs possibles pour la détection DOM
  const ARTIFACT_TYPES = [
    { code: 1,      i18nKey: 'studioFilterAudio',       iconTexts: ['headphones', 'audio', 'headset', 'podcast', 'earbuds', 'volume'] },
    { code: 2,      i18nKey: 'studioFilterReport',      iconTexts: ['description', 'article', 'report', 'briefing', 'study', 'blog', 'doc', 'history_edu', 'newspaper'] },
    { code: 3,      i18nKey: 'studioFilterVideo',       iconTexts: ['videocam', 'smart_display', 'video', 'play_circle', 'movie'] },
    { code: 4,      i18nKey: 'studioFilterQuiz',        iconTexts: ['quiz', 'style', 'flashcard', 'question', 'cards'] },
    { code: 5,      i18nKey: 'studioFilterMindMap',     iconTexts: ['draw', 'hub', 'schema', 'mindmap', 'mind_map', 'branch', 'mediation', 'account_tree'] },
    { code: 7,      i18nKey: 'studioFilterInfographic', iconTexts: ['bar_chart', 'imagesmode', 'photo', 'infographic', 'trending_up'] },
    { code: 8,      i18nKey: 'studioFilterSlides',      iconTexts: ['slideshow', 'co_present', 'presentation', 'slides', 'deck', 'present_to_all'] },
    { code: 9,      i18nKey: 'studioFilterTable',       iconTexts: ['table_chart', 'grid_on', 'table', 'spreadsheet', 'table_rows'] },
    { code: 'note', i18nKey: 'studioFilterNote',        iconTexts: ['sticky_note', 'note'] },
    { code: 'other', i18nKey: 'studioFilterOther',       iconTexts: ['article', 'description', 'picture_as_pdf', 'attachment', 'insert_drive_file', 'file_present', 'draft', 'folder'] }
  ];

  // ═══════════════════════════════════════════════════════════════════════
  // Sélecteurs Heuristiques et Robustes
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Trouve le conteneur principal du Studio de NotebookLM.
   */
  function findStudioPanel() {
    return document.querySelector(
      'section.studio-panel, .studio-panel, [class*="studio-panel"], [class*="studio"]'
    );
  }

  /**
   * Détecte toutes les cartes individuelles de notes et d'artéfacts.
   */
  function findStudioCards(studioPanel) {
    const items = Array.from(studioPanel.querySelectorAll('.artifact-item-button'));
    if (items.length > 0) return items;

    // Fallback robuste identique à studio-delete.js
    const fallbackItems = [];
    const optionButtons = studioPanel.querySelectorAll('.artifact-more-button, [class*="more-button"]');
    optionButtons.forEach(btn => {
      let el = btn.parentElement;
      while (el && el !== studioPanel && !el.classList.contains('artifact-item-button')) {
        if (el.tagName === 'BUTTON' || el.classList.contains('studio-item') || el.classList.contains('studio-card')) {
          break;
        }
        el = el.parentElement;
      }
      if (el && el !== studioPanel && !fallbackItems.includes(el)) {
        fallbackItems.push(el);
      }
    });

    return fallbackItems;
  }

  /**
   * Extrait le titre d'une carte du Studio.
   */
  function getStudioCardTitle(card) {
    const titleEl = card.querySelector('h3, h4, .title, [class*="title"], [class*="header"]');
    if (titleEl) return titleEl.textContent.trim();
    
    const elements = Array.from(card.querySelectorAll('span, p, div'));
    for (const el of elements) {
      const text = el.textContent.trim();
      if (text.length > 0 && text.length < 80) return text;
    }
    return '';
  }

  /**
   * Trouve l'icône native d'une carte du Studio en ignorant les ajouts MM (checkbox, wrapper).
   */
  function findNativeIcon(card) {
    // Si l'icône native a été enveloppée par studio-delete.js
    const wrappedIcon = card.querySelector('.mm-studio-native-icon');
    if (wrappedIcon) return wrappedIcon;

    // Sinon, chercher le premier mat-icon ou svg de la carte qui n'est pas injecté par MM
    const elements = Array.from(card.querySelectorAll('mat-icon, svg'));
    for (const el of elements) {
      if (!el.classList.contains('mm-studio-checkbox') && !el.closest('.mm-studio-checkbox')) {
        return el;
      }
    }
    return null;
  }

  const KNOWN_CODES = [1, 2, 3, 4, 5, 7, 8, 9];

  /**
   * Détecte le type de carte du Studio depuis le DOM (fallback).
   */
  function detectCardTypeFromDOM(card) {
    const icon = findNativeIcon(card);
    if (!icon) return 'note';

    // 1. Lire le textContent (cas classique de ligature de police)
    const iconText = icon.textContent.trim().toLowerCase();
    if (iconText) {
      if (iconText.includes('sticky_note') || iconText.includes('note')) {
        return 'note';
      }
      for (const type of ARTIFACT_TYPES) {
        if (type.code !== 'note' && type.code !== 'other' && type.iconTexts.includes(iconText)) {
          return type.code;
        }
      }
    }
    
    // 2. Lire les attributs de nom d'icône d'Angular
    const iconName = (
      icon.getAttribute('svgicon') || 
      icon.getAttribute('data-mat-icon-name') || 
      icon.getAttribute('data-icon-name') ||
      ''
    ).toLowerCase().trim();
    
    if (iconName) {
      if (iconName.includes('sticky_note') || iconName.includes('note')) {
        return 'note';
      }
      for (const type of ARTIFACT_TYPES) {
        if (type.code !== 'note' && type.code !== 'other' && type.iconTexts.includes(iconName)) {
          return type.code;
        }
      }
    }

    // 3. Repli moins strict sur les classes / attributs si aucun nom d'icône exact n'a été trouvé
    const iconAttr = (icon.getAttribute('aria-label') || icon.getAttribute('title') || '').toLowerCase();
    const iconClass = icon.className.toLowerCase();
    const checkString = `${iconAttr} ${iconClass}`;

    // Exclusion explicite de "style" dans les classes pour éviter "style-scope" qui matchait Quiz
    const safeCheckString = checkString.replace(/style-scope/g, '').replace(/style/g, '');

    if (safeCheckString.includes('sticky_note') || safeCheckString.includes('note')) {
      return 'note';
    }

    for (const type of ARTIFACT_TYPES) {
      if (type.code !== 'note' && type.code !== 'other') {
        // Pour les autres attributs / classes, n'autoriser le match que si le mot est bien délimité (ex. "video-camera" ou "hub")
        if (type.iconTexts.some(t => {
          const reg = new RegExp('\\b' + t + '\\b');
          return reg.test(safeCheckString);
        })) {
          return type.code;
        }
      }
    }

    // Si une icône native est présente mais qu'elle ne correspond à aucune catégorie spécifique,
    // on la laisse dans "Notes" (comportement d'origine).
    return 'note';
  }

  /**
   * Détermine le type de carte en combinant le cache RPC (précision 100%) et le fallback DOM.
   */
  function getCardType(card, title) {
    if (cachedDbItems && cachedDbItems.length > 0) {
      const cleanTitle = title.trim().toLowerCase();
      const domType = detectCardTypeFromDOM(card);
      // Le DOM a-t-il réussi à identifier un type spécifique (code numérique connu) ?
      const domHasSpecificType = KNOWN_CODES.includes(domType);

      // Recherche précise par titre ET type
      const match = cachedDbItems.find(item => {
        const dbTitle = item.title.toLowerCase();
        const isTitleMatch = dbTitle === cleanTitle || dbTitle.includes(cleanTitle) || cleanTitle.includes(dbTitle);
        if (!isTitleMatch) return false;
        
        // Résolution de collision : si le DOM a un type spécifique, exiger la concordance
        if (domHasSpecificType) {
          let rpcType = item.type === 'note' ? 'note' : item.typeCode;
          if (rpcType !== 'note' && !KNOWN_CODES.includes(rpcType)) {
            rpcType = 'other';
          }
          return rpcType === domType;
        }
        return true;
      });
      if (match) {
        return match.type === 'note' ? 'note' : match.typeCode;
      }
    }
    
    // Fallback DOM pur (pas de cache disponible)
    return detectCardTypeFromDOM(card);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Parseurs RPC (identiques à studio-delete.js pour assurer la cohérence)
  // ═══════════════════════════════════════════════════════════════════════

  function parseNotesResult(result) {
    if (!Array.isArray(result) || !Array.isArray(result[0])) return [];
    
    return result[0].map(row => {
      if (!Array.isArray(row) || row.length < 2) return null;
      const id = row[0];
      const data = row[1];
      if (typeof id !== 'string' || id.length < 10) return null;
      if (!Array.isArray(data) || data.length < 5) return null;
      
      const content = data[1] || '';
      const title = data[4] || '';
      
      // Détecter si c'est une carte mentale (Mind Map)
      // Les cartes mentales stockées contiennent du JSON avec soit "children": soit "nodes":
      const isMindMap = typeof content === 'string' && 
                        content.trim().startsWith('{') && 
                        (content.includes('"children":') || content.includes('"nodes":'));
      
      if (isMindMap) {
        return { id: id, title: title.trim(), type: 'artifact', typeCode: 5 };
      } else {
        return { id: id, title: title.trim(), type: 'note' };
      }
    }).filter(Boolean);
  }

  function parseArtifactsResult(result) {
    if (!Array.isArray(result) || !Array.isArray(result[0])) return [];
    
    return result[0].map(row => {
      if (!Array.isArray(row) || row.length < 3) return null;
      const id = row[0];
      const title = row[1] || '';
      let typeCode = row[2];
      
      // Si c'est un type QUIZ (4), vérifier si c'est une carte mentale interactive (variant 4)
      if (typeCode === 4 && Array.isArray(row[9]) && Array.isArray(row[9][1])) {
        const variant = row[9][1][0];
        if (variant === 4) {
          typeCode = 5; // Reclasser en Carte Mentale
        }
      }
      
      if (typeof id !== 'string' || id.length < 10) return null;
      return { id: id, title: title.trim(), type: 'artifact', typeCode: typeCode };
    }).filter(Boolean);
  }

  /**
   * Récupère la liste des artéfacts et notes via RPC et remplit le cache local.
   */
  async function fetchStudioItems(notebookId) {
    isFetchingDbItems = true;
    try {
      console.log('[MM] StudioSearch : Chargement des métadonnées du Studio via RPC...');
      const [notesRaw, artifactsRaw] = await Promise.all([
        window.MM.rpc.getNotesAndMindMaps(notebookId),
        window.MM.rpc.getArtifactsList(notebookId)
      ]);

      const dbNotes = parseNotesResult(notesRaw);
      const dbArtifacts = parseArtifactsResult(artifactsRaw);
      cachedDbItems = dbNotes.concat(dbArtifacts);
      
      console.log(`[MM] StudioSearch : Cache hydraté avec ${cachedDbItems.length} éléments.`);
      // Ré-appliquer les filtres immédiatement avec le cache précis
      applyFilters();
    } catch (err) {
      console.error('[MM] StudioSearch : Échec du chargement RPC des types d\'artéfacts :', err);
    } finally {
      isFetchingDbItems = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Gestion du Filtrage
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Applique le filtre combiné texte + type sur les cartes du Studio.
   */
  function applyFilters() {
    const studioPanel = findStudioPanel();
    if (!studioPanel) return;

    // Détecter un changement de Notebook ID pour invalider le cache
    const notebookId = window.MM.getActiveNotebookId();
    if (notebookId && notebookId !== lastFetchedNotebookId) {
      cachedDbItems = null;
      lastFetchedNotebookId = notebookId;
    }

    const cards = findStudioCards(studioPanel);

    // Détection de contradiction : cache absent ou vide alors que des cartes existent dans le DOM (SPA load précoce)
    const needsRefetch = !cachedDbItems || (cachedDbItems.length === 0 && cards.length > 0);
    if (notebookId && needsRefetch && !isFetchingDbItems) {
      fetchStudioItems(notebookId);
    }

    let visibleCount = 0;

    cards.forEach(card => {
      const title = getStudioCardTitle(card).toLowerCase();
      const cardType = getCardType(card, title);

      // Normaliser le type pour le filtrage ('other' pour tout typeCode inconnu hors 1..9 et note)
      let filterType = cardType;
      if (cardType !== 'note' && !KNOWN_CODES.includes(cardType)) {
        filterType = 'other';
      }

      const matchesText = !currentQuery || title.includes(currentQuery);
      const matchesType = activeTypeFilters.size === 0 || activeTypeFilters.has(filterType);

      if (matchesText && matchesType) {
        card.style.display = '';
        visibleCount++;
      } else {
        card.style.display = 'none';
      }
    });

    const isFilteringActive = currentQuery.length > 0 || activeTypeFilters.size > 0;
    if (visibleCount === 0 && isFilteringActive) {
      showNoResultsMessage(studioPanel);
    } else {
      hideNoResultsMessage();
    }
  }

  /**
   * Debounce l'exécution du filtre texte.
   */
  const performSearch = debounce(function () {
    const input = searchBarContainer ? searchBarContainer.querySelector('.mm-studio-search-input') : null;
    currentQuery = input ? input.value.trim().toLowerCase() : '';
    applyFilters();
  }, 150);

  // ═══════════════════════════════════════════════════════════════════════
  // Message "aucun résultat"
  // ═══════════════════════════════════════════════════════════════════════

  function showNoResultsMessage(studioPanel) {
    if (noResultsElement) return;

    noResultsElement = createElement('div', {
      className: 'mm-studio-no-results',
      role: 'status',
      textContent: t('studioNoResults') || 'Aucun résultat dans le Studio'
    });

    const libraryContainer = studioPanel.querySelector('.artifact-library-container, [class*="library-container"]');
    if (libraryContainer) {
      libraryContainer.appendChild(noResultsElement);
    } else {
      studioPanel.appendChild(noResultsElement);
    }
  }

  function hideNoResultsMessage() {
    if (noResultsElement) {
      noResultsElement.remove();
      noResultsElement = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Composants et UI
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Crée l'icône SVG du bouton de filtre (filter_list).
   */
  function createFilterIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');

    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z');
    svg.appendChild(path);
    return svg;
  }

  /**
   * Crée le bouton filtre.
   */
  function createFilterButton() {
    const filterBtn = createElement('button', {
      className: 'mm-studio-search-filter' + (activeTypeFilters.size > 0 ? ' mm-active' : ''),
      type: 'button',
      'aria-label': t('studioFilterLabel') || 'Filtrer par type',
      title: t('studioFilterLabel') || 'Filtrer par type',
      onClick: function (e) {
        e.stopPropagation();
        toggleFilterPopover(filterBtn);
      }
    });
    filterBtn.appendChild(createFilterIcon());
    return filterBtn;
  }

  /**
   * Affiche ou masque le popover contenant la sélection des types d'artéfacts.
   */
  function toggleFilterPopover(anchorBtn) {
    if (filterPopoverEl && filterPopoverEl.parentNode) {
      filterPopoverEl.remove();
      filterPopoverEl = null;
      anchorBtn.classList.toggle('mm-active', activeTypeFilters.size > 0);
      return;
    }

    anchorBtn.classList.add('mm-active');
    filterPopoverEl = createElement('div', {
      className: 'mm-studio-filter-popover'
    });

    // Isoler le popover de l'interception Angular : bloquer la propagation
    // des clics/mousedown pour que les handlers de cartes Angular ne capturent pas nos clics
    filterPopoverEl.addEventListener('click', function (e) { e.stopPropagation(); });
    filterPopoverEl.addEventListener('mousedown', function (e) { e.stopPropagation(); });

    // Injecter les options pour chaque type d'artéfact
    ARTIFACT_TYPES.forEach(type => {
      const checkbox = createElement('input', {
        type: 'checkbox',
        style: 'margin: 0; cursor: pointer;'
      });
      if (activeTypeFilters.has(type.code)) {
        checkbox.checked = true;
      }

      // Utiliser click au lieu de change pour une meilleure fiabilité dans l'environnement Angular
      checkbox.addEventListener('click', function (e) {
        e.stopPropagation();
        if (checkbox.checked) {
          activeTypeFilters.add(type.code);
        } else {
          activeTypeFilters.delete(type.code);
        }
        applyFilters();
      });

      const label = createElement('label', {
        className: 'mm-studio-filter-option'
      }, [
        checkbox,
        createElement('span', { textContent: t(type.i18nKey) || type.i18nKey })
      ]);

      filterPopoverEl.appendChild(label);
    });

    // Bouton de réinitialisation des filtres
    const resetBtn = createElement('button', {
      className: 'mm-studio-filter-reset',
      type: 'button',
      textContent: t('studioFilterReset') || 'Réinitialiser',
      onClick: function (e) {
        e.stopPropagation();
        activeTypeFilters.clear();
        filterPopoverEl.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
        anchorBtn.classList.remove('mm-active');
        applyFilters();
      }
    });
    filterPopoverEl.appendChild(resetBtn);

    // Positionnement sous la barre de recherche
    anchorBtn.parentNode.appendChild(filterPopoverEl);

    // Écouter le clic à l'extérieur pour fermer le popover
    setTimeout(function () {
      document.addEventListener('click', function closePopover(e) {
        if (filterPopoverEl && !filterPopoverEl.contains(e.target) && e.target !== anchorBtn) {
          filterPopoverEl.remove();
          filterPopoverEl = null;
          anchorBtn.classList.toggle('mm-active', activeTypeFilters.size > 0);
          document.removeEventListener('click', closePopover);
        }
      });
    }, 0);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Injection et Cycle de vie
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Injecte la barre de recherche Studio si elle est absente.
   */
  function checkAndInjectStudioSearch() {
    // Garde 1 : Préférence activée
    if (typeof window.MM.isFeatureEnabled === 'function' && !window.MM.isFeatureEnabled('studioSearch')) {
      if (searchBarContainer) {
        searchBarContainer.remove();
        searchBarContainer = null;
      }
      return;
    }

    const studioPanel = findStudioPanel();
    if (!studioPanel) return;

    // Garde 1.5 : Panneau replié (< 120px) ?
    const rect = studioPanel.getBoundingClientRect();
    if (rect.width < 120) {
      if (searchBarContainer) {
        searchBarContainer.style.display = 'none';
      }
      if (filterPopoverEl) {
        filterPopoverEl.remove();
        filterPopoverEl = null;
      }
      return;
    }

    // Garde 2 : Détecter si un artéfact ou une note est ouvert en consultation
    const isViewing = !!document.querySelector(
      "button[aria-label='Expand'], button[aria-label='Close note view'], " +
      ".artifact-viewer-container, [class*='artifact-viewer'], [class*='note-view']"
    );

    if (isViewing) {
      if (searchBarContainer) {
        searchBarContainer.style.display = 'none';
      }
      if (filterPopoverEl) {
        filterPopoverEl.remove();
        filterPopoverEl = null;
      }
      return;
    }

    const isMobile = typeof window.MM.detectDesktopLayout === 'function' && !window.MM.detectDesktopLayout();

    // Si déjà injectée, vérifier si la disposition a changé
    if (searchBarContainer) {
      const hasMobileClass = searchBarContainer.classList.contains('mm-mobile-layout');
      if ((isMobile && !hasMobileClass) || (!isMobile && hasMobileClass)) {
        // La disposition a changé ! On supprime la barre existante pour la reconstruire au bon endroit
        searchBarContainer.remove();
        searchBarContainer = null;
        if (filterPopoverEl) {
          filterPopoverEl.remove();
          filterPopoverEl = null;
        }
      }
    }

    // Réafficher si masqué précédemment
    if (searchBarContainer && searchBarContainer.style.display === 'none') {
      searchBarContainer.style.display = '';
      applyFilters();
      return;
    }

    // Si déjà injectée, ré-appliquer les filtres
    if (searchBarContainer && studioPanel.contains(searchBarContainer)) {
      applyFilters();
      return;
    }

    // Nettoyer d'éventuels orphelins
    if (searchBarContainer) {
      searchBarContainer.remove();
      searchBarContainer = null;
    }

    // ═══ Construction de la barre de recherche ═══
    const input = createElement('input', {
      type: 'text',
      className: 'mm-studio-search-input',
      placeholder: t('studioSearchPlaceholder') || 'Rechercher dans le Studio…',
      'aria-label': t('studioSearchPlaceholder') || 'Rechercher dans le Studio…',
      value: currentQuery,
      onInput: function () {
        clearBtn.classList.toggle('mm-visible', input.value.length > 0);
        performSearch();
      },
      onKeydown: function (e) {
        if (e.key === 'Escape') {
          input.value = '';
          currentQuery = '';
          applyFilters();
          clearBtn.classList.remove('mm-visible');
          input.blur();
        }
      }
    });

    const clearBtn = createElement('button', {
      className: 'mm-studio-search-clear' + (currentQuery ? ' mm-visible' : ''),
      type: 'button',
      'aria-label': t('searchClearLabel') || 'Effacer',
      textContent: '×',
      onClick: function () {
        input.value = '';
        currentQuery = '';
        applyFilters();
        clearBtn.classList.remove('mm-visible');
        input.focus();
      }
    });

    const filterBtn = createFilterButton();

    const searchWrapper = createElement('div', {
      className: 'mm-studio-search-wrapper'
    }, [input, clearBtn, filterBtn]);

    searchBarContainer = createElement('div', {
      className: 'mm-studio-search'
    }, [searchWrapper]);

    if (isMobile) {
      // En mode mobile, insérer tout au début du studioPanel pour qu'il soit sticky en haut du panneau
      studioPanel.insertBefore(searchBarContainer, studioPanel.firstChild);
      searchBarContainer.classList.add('mm-mobile-layout');
      console.log('[MM] Barre de recherche Studio injectée au sommet (mode mobile)');
    } else {
      // En mode desktop, insérer après le header s'il existe, ou au début
      const header = studioPanel.querySelector('.studio-header, [class*="header"], h2, h3');
      const tile = studioPanel.querySelector('.create-artifact-button-container, [class*="create-artifact"]');

      if (tile && tile.parentNode) {
        tile.parentNode.insertBefore(searchBarContainer, tile);
      } else if (header) {
        header.parentNode.insertBefore(searchBarContainer, header.nextSibling);
      } else {
        studioPanel.insertBefore(searchBarContainer, studioPanel.firstChild);
      }
      searchBarContainer.classList.add('mm-desktop-layout');
      console.log('[MM] Barre de recherche Studio injectée (mode desktop)');
    }

    // Amorcer le cache RPC dès l'injection de la pilule (premier chargement)
    const notebookId = window.MM.getActiveNotebookId();
    if (notebookId && !cachedDbItems && !isFetchingDbItems) {
      fetchStudioItems(notebookId);
    }
    // Ré-appliquer l'état de filtrage persistant si existant
    if (currentQuery || activeTypeFilters.size > 0) {
      applyFilters();
    }
  }

  /**
   * Focalise sur le champ de recherche du Studio.
   * Activé via le raccourci Alt+Shift+F.
   */
  function focusStudioSearch() {
    if (!searchBarContainer) {
      checkAndInjectStudioSearch();
    }
    if (searchBarContainer) {
      const input = searchBarContainer.querySelector('.mm-studio-search-input');
      if (input) {
        input.focus();
      }
    }
  }

  /**
   * Initialise le module StudioSearch.
   */
  function initStudioSearch() {
    checkAndInjectStudioSearch();
    console.log('[MM] Module studio-search initialisé');
  }

  /**
   * Nettoie les éléments injectés par le module.
   */
  function cleanupStudioSearch() {
    if (searchBarContainer) {
      searchBarContainer.remove();
      searchBarContainer = null;
    }
    if (filterPopoverEl) {
      filterPopoverEl.remove();
      filterPopoverEl = null;
    }
    hideNoResultsMessage();

    // Restaurer toutes les cartes masquées
    const studioPanel = findStudioPanel();
    if (studioPanel) {
      const cards = findStudioCards(studioPanel);
      cards.forEach(card => {
        card.style.display = '';
      });
    }

    currentQuery = '';
    activeTypeFilters.clear();
    cachedDbItems = null;
    lastFetchedNotebookId = null;
    console.log('[MM] Module studio-search nettoyé');
  }

  // Exposition dans le namespace global MM
  window.MM.initStudioSearch = initStudioSearch;
  window.MM.cleanupStudioSearch = cleanupStudioSearch;
  window.MM.checkAndInjectStudioSearch = checkAndInjectStudioSearch;
  window.MM.focusStudioSearch = focusStudioSearch;
})();
