// source-badges.js — Badges visuels de type de source
// Auteur : MTF Karukera | Licence : MPL-2.0
//
// Identifie visuellement la provenance des sources (Drive, URL, Local)
// par des icônes de couleur injectées dans les cartes sources du DOM.

'use strict';

(function () {
  // Cache en mémoire pour stocker les types de sources (titre -> code de type)
  const sourceTypesCache = new Map();
  
  // Notebook ID en cours d'observation pour invalider le cache si changement de notebook
  let currentNotebookId = null;
  
  // Verrou pour éviter des appels RPC concurrents de récupération de sources
  let isFetching = false;

  // Variables pour la logique de retry intelligent en cas de DOM non hydraté
  let retryCount = 0;
  let retryTimer = null;
  let lastCardsCount = 0;
  const MAX_RETRIES = 5;
  const RETRY_DELAYS = [500, 1000, 1500, 2000, 3000]; // Délais de backoff progressif en ms

  // ═══════════════════════════════════════════════════════════════════════
  // Générateurs d'icônes SVG pour les badges
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Crée l'icône de synchronisation pour Google Drive (🔄).
   */
  function createDriveSvg() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M19 8l-4 4h3c0 3.31-2.69 6-6 6-1.01 0-1.97-.25-2.8-.7l-1.46 1.46C8.97 19.54 10.43 20 12 20c4.42 0 8-3.58 8-8h3l-4-4zM6 12c0-3.31 2.69-6 6-6 1.01 0 1.97.25 2.8.7l1.46-1.46C15.03 4.46 13.57 4 12 4c-4.42 0-8 3.58-8 8H1l4 4 4-4H6z');
    svg.appendChild(path);
    return svg;
  }

  /**
   * Crée l'icône de planète/globe pour les URLs web (🌐).
   */
  function createUrlSvg() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.53c-.26-.81-1-1.4-1.9-1.4h-1v-3c0-.55-.45-1-1-1h-6v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.4z');
    svg.appendChild(path);
    return svg;
  }

  /**
   * Crée l'icône de fichier/carré pour les uploads locaux (▢).
   */
  function createLocalSvg() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z');
    svg.appendChild(path);
    return svg;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Logique métier & Cache
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Appelle l'API RPC pour charger et mettre en cache les types de sources du notebook actif.
   */
  async function fetchAndCacheSourceTypes() {
    const notebookId = window.MM.getActiveNotebookId();
    if (!notebookId) return;

    if (notebookId !== currentNotebookId) {
      sourceTypesCache.clear();
      currentNotebookId = notebookId;
    }

    if (sourceTypesCache.size > 0 || isFetching) return;

    isFetching = true;
    try {
      console.log('[MM] Chargement des types de sources via RPC...');
      const rpcSources = await window.MM.rpc.getNotebookSources(notebookId);
      if (Array.isArray(rpcSources)) {
        rpcSources.forEach(function (src) {
          if (src && src.title && src.kind !== undefined) {
            const normalizedTitle = src.title.trim().toLowerCase();
            sourceTypesCache.set(normalizedTitle, src.kind);
          }
        });
        retryCount = 0;
        injectBadges();
      }
    } catch (err) {
      console.error('[MM] Erreur lors du chargement des types de sources :', err);
    } finally {
      isFetching = false;
    }
  }

  function getCategoryByKind(kind) {
    if (kind === 1 || kind === 2 || kind === 14) {
      return 'drive';
    }
    if (kind === 5 || kind === 9) {
      return 'url';
    }
    return 'local';
  }

  function planRetry() {
    if (retryTimer) return;
    const delay = RETRY_DELAYS[retryCount] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
    retryTimer = setTimeout(function () {
      retryTimer = null;
      retryCount++;
      injectBadges();
    }, delay);
  }

  function cleanupRetry() {
    retryCount = 0;
    lastCardsCount = 0;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function injectBadges() {
    if (!window.MM.isFeatureEnabled('badges')) return;

    const notebookId = window.MM.getActiveNotebookId();
    if (!notebookId) {
      cleanupRetry();
      return;
    }

    // Détection immédiate du changement de notebook
    if (notebookId !== currentNotebookId) {
      sourceTypesCache.clear();
      currentNotebookId = notebookId;
      cleanupRetry();
    }

    if (sourceTypesCache.size === 0) {
      fetchAndCacheSourceTypes();
      planRetry();
      return;
    }

    const cards = typeof window.MM.findSourceCards === 'function' ? window.MM.findSourceCards() : [];
    
    // Réinitialiser les tentatives si le nombre de cartes a changé (ex. ajout/suppression de source)
    if (cards.length !== lastCardsCount) {
      retryCount = 0;
      lastCardsCount = cards.length;
    }

    let unbadgedCount = 0;

    if (cards.length > 0) {
      cards.forEach(function (card) {
        if (card.getAttribute('data-mm-badge') === 'true') return;

        const stretchedBtn = card.querySelector('button.source-stretched-button');
        if (!stretchedBtn) {
          unbadgedCount++;
          return;
        }

        const ariaLabel = stretchedBtn.getAttribute('aria-label') || '';
        const normalizedTitle = ariaLabel.trim().toLowerCase();

        if (!normalizedTitle) {
          unbadgedCount++;
          return;
        }

        // Essayer de faire un match flexible si has() exact échoue (gestion des troncatures ou points de suspension)
        let foundKind = null;
        if (sourceTypesCache.has(normalizedTitle)) {
          foundKind = sourceTypesCache.get(normalizedTitle);
        } else {
          // Recherche partielle (si le titre DOM est de type "nom...")
          const cleanDomTitle = normalizedTitle.replace(/\.\.\./g, '').trim();
          for (const [cacheTitle, kind] of sourceTypesCache.entries()) {
            if (cacheTitle.startsWith(cleanDomTitle) || cleanDomTitle.startsWith(cacheTitle)) {
              foundKind = kind;
              break;
            }
          }
        }

        if (foundKind !== null) {
          const category = getCategoryByKind(foundKind);
          let svgElement;
          if (category === 'drive') {
            svgElement = createDriveSvg();
          } else if (category === 'url') {
            svgElement = createUrlSvg();
          } else {
            svgElement = createLocalSvg();
          }

          const badge = document.createElement('span');
          badge.className = `mm-source-badge mm-source-badge--${category}`;
          badge.title = category.charAt(0).toUpperCase() + category.slice(1);
          badge.appendChild(svgElement);
          // Localiser le nœud de titre visible dans la carte (hors bouton stretched/checkbox)
          const titleText = stretchedBtn.getAttribute('aria-label') || '';
          const titleNode = findTitleNode(card, titleText);

          if (titleNode) {
            titleNode.parentNode.insertBefore(badge, titleNode);
            card.setAttribute('data-mm-badge', 'true');
          } else {
            // Fallback : insérer après le premier enfant de la carte
            const firstChild = card.firstElementChild;
            if (firstChild) {
              firstChild.after(badge);
            } else {
              card.prepend(badge);
            }
            card.setAttribute('data-mm-badge', 'true');
          }
        } else {
          unbadgedCount++;
        }
      });
    } else {
      // Pas encore de cartes dans le DOM, mais on a un notebookId : planifier un retry
      unbadgedCount = 1;
    }

    // Gérer la planification du retry
    if (unbadgedCount > 0 && retryCount < MAX_RETRIES) {
      planRetry();
    } else {
      retryCount = 0; // Succès total ou abandon
    }
  }

  /**
   * Localise le nœud DOM qui contient le titre de la source de façon robuste.
   * @param {Element} card - Le conteneur de la carte source.
   * @param {string} titleText - Le titre de la source.
   * @returns {Element|null}
   */
  function findTitleNode(card, titleText) {
    // 1. Essayer les sélecteurs de classe de titre connus (exclure boutons/checkboxes/icônes)
    const knownTitle = card.querySelector('.source-title, [class*="title"], [class*="name"]');
    if (knownTitle && 
        knownTitle.textContent.trim().length > 0 && 
        !knownTitle.matches('button, input, [role="checkbox"], mat-icon, svg, .mm-source-badge')) {
      return knownTitle;
    }

    // 2. Recherche textuelle parmi les descendants span, div, p
    const candidates = card.querySelectorAll('span, div, p');
    const normalizedTitle = titleText.trim().toLowerCase();
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      if (el.matches('button, input, mat-icon, svg, [role="checkbox"], .mm-source-badge')) continue;
      
      const txt = el.textContent.trim().toLowerCase();
      if (txt && normalizedTitle.includes(txt)) {
        return el;
      }
    }

    // 3. Fallback : premier élément avec du texte significatif
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      if (el.matches('button, input, mat-icon, svg, [role="checkbox"], .mm-source-badge')) continue;
      if (el.textContent.trim().length > 1) {
        return el;
      }
    }

    return null;
  }

  /**
   * Supprime tous les badges injectés dans le DOM et vide le cache.
   */
  function cleanupBadges() {
    document.querySelectorAll('.mm-source-badge').forEach(function (el) {
      el.remove();
    });
    
    document.querySelectorAll('[data-mm-badge="true"]').forEach(function (card) {
      card.removeAttribute('data-mm-badge');
    });

    sourceTypesCache.clear();
    currentNotebookId = null;
    cleanupRetry();
    console.log('[MM] Badges visuels de sources nettoyés.');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Initialisation du module
  // ═══════════════════════════════════════════════════════════════════════

  function initBadges() {
    fetchAndCacheSourceTypes();
    injectBadges();
    console.log('[MM] Module badges initialisé');
  }

  // Exports publics
  window.MM.initBadges = initBadges;
  window.MM.cleanupBadges = cleanupBadges;
  window.MM.injectBadges = injectBadges;
})();
