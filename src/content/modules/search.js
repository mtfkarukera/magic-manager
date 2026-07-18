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
  // Détection de doublons
  // ═══════════════════════════════════════════════════════════════════════

  /** État du mode doublons */
  let isDuplicateMode = false;

  /**
   * Calcule le coefficient de Sørensen-Dice sur les bigrammes de deux chaînes.
   * @param {string} a
   * @param {string} b
   * @returns {number} Score entre 0 et 1.
   */
  function diceCoefficient(a, b) {
    a = a.toLowerCase().trim();
    b = b.toLowerCase().trim();
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;

    const bigramsA = new Set();
    for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.substring(i, i + 2));

    const bigramsB = new Set();
    for (let i = 0; i < b.length - 1; i++) bigramsB.add(b.substring(i, i + 2));

    let intersection = 0;
    bigramsA.forEach(function (bg) { if (bigramsB.has(bg)) intersection++; });

    return (2 * intersection) / (bigramsA.size + bigramsB.size);
  }

  /**
   * Extrait le titre propre d'une carte source.
   * Réutilise le helper centralisé si disponible.
   * @param {Element} card
   * @returns {string}
   */
  function getCardTitle(card) {
    if (typeof window.MM.getSourceTitle === 'function') {
      return window.MM.getSourceTitle(card);
    }
    if (typeof window.MM.findSourceCardFromCheckbox === 'function') {
      // Tenter de récupérer le titre propre de la source via la checkbox
      const cb = card.querySelector('input[type="checkbox"], [role="checkbox"]');
      if (cb) {
        const info = window.MM.findSourceCardFromCheckbox(cb);
        if (info && info.title) return info.title;
      }
    }
    // Fallback : extraire le texte principal en excluant les icônes Material
    const MATERIAL_ICON_NAMES = ['check_box', 'check_box_outline_blank',
      'more_vert', 'more_horiz', 'delete', 'edit', 'close'];
    let text = (card.textContent || '').trim();
    MATERIAL_ICON_NAMES.forEach(function (icon) {
      text = text.replace(new RegExp(icon, 'gi'), '');
    });
    return text.trim().split('\n')[0].trim();
  }

  /**
   * Passe 1 : Regroupe les sources dont les titres sont similaires (Dice ≥ 0.8).
   * @returns {Map<Element, {group: number, score: number}>}
   */
  function findTitleDuplicates() {
    const cards = findSourceCards();
    const titles = cards.map(getCardTitle);
    const groups = new Map(); // card → { group, score }
    let groupId = 0;

    for (let i = 0; i < cards.length; i++) {
      if (groups.has(cards[i])) continue;
      let hasMatch = false;

      for (let j = i + 1; j < cards.length; j++) {
        if (groups.has(cards[j]) && groups.get(cards[j]).group !== groupId) continue;

        const score = diceCoefficient(titles[i], titles[j]);
        if (score >= 0.8) {
          if (!hasMatch) {
            groups.set(cards[i], { group: groupId, score: 1.0 });
            hasMatch = true;
          }
          groups.set(cards[j], { group: groupId, score: score });
        }
      }

      if (hasMatch) groupId++;
    }

    return groups;
  }

  /**
   * Passe 2 : Calcule le checksum SHA-256 des premiers 2000 caractères du contenu
   * pour les groupes candidats. Exécute les appels RPC de manière séquentielle.
   * @param {Map<Element, {group: number, score: number}>} groups
   * @returns {Promise<Map<Element, {group: number, score: number}>>}
   */
  async function refineDuplicatesWithChecksum(groups) {
    // Regrouper les cards par groupId
    const groupMap = new Map(); // groupId → [{ card, sourceId }]
    groups.forEach(function (info, card) {
      if (!groupMap.has(info.group)) groupMap.set(info.group, []);
      // Extraire le sourceId depuis le DOM (data-source-id ou parsing)
      const sourceId = card.getAttribute('data-source-id') ||
                       (card.querySelector('[data-source-id]') || {}).dataset?.sourceId || null;
      groupMap.get(info.group).push({ card, sourceId });
    });

    // Pour chaque groupe, récupérer le contenu et calculer le hash
    for (const [gId, members] of groupMap) {
      const hashes = [];
      for (const member of members) {
        if (!member.sourceId) {
          hashes.push(null);
          continue;
        }
        try {
          // Récupérer les 2000 premiers caractères via le RPC existant
          const notebookId = window.MM._currentNotebookId ||
            window.location.pathname.split('/notebook/')[1]?.split('/')[0];
          const content = await window.MM.getSourceContent(member.sourceId, notebookId);
          const snippet = (content || '').substring(0, 2000);
          // Hash SHA-256 via Web Crypto API
          const encoder = new TextEncoder();
          const data = encoder.encode(snippet);
          const hashBuffer = await crypto.subtle.digest('SHA-256', data);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          const hashHex = hashArray.map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
          hashes.push(hashHex);
        } catch (err) {
          console.warn('[MM] Erreur checksum pour source', member.sourceId, err);
          hashes.push(null);
        }
      }

      // Comparer les hashes pour affiner les scores
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          if (hashes[i] && hashes[j] && hashes[i] === hashes[j]) {
            // Même contenu → score 1.0 (doublon confirmé)
            groups.get(members[i].card).score = 1.0;
            groups.get(members[j].card).score = 1.0;
          }
        }
      }
    }

    return groups;
  }

  // Couleurs associées aux niveaux de similarité
  const DUPE_COLORS = [
    'hsl(0, 80%, 60%)',    // Groupe 0 : rouge
    'hsl(30, 80%, 55%)',   // Groupe 1 : orange
    'hsl(270, 60%, 55%)',  // Groupe 2 : violet
    'hsl(180, 60%, 45%)',  // Groupe 3 : cyan
    'hsl(120, 50%, 45%)',  // Groupe 4 : vert
    'hsl(330, 70%, 55%)',  // Groupe 5 : rose
  ];

  /**
   * Applique le mode visuel doublons : masque les non-doublons, ajoute un badge coloré.
   * @param {Map<Element, {group: number, score: number}>} groups
   */
  function applyDuplicateView(groups) {
    const cards = findSourceCards();
    let dupeCount = 0;

    cards.forEach(function (card) {
      // Nettoyer les badges précédents
      const oldBadge = card.querySelector('.mm-dupe-badge');
      if (oldBadge) oldBadge.remove();

      if (groups.has(card)) {
        card.style.display = '';
        const info = groups.get(card);
        const color = DUPE_COLORS[info.group % DUPE_COLORS.length];
        const pct = Math.round(info.score * 100);

        const badge = createElement('span', {
          className: 'mm-dupe-badge',
          textContent: pct + '%',
          title: t('searchDupeScore', [String(pct)])
        });
        badge.style.setProperty('--mm-dupe-color', color);
        card.style.setProperty('--mm-dupe-border-color', color);
        card.classList.add('mm-dupe-highlight');
        // Injecter le badge au début de la carte
        card.insertBefore(badge, card.firstChild);
        dupeCount++;
      } else {
        card.style.display = 'none';
      }
    });

    if (dupeCount === 0 && groups.size === 0) {
      showNoResultsMessage();
      // Remplacer le texte par le message "aucun doublon"
      if (noResultsElement) {
        noResultsElement.textContent = t('searchNoDuplicates');
      }
    }
  }

  /**
   * Nettoie le mode visuel doublons et restaure l'affichage normal.
   */
  function clearDuplicateView() {
    const cards = findSourceCards();
    cards.forEach(function (card) {
      card.style.display = '';
      card.classList.remove('mm-dupe-highlight');
      card.style.removeProperty('--mm-dupe-border-color');
      const badge = card.querySelector('.mm-dupe-badge');
      if (badge) badge.remove();
    });
    hideNoResultsMessage();
  }

  /**
   * Handler du clic sur le bouton de détection de doublons.
   */
  async function handleDuplicateSearch() {
    if (isDuplicateMode) {
      // Désactiver le mode doublons → restaurer la vue normale
      isDuplicateMode = false;
      clearDuplicateView();
      // Ré-appliquer le filtre texte courant
      applyFilter(currentQuery);
      // Retirer la classe active du bouton
      const btn = searchBarContainer?.querySelector('.mm-search-dupes-btn');
      if (btn) btn.classList.remove('mm-active');
      return;
    }

    isDuplicateMode = true;
    const btn = searchBarContainer?.querySelector('.mm-search-dupes-btn');
    if (btn) btn.classList.add('mm-active');

    // Passe 1 : Similarité de titre (instantané)
    const groups = findTitleDuplicates();

    if (groups.size === 0) {
      applyDuplicateView(groups); // Affiche "aucun doublon"
      return;
    }

    // Afficher la vue préliminaire (titres similaires)
    applyDuplicateView(groups);

    // Passe 2 : Checksum de contenu (asynchrone, ciblé)
    try {
      await refineDuplicatesWithChecksum(groups);
      // Ré-appliquer avec les scores affinés
      applyDuplicateView(groups);
    } catch (err) {
      console.warn('[MM] Passe 2 checksum échouée, conservation des résultats de la passe 1', err);
    }
  }

  /**
   * Crée l'icône SVG du bouton doublons (content_copy Material).
   * @returns {SVGElement}
   */
  function createDupeIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');

    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d',
      'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 ' +
      '1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z'
    );
    svg.appendChild(path);
    return svg;
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
      onInput: function () {
        clearBtn.classList.toggle('mm-visible', input.value.length > 0);
        performSearch();
      },

      onKeydown: function (e) {
        if (e.key === 'Escape') {
          input.value = '';
          currentQuery = '';
          applyFilter('');
          clearBtn.classList.remove('mm-visible');
          input.blur();
        }
      }
    });

    // Bouton de réinitialisation (croix)
    const clearBtn = createElement('button', {
      className: 'mm-search-clear' + (currentQuery ? ' mm-visible' : ''),
      type: 'button',
      'aria-label': t('searchClearLabel'),
      textContent: '×',
      onClick: function () {
        input.value = '';
        currentQuery = '';
        applyFilter('');
        clearBtn.classList.remove('mm-visible');
        input.focus();
      }
    });

    // Bouton de détection des doublons
    const dupeBtn = createElement('button', {
      className: 'mm-search-dupes-btn' + (isDuplicateMode ? ' mm-active' : ''),
      type: 'button',
      'aria-label': t('searchDupesLabel'),
      title: t('searchDupesLabel'),
      onClick: handleDuplicateSearch
    });
    dupeBtn.appendChild(createDupeIcon());

    searchBarContainer = createElement('div', {
      className: 'mm-search-bar'
    }, [input, clearBtn, dupeBtn]);

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

    console.log('[MM] Module recherche initialisé');
  }

  /**
   * Nettoie les éléments injectés par le module.
   */
  function cleanupSearch() {
    // Réinitialiser le mode doublons
    isDuplicateMode = false;
    clearDuplicateView();

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
