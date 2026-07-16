// source-helpers.js — Fonctions partagées de détection DOM des sources
// Auteur : MTF Karukera | Licence : MPL-2.0
// Centralise les utilitaires utilisés par export.js et merge.js
// pour éviter la duplication de code et les scans DOM redondants.

'use strict';

(function () {
  // ═══════════════════════════════════════════════════════════════════════
  // Détection du conteneur de la liste des sources
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Localise le conteneur principal de la liste des sources NotebookLM.
   * Utilise uniquement querySelectorAll natif (pas de traversée Shadow DOM).
   * @returns {Element|null}
   */
  function findSourcesListContainer() {
    return document.querySelector(
      'section.source-panel, .source-panel, .sources-panel, ' +
      '[class*="source-panel"], [class*="sources-panel"], [class*="source-list"]'
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Détection de la ligne "Tout sélectionner"
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Localise la ligne "Tout sélectionner" dans le panneau des sources.
   * Optimisé : utilise querySelectorAll natif au lieu de findElementsInShadows.
   * @returns {Element|null}
   */
  function findSelectAllRow() {
    const list = findSourcesListContainer();
    if (!list) return null;

    // Scan natif — pas besoin de traverser le Shadow DOM (Angular utilise l'émulation CSS)
    const divs = list.querySelectorAll('div, span, button');
    for (let i = 0; i < divs.length; i++) {
      const el = divs[i];
      // Ignorer les conteneurs parents qui englobent des cartes de sources
      if (el.querySelector && el.querySelector('.source-card, [class*="source-card"], [class*="source-item"]')) {
        continue;
      }
      const txt = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
      if (
        txt.includes('tout sélectionner') ||
        txt.includes('select all') ||
        txt.includes('seleccionar todo') ||
        txt.includes('alle auswählen')
      ) {
        let row = el.parentNode;
        while (row && row !== list && row.tagName !== 'DIV') {
          row = row.parentNode;
        }
        return row;
      }
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Récupération des checkboxes de sources cochées
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Retourne la liste des checkboxes de sources individuelles cochées.
   * Exclut automatiquement la case "Tout sélectionner" globale.
   * Optimisé : un seul querySelectorAll natif, findSelectAllRow mis en cache hors du filtre.
   * @returns {Array<Element>}
   */
  function getCheckedSourceCheckboxes() {
    const list = findSourcesListContainer();
    if (!list) return [];

    // Mise en cache du résultat de findSelectAllRow hors de la boucle de filtre
    const selectAllRow = findSelectAllRow();

    // Sélecteurs précis — querySelectorAll natif (pas de Shadow DOM nécessaire)
    const checkboxes = Array.from(list.querySelectorAll(
      'input[type="checkbox"], [role="checkbox"], mat-pseudo-checkbox, .mat-pseudo-checkbox'
    ));

    return checkboxes.filter(function (cb) {
      const isChecked =
        cb.getAttribute('aria-checked') === 'true' ||
        cb.checked === true ||
        cb.classList.contains('mat-pseudo-checkbox-checked') ||
        cb.getAttribute('state') === 'checked' ||
        (typeof cb.className === 'string' && cb.className.includes('checked')) ||
        cb.getAttribute('aria-selected') === 'true';

      // Exclure la case globale "Tout sélectionner" de façon sémantique
      const isGlobal = selectAllRow && (cb === selectAllRow || selectAllRow.contains(cb));

      return isChecked && !isGlobal;
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Localisation d'une carte source par son titre
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Recherche le conteneur d'une carte source par titre (aria-label du bouton étiré).
   * Optimisé : utilise querySelectorAll natif.
   * @param {string} sourceTitle - Titre (ou fragment) de la source à localiser.
   * @returns {Element|null}
   */
  function findSourceContainerByTitle(sourceTitle) {
    const list = findSourcesListContainer();
    if (!list) return null;

    // querySelectorAll natif — pas de Shadow DOM
    const containers = list.querySelectorAll(
      '.source-card, [class*="source-card"], [class*="source-item"]'
    );
    for (let i = 0; i < containers.length; i++) {
      const ctr = containers[i];
      const stretchedBtn = ctr.querySelector('button.source-stretched-button');
      if (stretchedBtn) {
        const label = stretchedBtn.getAttribute('aria-label') || '';
        if (label.includes(sourceTitle) || sourceTitle.includes(label)) {
          return ctr;
        }
      }
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Remontée checkbox → carte source parente
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Remonte depuis une checkbox jusqu'à la carte source parente.
   * @param {Element} cb - L'élément checkbox.
   * @returns {{ card: Element, title: string, stretchedBtn: Element }|null}
   */
  function findSourceCardFromCheckbox(cb) {
    let el = cb;
    // Remonter au plus 15 niveaux jusqu'à trouver un conteneur de source
    for (let i = 0; i < 15 && el; i++) {
      el = el.parentElement || (el.parentNode && el.parentNode.host) || null;
      if (!el) break;
      // Chercher un bouton source-stretched-button dans ce conteneur
      const stretchedBtn = el.querySelector('button.source-stretched-button');
      if (stretchedBtn) {
        const title = stretchedBtn.getAttribute('aria-label') ||
          el.textContent.trim().split('\n')[0].slice(0, 80);
        return { card: el, title: title, stretchedBtn: stretchedBtn };
      }
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // En-tête collant mobile (barre de recherche + actions)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Crée ou retourne l'en-tête collant mobile Magic Manager.
   * Cet en-tête reste fixe en haut du flux de défilement des sources.
   * @returns {Element|null}
   */
  function getOrCreateStickyHeader() {
    const sourcePanel = findSourcesListContainer();
    if (!sourcePanel) return null;

    let stickyHeader = sourcePanel.querySelector('.mm-sticky-header');
    if (!stickyHeader) {
      stickyHeader = document.createElement('div');
      stickyHeader.className = 'mm-sticky-header';

      const searchWrapper = document.createElement('div');
      searchWrapper.className = 'mm-sticky-header-search';

      const actionsWrapper = document.createElement('div');
      actionsWrapper.className = 'mm-sticky-header-actions';

      stickyHeader.appendChild(searchWrapper);
      stickyHeader.appendChild(actionsWrapper);

      // Insérer tout au début du panneau de sources
      sourcePanel.insertBefore(stickyHeader, sourcePanel.firstChild);
    }
    return stickyHeader;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Bouton de fermeture/retour du document ouvert
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Trouve le bouton de retour/fermeture du document ouvert de façon robuste
   * et indépendante de la langue de l'interface Google.
   * @param {Element} sourceViewer - L'élément source-viewer actif.
   * @returns {Element|null}
   */
  function findSourceViewerCloseButton(sourceViewer) {
    if (!sourceViewer) return null;
    
    // 1. Recherche structurelle via le titre du document (indépendante de la langue)
    const titleEl = sourceViewer.querySelector('.source-title, .title') || 
                    document.querySelector('.source-title, [class*="source-title"]');
    if (titleEl && titleEl.parentElement) {
      const btn = titleEl.parentElement.querySelector('button');
      if (btn) return btn;
    }
    
    // 2. Fallbacks de sélecteurs linguistiques ciblés
    return sourceViewer.querySelector(
      'button[mattooltip*="Close" i], button[aria-label*="Close" i], ' +
      'button[mattooltip*="Fermer" i], button[aria-label*="Fermer" i], ' +
      'button[mattooltip*="Retour" i], button[aria-label*="Retour" i]'
    ) || document.querySelector(
      'button[mattooltip*="Close" i], button[aria-label*="Close" i], ' +
      'button[mattooltip*="Fermer" i], button[aria-label*="Fermer" i]'
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Exposition dans le namespace global MM
  // ═══════════════════════════════════════════════════════════════════════

  window.MM.findSourcesListContainer = findSourcesListContainer;
  window.MM.findSelectAllRow = findSelectAllRow;
  window.MM.getCheckedSourceCheckboxes = getCheckedSourceCheckboxes;
  window.MM.findSourceContainerByTitle = findSourceContainerByTitle;
  window.MM.findSourceCardFromCheckbox = findSourceCardFromCheckbox;
  window.MM.getOrCreateStickyHeader = getOrCreateStickyHeader;
  window.MM.findSourceViewerCloseButton = findSourceViewerCloseButton;
})();
