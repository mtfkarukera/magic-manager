// source-helpers.js — Fonctions partagées de détection DOM des sources
// Auteur : MTF Karukera | Licence : MPL-2.0
// Centralise les utilitaires utilisés par export.js et merge.js
// pour éviter la duplication de code et les scans DOM redondants.

'use strict';

(function () {
  let _stickyHeaderRef = null;
  // ═══════════════════════════════════════════════════════════════════════
  // Détection du conteneur de la liste des sources
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Localise le conteneur principal de la liste des sources NotebookLM.
   * Utilise uniquement querySelectorAll natif (pas de traversée Shadow DOM).
   * @returns {Element|null}
   */
  function findSourcesListContainer() {
    // Heuristique 1 : Classe contenant source-list ou sources-list
    let el = document.querySelector(
      '[data-sources-list], [class*="source-list"], [class*="sources-list"], [class*="sourceList"], [class*="sourcesList"]'
    );
    if (el) return el;

    // Heuristique 2 : Recherche structurelle par sélecteur CSS commun
    el = document.querySelector(
      'section.source-panel, .source-panel, .sources-panel, ' +
      '[class*="source-panel"], [class*="sources-panel"]'
    );
    if (el) return el;

    // Heuristique 3 : Recherche par contenu sémantique du panneau Sources
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
    
    // 1. Recherche structurelle via le titre (indépendante de la langue)
    //    Remonte jusqu'à 3 niveaux de parents pour supporter les sources URL
    //    dont le titre est dans un conteneur imbriqué supplémentaire
    const titleEl = window.MM.findSourceViewerTitle(sourceViewer);
    if (titleEl) {
      let parent = titleEl.parentElement;
      for (let i = 0; i < 3 && parent; i++) {
        const btn = parent.querySelector('button');
        if (btn) return btn;
        parent = parent.parentElement;
      }
    }
    
    // 2. Fallbacks de sélecteurs linguistiques ciblés dans le viewer
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
  // Titre du document ouvert
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Trouve l'élément de titre du document ouvert dans le source-viewer de façon robuste.
   * Supporte les documents (PDF/docs) et les sources URL.
   * @param {Element} sourceViewer - L'élément source-viewer actif.
   * @returns {Element|null}
   */
  function findSourceViewerTitle(sourceViewer) {
    if (!sourceViewer) return null;
    return sourceViewer.querySelector(
      '.source-title, .title, [class*="source-title"], [class*="viewer-title"]'
    ) || document.querySelector(
      'source-viewer .source-title, source-viewer .title, ' +
      '[class*="source-title"], [class*="viewer-title"]'
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Extraction du texte de titre (nettoyé des icônes Material)
  // ═══════════════════════════════════════════════════════════════════════

  // Liste des noms d'icônes Material connus qui peuvent polluer le textContent
  const MATERIAL_ICON_NAMES = new Set([
    'arrow_back', 'open_in_new', 'close', 'expand_less', 'expand_more',
    'more_vert', 'more_horiz', 'download', 'upload', 'delete', 'edit',
    'info', 'info_outline', 'help', 'help_outline', 'search', 'clear',
    'check', 'check_circle', 'cancel', 'add', 'remove', 'link',
    'content_copy', 'content_paste', 'file_download', 'file_upload',
    'visibility', 'visibility_off', 'lock', 'lock_open', 'star', 'share'
  ]);

  /**
   * Extrait le texte pur du titre du document ouvert dans le source-viewer,
   * en filtrant les noms d'icônes Material (arrow_back, open_in_new, etc.)
   * qui contaminent le textContent quand le titleEl est un conteneur.
   * Utilisé exclusivement pour construire des noms de fichiers propres.
   * @param {Element} sourceViewer - L'élément source-viewer actif.
   * @returns {string} Le texte de titre nettoyé, ou une chaîne vide.
   */
  function findSourceViewerTitleText(sourceViewer) {
    const titleEl = findSourceViewerTitle(sourceViewer);
    if (!titleEl) return '';

    // Parcourir les noeuds texte directs du titleEl pour extraire le texte pur
    // (évite de capturer les textContent des icônes Material dans les enfants)
    const textNodes = Array.from(titleEl.childNodes).filter(function (node) {
      return node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0;
    });

    if (textNodes.length > 0) {
      return textNodes.map(function (n) { return n.textContent.trim(); }).join(' ').trim();
    }

    // Fallback : parcourir les spans/éléments enfants directs non-iconiques
    const candidates = Array.from(titleEl.children).filter(function (el) {
      const txt = el.textContent.trim();
      // Exclure les éléments dont le texte complet est un nom d'icône Material connu
      return txt.length > 0 && !MATERIAL_ICON_NAMES.has(txt) && el.tagName !== 'BUTTON';
    });

    if (candidates.length > 0) {
      return candidates.map(function (el) { return el.textContent.trim(); }).join(' ').trim();
    }

    // Dernier recours : retourner le textContent complet en filtrant les mots d'icônes
    const rawText = titleEl.textContent.trim();
    const words = rawText.split(/\s+/);
    const filtered = words.filter(function (w) { return !MATERIAL_ICON_NAMES.has(w); });
    return filtered.join(' ').trim();
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
    if (_stickyHeaderRef && document.contains(_stickyHeaderRef)) {
      return _stickyHeaderRef;
    }

    const sourcePanelSection = document.querySelector('section.source-panel, .source-panel, [class*="source-panel"]');
    if (!sourcePanelSection) return null;

    let stickyHeader = sourcePanelSection.querySelector('.mm-sticky-header');
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
      sourcePanelSection.insertBefore(stickyHeader, sourcePanelSection.firstChild);
    }
    _stickyHeaderRef = stickyHeader;
    return stickyHeader;
  }

  /**
   * Injecte des indicateurs visuels d'origine (Drive, Web, Local) à côté du titre des sources.
   */
  function injectOriginIndicators() {
    const list = findSourcesListContainer();
    if (!list) return;

    const cards = list.querySelectorAll('.single-source-container, [class*="source-card"], [class*="source-item"]');
    cards.forEach(card => {
      if (card.querySelector('.mm-source-origin')) return;

      const titleEl = card.querySelector('button.source-stretched-button, [class*="title"], [class*="name"]');
      if (!titleEl) return;

      const nativeIcon = card.querySelector('mat-icon, svg, [class*="icon"]');
      const iconName = nativeIcon ? (nativeIcon.textContent || nativeIcon.getAttribute('aria-label') || '').toLowerCase() : '';
      const cardText = (card.textContent || '').toLowerCase();

      let origin = 'local';
      let svgPath = '';
      let originTitle = '';

      if (iconName.includes('drive') || cardText.includes('google drive') || cardText.includes('gdrive')) {
        origin = 'drive';
        originTitle = 'Synchronisé avec Google Drive';
        svgPath = '<path d="M12,18A6,6 0 0,1 6,12C6,11 6.25,10.07 6.69,9.25L5.22,8.08C4.45,9.23 4,10.57 4,12A8,8 0 0,0 12,20V18M12,4V6A6,6 0 0,1 18,12C18,13 17.75,13.93 17.31,14.75L18.78,15.92C19.55,14.77 20,13.43 20,12A8,8 0 0,0 12,4M12,8A4,4 0 0,0 8,12H10A2,2 0 0,1 12,10V8M12,16V14A2,2 0 0,1 14,12H16A4,4 0 0,0 12,16Z"/>';
      } else if (iconName.includes('link') || iconName.includes('public') || iconName.includes('language') || cardText.includes('http://') || cardText.includes('https://') || cardText.includes('.com') || cardText.includes('.fr') || cardText.includes('.org')) {
        origin = 'web';
        originTitle = 'Source Web / Lien externe';
        svgPath = '<path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M19.93,11H17.24C17.07,8.23 16.29,5.69 15.08,3.58C17.7,4.8 19.46,7.5 19.93,11M12,4.04C12.83,5.92 13.44,8.32 13.56,11H10.44C10.56,8.32 11.17,5.92 12,4.04M4.07,13H6.76C6.93,15.77 7.71,18.31 8.92,20.42C6.3,19.2 4.54,16.5 4.07,13M4.07,11C4.54,8.5 6.3,5.8 8.92,4.58C7.71,6.69 6.93,9.23 6.76,11H4.07M12,19.96C11.17,18.08 10.56,15.68 10.44,13H13.56C13.44,15.68 12.83,18.08 12,19.96M17.24,13H19.93C19.46,15.5 17.7,18.2 15.08,19.42C16.29,17.31 17.07,14.77 17.24,13M15.53,11H8.47C8.4,9.22 8.87,7.21 9.77,5.5H14.23C15.13,7.21 15.6,9.22 15.53,11M8.47,13H15.53C15.6,14.78 15.13,16.79 14.23,18.5H9.77C8.87,16.79 8.4,14.78 8.47,13Z"/>';
      } else {
        origin = 'local';
        originTitle = 'Document importé localement';
        svgPath = '<path d="M18.5,19H5.5A1.5,1.5 0 0,1 4.14,16.89L8.14,6.89A1.5,1.5 0 0,1 9.5,6H14.5A1.5,1.5 0 0,1 15.86,6.89L19.86,16.89A1.5,1.5 0 0,1 18.5,19M9.5,8L5.5,18H18.5L14.5,8H9.5Z"/>';
      }

      const iconEl = window.MM.createElement('span', {
        className: `mm-source-origin mm-origin-${origin}`,
        title: originTitle
      }, [
        window.MM.createElement('svg', {
          viewBox: '0 0 24 24',
          className: 'mm-origin-icon-svg',
          'aria-hidden': 'true',
          innerHTML: svgPath
        })
      ]);

      titleEl.insertBefore(iconEl, titleEl.firstChild);
    });
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
  window.MM.findSourceViewerTitle = findSourceViewerTitle;
  window.MM.findSourceViewerTitleText = findSourceViewerTitleText;
  window.MM.injectOriginIndicators = injectOriginIndicators;
})();
