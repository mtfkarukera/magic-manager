// popup.js — Gestionnaire de la Popup de réglages et détection dynamique de permissions
// Auteur : MTF Karukera | Licence : MPL-2.0

'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const STORAGE_PREFIX = 'mm_';
  const DEFAULT_PREFS = {
    mm_feature_shortcuts: true,
    mm_feature_search: true,
    mm_feature_badges: true,
    mm_feature_merge: true,
    mm_feature_export: true,
    mm_feature_delete: true,
    mm_feature_batchDelete: true,
    mm_feature_studioSearch: true,
    mm_feature_syntax: true,
    mm_feature_chatExport: true,
    mm_feature_transfer: true,
    mm_feature_noteCopy: true
  };

  const warningBanner = document.getElementById('permission-warning-banner');
  const btnGrantPermission = document.getElementById('btn-grant-permission');

  // ═══════════════════════════════════════════════════════════════════════
  // 1. Détection dynamique de la permission notebook.google.com
  // ═══════════════════════════════════════════════════════════════════════

  async function checkPermissionState() {
    try {
      const hasPermission = await browser.permissions.contains({
        origins: ["*://notebook.google.com/*"]
      });

      if (!hasPermission) {
        warningBanner.style.display = 'block';
      } else {
        warningBanner.style.display = 'none';
      }
    } catch (e) {
      console.warn('[MM-POPUP] Erreur vérification permission :', e);
    }
  }

  // Clic sur le bouton 1-clic d'autorisation
  if (btnGrantPermission) {
    btnGrantPermission.addEventListener('click', async () => {
      try {
        const granted = await browser.permissions.request({
          origins: ["*://notebook.google.com/*"]
        });

        if (granted) {
          warningBanner.style.display = 'none';
          // Optionnel : recharger la page active notebook.google.com si elle existe
          const tabs = await browser.tabs.query({ url: "*://notebook.google.com/*" });
          tabs.forEach(tab => browser.tabs.reload(tab.id));
        }
      } catch (e) {
        console.error('[MM-POPUP] Erreur demande permission 1-clic :', e);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Gestion des Toggles de Fonctionnalités (browser.storage.local)
  // ═══════════════════════════════════════════════════════════════════════

  const checkboxes = document.querySelectorAll('input[data-feature]');

  // Charger les préférences stockées
  try {
    const keys = Object.keys(DEFAULT_PREFS);
    const stored = await browser.storage.local.get(keys);

    checkboxes.forEach(cb => {
      const featureKey = cb.getAttribute('data-feature');
      const storageKey = featureKey.startsWith(STORAGE_PREFIX) ? featureKey : STORAGE_PREFIX + featureKey;
      const isEnabled = stored[storageKey] !== undefined ? stored[storageKey] : DEFAULT_PREFS[storageKey];
      cb.checked = Boolean(isEnabled);

      // Écouteur de changement
      cb.addEventListener('change', async (e) => {
        const newValue = e.target.checked;
        await browser.storage.local.set({ [storageKey]: newValue });
      });
    });
  } catch (e) {
    console.error('[MM-POPUP] Erreur chargement préférences :', e);
  }

  // Exécuter le check de permission au chargement
  await checkPermissionState();
});
