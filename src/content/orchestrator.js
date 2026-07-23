// orchestrator.js — Point d'entrée principal de Magic Manager
// Auteur : MTF Karukera | Licence : MPL-2.0
//
// Coordonne le chargement et l'activation des différents modules
// en fonction des préférences de l'utilisateur.
// L'orchestrateur délègue l'auto-injection résiliente aux modules
// eux-mêmes pour faire face à la nature dynamique de la SPA NotebookLM.

'use strict';

(function () {
  // ═══════════════════════════════════════════════════════════════════════
  // Constantes & Préférences
  // ═══════════════════════════════════════════════════════════════════════

  /** Préfixe de stockage pour les préférences */
  const STORAGE_PREFIX = 'mm_';

  /** Clés des features */
  const FEATURES = {
    shortcuts: 'feature_shortcuts',
    search: 'feature_search',
    badges: 'feature_badges',
    merge: 'feature_merge',
    export: 'feature_export',
    delete: 'feature_delete',
    batchDelete: 'feature_batchDelete',
    studioSearch: 'feature_studioSearch',
    syntax: 'feature_syntax',
    chatExport: 'feature_chatExport',
    transfer: 'feature_transfer',
    noteCopy: 'feature_noteCopy'
  };

  /** Préférences par défaut (toutes actives) */
  const DEFAULT_PREFS = {};
  Object.keys(FEATURES).forEach(function (k) {
    DEFAULT_PREFS[STORAGE_PREFIX + FEATURES[k]] = true;
  });

  // ═══════════════════════════════════════════════════════════════════════
  // État interne
  // ═══════════════════════════════════════════════════════════════════════

  /** Préférences utilisateur chargées */
  var preferences = {};
  Object.keys(DEFAULT_PREFS).forEach(function (k) {
    preferences[k] = DEFAULT_PREFS[k];
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Chargeur de Préférences
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Charge les préférences depuis browser.storage.local.
   * @returns {Promise<Object>}
   */
  async function loadPreferences() {
    try {
      var data = await browser.storage.local.get(Object.keys(DEFAULT_PREFS));
      Object.keys(DEFAULT_PREFS).forEach(function (k) {
        preferences[k] = (data[k] !== undefined) ? data[k] : DEFAULT_PREFS[k];
      });
    } catch (e) {
      console.warn('[MM] Impossible de charger les préférences, utilisation des valeurs par défaut');
      Object.keys(DEFAULT_PREFS).forEach(function (k) {
        preferences[k] = DEFAULT_PREFS[k];
      });
    }
    return preferences;
  }

  /**
   * Vérifie si une feature est activée.
   * @param {string} featureKey - Clé interne de la feature.
   * @returns {boolean}
   */
  function isFeatureEnabled(featureKey) {
    let key = featureKey;
    if (key && !key.startsWith('feature_')) {
      key = 'feature_' + key;
    }
    return preferences[STORAGE_PREFIX + key] !== false;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Cycle de vie des modules
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Initialise tous les modules activés par l'utilisateur.
   */
  function initAllModules() {
    console.log('[MM] Initialisation des modules activés');

    // Chaque module est isolé dans un try-catch pour qu'un crash
    // dans l'un n'empêche pas l'initialisation des suivants.
    const modules = [
      { key: FEATURES.shortcuts, init: 'initShortcuts', label: 'Raccourcis' },
      { key: FEATURES.search, init: 'initSearch', label: 'Recherche' },
      { key: FEATURES.badges, init: 'initBadges', label: 'Badges' },
      { key: FEATURES.merge,  init: 'initMerge',  label: 'Fusion' },
      { key: FEATURES.export, init: 'initExport', label: 'Export' },
      { key: FEATURES.delete, init: 'initDelete', label: 'Suppression' },
      { key: FEATURES.batchDelete, init: 'initBatchDelete', label: 'Suppression lot' },
      { key: FEATURES.batchDelete, init: 'initStudioDelete', label: 'Suppression Studio' },
      { key: FEATURES.studioSearch, init: 'initStudioSearch', label: 'Recherche Studio' },
      { key: FEATURES.syntax, init: 'initSyntax', label: 'Syntaxe' },
      { key: FEATURES.chatExport, init: 'initChatExport', label: 'ChatExport' },
      { key: FEATURES.transfer, init: 'initTransfer', label: 'Transfert' },
      { key: FEATURES.noteCopy, init: 'initNoteCopy', label: 'Copie Note' }
    ];

    for (const mod of modules) {
      if (isFeatureEnabled(mod.key) && typeof window.MM[mod.init] === 'function') {
        try {
          window.MM[mod.init]();
        } catch (err) {
          console.error(`[MM] ERREUR lors de l'init du module ${mod.label} :`, err);
        }
      }
    }

    // Panel observer centralisé : actif si export, delete, badges, batchDelete, studioSearch, transfer ou noteCopy est activé
    if (isFeatureEnabled(FEATURES.export) || isFeatureEnabled(FEATURES.delete) || isFeatureEnabled(FEATURES.badges) || isFeatureEnabled(FEATURES.batchDelete) || isFeatureEnabled(FEATURES.studioSearch) || isFeatureEnabled(FEATURES.transfer) || isFeatureEnabled(FEATURES.noteCopy)) {
      try {
        window.MM.initPanelObserver();
      } catch (err) {
        console.error('[MM] ERREUR lors de l\'init du PanelObserver :', err);
      }
    }
  }

  /**
   * Arrête et nettoie tous les modules.
   */
  function cleanupAllModules() {
    console.log('[MM] Nettoyage de tous les modules');
    const modules = [
      { name: 'Shortcuts', fn: window.MM.cleanupShortcuts },
      { name: 'PanelObserver', fn: window.MM.cleanupPanelObserver },
      { name: 'Search', fn: window.MM.cleanupSearch },
      { name: 'Badges', fn: window.MM.cleanupBadges },
      { name: 'Merge', fn: window.MM.cleanupMerge },
      { name: 'Export', fn: window.MM.cleanupExport },
      { name: 'Delete', fn: window.MM.cleanupDelete },
      { name: 'BatchDelete', fn: window.MM.cleanupBatchDelete },
      { name: 'StudioDelete', fn: window.MM.cleanupStudioDelete },
      { name: 'StudioSearch', fn: window.MM.cleanupStudioSearch },
      { name: 'Syntax', fn: window.MM.cleanupSyntax },
      { name: 'ChatExport', fn: window.MM.cleanupChatExport },
      { name: 'Transfer', fn: window.MM.cleanupTransfer },
      { name: 'NoteCopy', fn: window.MM.cleanupNoteCopy }
    ];

    modules.forEach(function (m) {
      if (typeof m.fn === 'function') {
        try {
          m.fn();
        } catch (err) {
          console.error('[MM] Erreur lors du nettoyage de ' + m.name + ' :', err);
        }
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Écoute des changements de préférences
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Réagit en temps réel aux modifications de préférences de l'utilisateur.
   */
  function listenForPreferenceChanges() {
    browser.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local') return;

      var needsRefresh = false;
      Object.keys(changes).forEach(function (key) {
        if (key.indexOf(STORAGE_PREFIX) === 0) {
          preferences[key] = changes[key].newValue;
          needsRefresh = true;
        }
      });

      if (needsRefresh) {
        console.log('[MM] Préférences changées, réinitialisation des modules');
        cleanupAllModules();
        initAllModules();
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Initialisation globale de l'extension
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Lance l'extension.
   */
  async function init() {
    console.log('[MM] Magic Manager v0.13.0 — Initialisation globale');

    // Mettre à disposition la vérification d'état des features pour les autres modules
    window.MM.isFeatureEnabled = isFeatureEnabled;

    // 1. Charger les préférences utilisateur
    await loadPreferences();

    // 2. Initialiser le micro-menu de paramétrage (⚙️ en position fixe)
    window.MM.initSettings();

    // 3. Écouter les modifications de préférences
    listenForPreferenceChanges();

    // 4. Initialiser tous les modules actifs (chaque module gère son auto-injection)
    initAllModules();

    console.log('[MM] Orchestrateur prêt');
  }

  // Lancement automatique
  init();
})();
