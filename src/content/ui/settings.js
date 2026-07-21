// settings.js — Module de paramétrage in-page (micro-menu)
// Auteur : MTF Karukera | Licence : MPL-2.0
//
// Injecte un bouton discret (icône engrenage) en haut du panneau Sources
// de NotebookLM. Au clic, ouvre un popover Material Design 3 avec 6
// toggles pour activer/désactiver individuellement chaque feature.
// Les préférences sont persistées dans browser.storage.local.
// Dépendance : window.MM (utils.js chargé avant)

'use strict';

(function () {
  const { t, createElement } = window.MM;

  // ═══════════════════════════════════════════════════════════════════════
  // Constantes
  // ═══════════════════════════════════════════════════════════════════════

  /** Préfixe de stockage pour les préférences */
  const STORAGE_PREFIX = 'mm_';

  /** Configuration des 6 features avec clé de stockage et clé i18n */
  const FEATURE_TOGGLES = [
    { key: 'feature_shortcuts',  i18nKey: 'settingsFeatureShortcuts' },
    { key: 'feature_search',     i18nKey: 'settingsFeatureSearch' },
    { key: 'feature_badges',     i18nKey: 'settingsFeatureBadges' },
    { key: 'feature_merge',      i18nKey: 'settingsFeatureMerge' },
    { key: 'feature_export',     i18nKey: 'settingsFeatureExport' },
    { key: 'feature_delete',     i18nKey: 'settingsFeatureDelete' },
    { key: 'feature_batchDelete', i18nKey: 'settingsFeatureBatchDelete' },
    { key: 'feature_syntax',     i18nKey: 'settingsFeatureSyntax' },
    { key: 'feature_chatExport', i18nKey: 'settingsFeatureChatExport' },
    { key: 'feature_studioSearch', i18nKey: 'settingsFeatureStudioSearch' },
    { key: 'feature_transfer',  i18nKey: 'settingsFeatureTransfer' }
  ];

  // ═══════════════════════════════════════════════════════════════════════
  // État interne
  // ═══════════════════════════════════════════════════════════════════════

  /** Référence au bouton engrenage injecté */
  let settingsButton = null;

  /** Référence au popover ouvert (null si fermé) */
  let popoverElement = null;

  /** Handler du clic extérieur pour fermer le popover */
  let outsideClickHandler = null;
  let outsideClickTimeoutId = null;
  let popoverKeydownHandler = null;
  let popoverFocusoutHandler = null;


  // ═══════════════════════════════════════════════════════════════════════
  // Icône engrenage SVG
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Crée l'élément SVG de l'icône engrenage Material Design.
   * @returns {SVGElement}
   */
  function createGearIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');

    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d',
      'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 ' +
      '00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 ' +
      '0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 ' +
      '0 00-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 ' +
      '1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 ' +
      '2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 ' +
      '0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1115.6 12 3.611 ' +
      '3.611 0 0112 15.6z'
    );
    svg.appendChild(path);
    return svg;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Construction du popover
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Crée un toggle (switch) Material Design 3.
   * @param {string} storageKey - Clé de stockage (sans préfixe).
   * @param {string} i18nKey    - Clé i18n pour le label.
   * @param {boolean} checked   - État initial du toggle.
   * @returns {Element} La ligne toggle complète.
   */
  function createToggleRow(storageKey, i18nKey, checked) {
    const fullKey = STORAGE_PREFIX + storageKey;

    // Checkbox invisible
    const input = createElement('input', {
      type: 'checkbox',
      id: 'mm-toggle-' + storageKey,
    });
    input.checked = checked;

    // Piste visuelle du toggle
    const track = createElement('span', { className: 'mm-toggle-track' });

    // Conteneur du toggle (span pour éviter la double labellisation)
    const toggle = createElement('span', { className: 'mm-toggle' }, [input, track]);

    // Label textuel
    const label = createElement('label', {
      className: 'mm-toggle-label',
      textContent: t(i18nKey),
      'for': 'mm-toggle-' + storageKey
    });

    // Ligne complète
    const row = createElement('div', { className: 'mm-toggle-row' }, [label, toggle]);

    // Persistence du changement
    input.addEventListener('change', function () {
      const obj = {};
      obj[fullKey] = input.checked;
      browser.storage.local.set(obj);
      console.log('[MM] Préférence ' + storageKey + ' → ' + input.checked);
    });

    return row;
  }

  /**
   * Ouvre le popover de paramétrage.
   */
  async function openSettingsPopover() {
    // Toggle : fermer si déjà ouvert
    if (popoverElement) {
      closeSettingsPopover();
      return;
    }

    // Charger les préférences actuelles
    const keys = FEATURE_TOGGLES.map(function (f) { return STORAGE_PREFIX + f.key; });
    const data = await browser.storage.local.get(keys);

    // Titre du popover
    const title = createElement('div', {
      className: 'mm-settings-popover-title',
      textContent: t('settingsTitle')
    });

    // Créer les toggles
    const toggleRows = FEATURE_TOGGLES.map(function (feature) {
      const fullKey = STORAGE_PREFIX + feature.key;
      const isChecked = data[fullKey] !== false; // activé par défaut
      return createToggleRow(feature.key, feature.i18nKey, isChecked);
    });

    // Assembler le popover avec attributs d'accessibilité
    popoverElement = createElement('div', {
      className: 'mm-settings-popover',
      role: 'dialog',
      'aria-label': t('settingsTitle')
    }, [
      title
    ].concat(toggleRows));

    // Mettre à jour l'état aria-expanded du bouton
    if (settingsButton) {
      settingsButton.setAttribute('aria-expanded', 'true');
    }

    // Positionner au-dessus du bouton fixe
    popoverElement.style.position = 'fixed';
    popoverElement.style.zIndex = '10000';

    document.body.appendChild(popoverElement);

    // Positionner dynamiquement après insertion dans le DOM
    if (settingsButton) {
      const rect = settingsButton.getBoundingClientRect();
      popoverElement.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
      popoverElement.style.left = rect.left + 'px';
    }

    // Focaliser le premier commutateur pour l'accessibilité
    const firstCheckbox = popoverElement.querySelector('input[type="checkbox"]');
    if (firstCheckbox) {
      firstCheckbox.focus();
    }

    // Fermeture avec la touche Echap
    popoverKeydownHandler = function (e) {
      if (e.key === 'Escape') {
        closeSettingsPopover();
        if (settingsButton) settingsButton.focus();
      }
    };
    document.addEventListener('keydown', popoverKeydownHandler);

    // Fermeture si le focus clavier sort du popover
    popoverFocusoutHandler = function (e) {
      setTimeout(function () {
        const active = document.activeElement;
        // Ignorer les pertes de focus cosmétiques (clic sur élément non-focusable
        // sous Firefox macOS : le focus retombe sur body sans quitter le popover)
        if (!active || active === document.body || active === document.documentElement) {
          return;
        }
        if (popoverElement && !popoverElement.contains(active) && active !== settingsButton) {
          closeSettingsPopover();
        }
      }, 50);
    };
    popoverElement.addEventListener('focusout', popoverFocusoutHandler);

    // Fermer au clic extérieur (avec délai pour éviter la fermeture immédiate)
    outsideClickTimeoutId = setTimeout(function () {
      outsideClickTimeoutId = null;
      outsideClickHandler = function (e) {
        if (popoverElement && !popoverElement.contains(e.target) && e.target !== settingsButton) {
          closeSettingsPopover();
        }
      };
      document.addEventListener('click', outsideClickHandler, true);
    }, 100);
  }

  /**
   * Ferme le popover de paramétrage.
   */
  function closeSettingsPopover() {
    if (outsideClickTimeoutId) {
      clearTimeout(outsideClickTimeoutId);
      outsideClickTimeoutId = null;
    }
    if (popoverElement) {
      popoverElement.removeEventListener('focusout', popoverFocusoutHandler);
      popoverElement.remove();
      popoverElement = null;
    }
    if (settingsButton) {
      settingsButton.setAttribute('aria-expanded', 'false');
    }
    if (outsideClickHandler) {
      document.removeEventListener('click', outsideClickHandler, true);
      outsideClickHandler = null;
    }
    if (popoverKeydownHandler) {
      document.removeEventListener('keydown', popoverKeydownHandler);
      popoverKeydownHandler = null;
    }
  }


  // ═══════════════════════════════════════════════════════════════════════
  // API publique
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Initialise le module de paramétrage.
   * Injecte le bouton engrenage en position fixe, en bas à gauche du viewport.
   * Cette position est volontairement fixe car le DOM de NotebookLM est
   * obfusqué et les sélecteurs heuristiques ne sont pas fiables.
   */
  function initSettings() {
    // Éviter les doublons
    if (settingsButton) return;

    // Créer le bouton engrenage
    settingsButton = createElement('button', {
      className: 'mm-settings-btn mm-settings-btn-fixed',
      'aria-label': t('settingsTitle'),
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
      title: t('settingsTitle'),
      onClick: openSettingsPopover
    }, [createGearIcon()]);


    document.body.appendChild(settingsButton);

    console.log('[MM] Module settings initialisé — bouton engrenage injecté');
  }

  /**
   * Nettoie les éléments injectés par le module de paramétrage.
   */
  function cleanupSettings() {
    closeSettingsPopover();
    if (settingsButton) {
      settingsButton.remove();
      settingsButton = null;
    }
  }

  // Exposition dans le namespace global MM
  window.MM.initSettings = initSettings;
  window.MM.cleanupSettings = cleanupSettings;
})();
