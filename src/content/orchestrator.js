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
    search: 'feature_search',
    merge: 'feature_merge',
    export: 'feature_export',
    delete: 'feature_delete',
    syntax: 'feature_syntax',
    chatExport: 'feature_chatExport'
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
    return preferences[STORAGE_PREFIX + featureKey] !== false;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Cycle de vie des modules
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Initialise tous les modules activés par l'utilisateur.
   */
  function initAllModules() {
    console.log('[MM] Initialisation des modules activés');
    if (isFeatureEnabled(FEATURES.search)) window.MM.initSearch();
    if (isFeatureEnabled(FEATURES.merge)) window.MM.initMerge();
    if (isFeatureEnabled(FEATURES.export)) window.MM.initExport();
    if (isFeatureEnabled(FEATURES.delete)) window.MM.initDelete();
    // Panel observer centralisé : actif si export OU delete est activé
    if (isFeatureEnabled(FEATURES.export) || isFeatureEnabled(FEATURES.delete)) {
      window.MM.initPanelObserver();
    }
    if (isFeatureEnabled(FEATURES.syntax)) window.MM.initSyntax();
    if (isFeatureEnabled(FEATURES.chatExport)) window.MM.initChatExport();
  }

  /**
   * Arrête et nettoie tous les modules.
   */
  function cleanupAllModules() {
    console.log('[MM] Nettoyage de tous les modules');
    window.MM.cleanupPanelObserver();
    window.MM.cleanupSearch();
    window.MM.cleanupMerge();
    window.MM.cleanupExport();
    window.MM.cleanupDelete();
    window.MM.cleanupSyntax();
    window.MM.cleanupChatExport();
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
    console.log('[MM] Magic Manager v0.1.0 — Initialisation globale');

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
