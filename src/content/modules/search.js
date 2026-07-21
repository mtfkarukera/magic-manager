// search.js — Module de recherche globale dans les sources (F1)
// Auteur : MTF Karukera | Licence : MPL-2.0
// Dépendance : window.MM (utils.js chargé avant)

'use strict';

(function () {
  const { t, createElement, debounce, findSourceCards } = window.MM;

  // ═══════════════════════════════════════════════════════════════════════
  // État interne
  // ═══════════════════════════════════════════════════════════════════════

  /** Référence à la barre de recherche injectée */
  let searchBarContainer = null;

  /** Référence à l'élément de message d'erreur/vide */
  let noResultsElement = null;

  /** Requête de recherche courante pour assurer la persistance lors des transitions SPA */
  let currentQuery = '';

  /** Identifiant du dernier carnet connu pour réinitialiser la recherche au changement de carnet */
  let lastNotebookId = null;

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

  /** Verrou anti-double-clic pendant le scan de contenu */
  let isScanning = false;

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
   * Extrait un ensemble de mots significatifs (> 3 lettres) d'un texte.
   * Utilisé pour la comparaison Jaccard entre sources.
   * @param {string} text
   * @returns {Set<string>}
   */
  function extractWordSet(text) {
    return new Set(
      (text || '')
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(function (w) { return w.length > 3; })
    );
  }

  /**
   * Calcule le coefficient de Jaccard entre deux ensembles de mots.
   * Jaccard = |intersection| / |union|
   * @param {Set<string>} setA
   * @param {Set<string>} setB
   * @returns {number} Score entre 0 et 1.
   */
  function jaccardSimilarity(setA, setB) {
    if (setA.size === 0 && setB.size === 0) return 0;
    var intersection = 0;
    setA.forEach(function (w) { if (setB.has(w)) intersection++; });
    var union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  /** Seuil Jaccard pour considérer deux sources comme doublons de contenu */
  var JACCARD_THRESHOLD = 0.6;

  /**
   * Tente d'associer une source RPC à une carte DOM.
   * Stratégie 1 : data-source-id sur la carte.
   * Stratégie 2 : correspondance stricte par titre (Dice ≥ 0.95).
   * @param {Object} rpcSource - {id, title, kind}
   * @param {Array<Element>} cards
   * @param {Set<Element>} usedCards - Cartes déjà associées (évite les collisions).
   * @returns {Element|null}
   */
  function matchRpcSourceToCard(rpcSource, cards, usedCards) {
    // Stratégie 1 : attribut data-source-id
    for (var i = 0; i < cards.length; i++) {
      if (usedCards.has(cards[i])) continue;
      var sid = cards[i].getAttribute('data-source-id') ||
        (cards[i].querySelector('[data-source-id]') || {}).dataset?.sourceId;
      if (sid === rpcSource.id) {
        usedCards.add(cards[i]);
        return cards[i];
      }
    }
    // Stratégie 2 : correspondance par titre (Dice ≥ 0.95)
    var rpcTitle = (rpcSource.title || '').toLowerCase().trim();
    for (var j = 0; j < cards.length; j++) {
      if (usedCards.has(cards[j])) continue;
      var cardTitle = getCardTitle(cards[j]).toLowerCase().trim();
      if (diceCoefficient(rpcTitle, cardTitle) >= 0.95) {
        usedCards.add(cards[j]);
        return cards[j];
      }
    }
    return null;
  }

  /**
   * Passe 2 autonome : scanne TOUTES les sources du carnet par leur contenu.
   * Compare les ensembles de mots par paires avec le coefficient de Jaccard.
   * Regroupe les sources ayant un Jaccard ≥ JACCARD_THRESHOLD.
   * @param {function(number, number): void} [onProgress] - Callback (current, total).
   * @returns {Promise<Map<Element, {group: number, score: number}>>}
   */
  async function findContentDuplicates(onProgress) {
    var notebookId = window.MM._currentNotebookId ||
      window.location.pathname.split('/notebook/')[1]?.split('/')[0];
    if (!notebookId) return new Map();

    // 1. Lister toutes les sources du carnet via RPC
    var rpcSources = await window.MM.rpc.getNotebookSources(notebookId);
    if (!rpcSources || rpcSources.length < 2) return new Map();

    console.log('[MM] Passe 2 contenu : ' + rpcSources.length + ' sources à scanner');

    // 2. Extraire les ensembles de mots de chaque source séquentiellement
    var wordSets = []; // [{rpcSource, words: Set}]
    for (var i = 0; i < rpcSources.length; i++) {
      if (onProgress) onProgress(i + 1, rpcSources.length);
      try {
        var content = await window.MM.rpc.getSourceContent(
          rpcSources[i].id, notebookId
        );
        var words = extractWordSet(content);
        wordSets.push({ rpcSource: rpcSources[i], words: words });
      } catch (err) {
        console.warn('[MM] Passe 2 : erreur pour', rpcSources[i].id, err);
        wordSets.push({ rpcSource: rpcSources[i], words: new Set() });
      }
    }

    // 3. Comparer chaque paire de sources avec Jaccard
    // Union-Find simplifié pour regrouper les doublons transitifs
    var parent = []; // parent[i] = index du représentant du groupe
    for (var k = 0; k < wordSets.length; k++) parent[k] = k;

    function find(x) {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    }
    function unite(a, b) {
      var ra = find(a), rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    }

    var pairScores = new Map(); // "i,j" → score (pour le badge)
    for (var a = 0; a < wordSets.length; a++) {
      if (wordSets[a].words.size === 0) continue;
      for (var b = a + 1; b < wordSets.length; b++) {
        if (wordSets[b].words.size === 0) continue;
        var score = jaccardSimilarity(wordSets[a].words, wordSets[b].words);
        if (score >= JACCARD_THRESHOLD) {
          unite(a, b);
          pairScores.set(a + ',' + b, score);
        }
      }
    }

    // 4. Construire les groupes de doublons et mapper vers les cartes DOM
    var cards = findSourceCards();
    var usedCards = new Set();
    var groupsByRoot = new Map(); // root index → groupId
    var contentGroups = new Map(); // card → {group, score}
    var groupId = 0;

    for (var idx = 0; idx < wordSets.length; idx++) {
      var root = find(idx);
      if (root === idx) {
        // Vérifier si ce root a d'autres membres
        var hasMembers = false;
        for (var m = 0; m < wordSets.length; m++) {
          if (m !== idx && find(m) === root) { hasMembers = true; break; }
        }
        if (!hasMembers) continue; // Source unique, pas un doublon
      }

      // Assigner un groupId au root si pas encore fait
      if (!groupsByRoot.has(root)) {
        groupsByRoot.set(root, groupId++);
      }
      var gId = groupsByRoot.get(root);

      // Trouver le meilleur score Jaccard de cet index avec un autre membre du groupe
      var bestScore = 0;
      for (var p = 0; p < wordSets.length; p++) {
        if (p === idx || find(p) !== root) continue;
        var key = Math.min(idx, p) + ',' + Math.max(idx, p);
        var s = pairScores.get(key) || 0;
        if (s > bestScore) bestScore = s;
      }

      var card = matchRpcSourceToCard(wordSets[idx].rpcSource, cards, usedCards);
      if (card) {
        contentGroups.set(card, { group: gId, score: bestScore });
      } else {
        console.warn('[MM] Passe 2 : aucune carte DOM pour "' + wordSets[idx].rpcSource.title + '"');
      }
    }

    console.log('[MM] Passe 2 terminée : ' + contentGroups.size + ' doublons de contenu détectés');
    return contentGroups;
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
   * Fusionne les résultats des Passes 1 (titres) et 2 (contenu) par union.
   * Les groupIds de la Passe 2 sont décalés pour éviter les collisions de couleurs.
   * Si une carte apparaît dans les deux passes, on conserve le score le plus élevé.
   * @param {Map<Element, {group: number, score: number}>} titleGroups
   * @param {Map<Element, {group: number, score: number}>} contentGroups
   * @returns {Map<Element, {group: number, score: number}>}
   */
  function mergeDuplicateGroups(titleGroups, contentGroups) {
    var merged = new Map();

    // Trouver le groupId max de la Passe 1 pour décaler la Passe 2
    var maxTitleGroup = -1;
    titleGroups.forEach(function (info) {
      if (info.group > maxTitleGroup) maxTitleGroup = info.group;
    });
    var offset = maxTitleGroup + 1;

    // Copier la Passe 1
    titleGroups.forEach(function (info, card) {
      merged.set(card, { group: info.group, score: info.score });
    });

    // Fusionner la Passe 2 (avec décalage de groupId)
    contentGroups.forEach(function (info, card) {
      if (merged.has(card)) {
        // La carte existe déjà (Passe 1) → conserver le meilleur score
        var existing = merged.get(card);
        if (info.score > existing.score) {
          existing.score = info.score;
        }
      } else {
        // Nouvelle carte (détectée uniquement par contenu)
        merged.set(card, { group: info.group + offset, score: info.score });
      }
    });

    return merged;
  }

  /**
   * Handler du clic sur le bouton de détection de doublons.
   * Flux progressif : Passe 1 (titres, instantanée) puis Passe 2 (contenu, asynchrone).
   */
  async function handleDuplicateSearch() {
    // Verrou anti-double-clic pendant un scan en cours
    if (isScanning) return;

    if (isDuplicateMode) {
      // Désactiver le mode doublons → restaurer la vue normale
      isDuplicateMode = false;
      clearDuplicateView();
      // Ré-appliquer le filtre texte courant
      applyFilter(currentQuery);
      // Retirer la classe active du bouton
      var btn = searchBarContainer ? searchBarContainer.querySelector('.mm-search-dupes-btn') : null;
      if (btn) btn.classList.remove('mm-active');
      return;
    }

    isDuplicateMode = true;
    var btn = searchBarContainer ? searchBarContainer.querySelector('.mm-search-dupes-btn') : null;
    if (btn) btn.classList.add('mm-active');

    // Passe 1 : Similarité de titre (instantané)
    var titleGroups = findTitleDuplicates();

    // Afficher la vue préliminaire (Passe 1 seule)
    if (titleGroups.size > 0) {
      applyDuplicateView(titleGroups);
    }

    // Passe 2 : Scan contenu autonome (toutes les sources, asynchrone)
    isScanning = true;
    if (btn) btn.classList.add('mm-scanning');

    try {
      var contentGroups = await findContentDuplicates(function (current, total) {
        // Callback de progression (exploitable pour un futur indicateur textuel)
        console.log('[MM] Passe 2 : scan ' + current + '/' + total);
      });

      // Fusionner les résultats des deux passes
      var merged = mergeDuplicateGroups(titleGroups, contentGroups);

      // Afficher la vue finale fusionnée
      applyDuplicateView(merged);
    } catch (err) {
      console.warn('[MM] Passe 2 échouée, conservation des résultats de la passe 1', err);
      // En cas d'erreur, on garde la vue de la Passe 1 (déjà affichée)
      if (titleGroups.size === 0) {
        applyDuplicateView(titleGroups);
      }
    } finally {
      isScanning = false;
      if (btn) btn.classList.remove('mm-scanning');
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

    // Réinitialiser la recherche lors d'un changement de carnet strict
    const activeNotebookId = typeof window.MM.getActiveNotebookId === 'function'
      ? window.MM.getActiveNotebookId()
      : null;

    if (!activeNotebookId) {
      lastNotebookId = null;
      currentQuery = '';
    } else if (lastNotebookId && activeNotebookId !== lastNotebookId) {
      lastNotebookId = activeNotebookId;
      currentQuery = '';
      if (isDuplicateMode) {
        isDuplicateMode = false;
        clearDuplicateView();
        const dupeBtn = searchBarContainer ? searchBarContainer.querySelector('.mm-search-dupes-btn') : null;
        if (dupeBtn) {
          dupeBtn.classList.remove('mm-active', 'mm-scanning');
        }
      }
      if (searchBarContainer) {
        const input = searchBarContainer.querySelector('.mm-search-input');
        if (input) input.value = '';
        const clearBtn = searchBarContainer.querySelector('.mm-search-clear');
        if (clearBtn) clearBtn.classList.remove('mm-visible');
      }
      applyFilter('');
    } else {
      lastNotebookId = activeNotebookId;
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

    // En mode mobile, forcer l'utilisation du sticky-header même si le panel-header existe
    const isMobileLayout = typeof window.MM.detectDesktopLayout === 'function' && !window.MM.detectDesktopLayout();

    if (sourcePanel && header && !isMobileLayout) {
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

    // Ne réinitialiser la requête que si nous ne sommes plus sur un carnet
    const currentId = typeof window.MM.getActiveNotebookId === 'function' ? window.MM.getActiveNotebookId() : null;
    if (!currentId) {
      currentQuery = '';
      lastNotebookId = null;
    }

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
