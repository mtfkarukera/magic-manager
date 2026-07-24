// studio-delete.js — Suppression par lot d'éléments du Studio (Notes & Artéfacts)
// Auteur : MTF Karukera | Licence : MPL-2.0
// Dépendance : window.MM (rpcclient.js, dialogs.js)

'use strict';

(function () {
  const { t, createElement } = window.MM;

  // ═══════════════════════════════════════════════════════════════════════
  // État interne
  // ═══════════════════════════════════════════════════════════════════════
  let studioObserver = null;
  let selectedUuids = new Set(); // Contient les UUIDs natifs (ou clés uniques) des éléments sélectionnés
  let batchDeleteWrapper = null;
  let batchDeleteBtn = null;
  let isProcessing = false;

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
    // 1. Chercher spécifiquement par la classe de ligne de la bibliothèque d'artéfacts de NotebookLM
    const items = Array.from(studioPanel.querySelectorAll('.artifact-item-button'));
    if (items.length > 0) return items;

    // 2. Fallback robuste : chercher toutes les cartes/lignes contenant le bouton d'options (...)
    // car seuls les éléments réels de la bibliothèque en possèdent
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
    
    // Fallback : premier élément textuel non vide de taille raisonnable
    const elements = Array.from(card.querySelectorAll('span, p, div'));
    for (const el of elements) {
      const text = el.textContent.trim();
      if (text.length > 0 && text.length < 80) return text;
    }
    return '';
  }

  /**
   * Trouve l'icône native de la carte pour pouvoir la masquer au survol.
   */
  function findNativeIcon(card) {
    return card.querySelector('mat-icon, svg, [class*="icon"], [class*="avatar"]');
  }

  /**
   * Extrait l'UUID natif Google attribué à une carte du Studio.
   * Analyse aria-labelledby="note-labels-[UUID]", id="note-labels-[UUID]" ou jslog.
   * @param {Element} card - Élément DOM de la carte.
   * @returns {string|null} - L'UUID extrait ou null si non trouvé.
   */
  function getStudioCardUuid(card) {
    if (!card) return null;

    // 1. Recherche par attribut aria-labelledby="note-labels-[UUID]" (bouton principal des notes Angular)
    const btnWithLabel = card.querySelector('[aria-labelledby*="note-labels-"]');
    if (btnWithLabel) {
      const attr = btnWithLabel.getAttribute('aria-labelledby') || '';
      const match = attr.match(/note-labels-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (match) return match[1];
    }

    // 2. Recherche directe dans l'ID de note (ex: id="note-labels-394eab26-...")
    const labelEl = card.querySelector('[id^="note-labels-"]');
    if (labelEl) {
      const match = labelEl.id.match(/^note-labels-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
      if (match) return match[1];
    }

    // 3. Extraction d'UUID via les attributs HTML (jslog, aria, id...)
    const html = card.outerHTML || '';
    const uuids = html.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
    if (uuids && uuids.length > 0) {
      const currentNotebookId = window.MM?.notebookId || '';
      // Écarter l'ID du carnet (notebookId) pour isoler l'ID de l'élément
      const validUuids = uuids.filter(u => u.toLowerCase() !== currentNotebookId.toLowerCase());
      if (validUuids.length > 0) {
        return validUuids[0];
      }
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Parseurs RPC Résilients (utilisés uniquement lors de la suppression)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Parse le retour du RPC cFji9 (GET_NOTES_AND_MIND_MAPS).
   */
  function parseNotesResult(result) {
    if (!Array.isArray(result) || !Array.isArray(result[0])) return [];
    
    return result[0].map(row => {
      if (!Array.isArray(row) || row.length < 2) return null;
      const id = row[0];
      const data = row[1];
      const statusFlag = row[2];
      
      // Écarter les notes en soft delete côté serveur Google (status 2 ou contenu null)
      if (statusFlag === 2 || data === null || !Array.isArray(data) || data.length < 5) return null;
      if (typeof id !== 'string' || id.length < 10) return null;
      
      const title = data[4] || '';
      return { id: id, title: title.trim(), type: 'note' };
    }).filter(Boolean);
  }

  /**
   * Parse le retour du RPC gArtLc (LIST_ARTIFACTS).
   */
  function parseArtifactsResult(result) {
    if (!Array.isArray(result) || !Array.isArray(result[0])) return [];
    
    return result[0].map(row => {
      if (!Array.isArray(row) || row.length < 3) return null;
      const id = row[0];
      const title = row[1] || '';
      const typeCode = row[2];
      if (typeof id !== 'string' || id.length < 10) return null;
      return { id: id, title: title.trim(), type: 'artifact', typeCode: typeCode };
    }).filter(Boolean);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Empreinte de liste (fingerprint)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Calcule l'empreinte de la liste du Studio à partir des titres DOM ordonnés.
   * Sert de clé de cohérence pour la sélection en cours.
   */
  function computeFingerprint(cards) {
    return Array.from(cards)
      .map(card => getStudioCardTitle(card).trim().toLowerCase())
      .join('||');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Routines d'Injection
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Injecte les checkboxes de survol dans chaque carte du Studio.
   */
  function injectStudioCheckboxes(studioPanel) {
    const cards = findStudioCards(studioPanel);
    if (cards.length === 0) return;

    const isMobile = typeof window.MM.detectDesktopLayout === 'function' && !window.MM.detectDesktopLayout();

    cards.forEach((card, index) => {
      const cardUuid = getStudioCardUuid(card);
      const title = getStudioCardTitle(card);
      if (!title && !cardUuid) return;

      // Utiliser l'UUID natif comme clé unique, ou une clé isolée par index de carte
      const itemKey = cardUuid || `title:${title.trim().toLowerCase()}__idx:${index}`;

      const existingCheckbox = card.querySelector('.mm-studio-checkbox');

      if (existingCheckbox) {
        const hasMobileClass = existingCheckbox.classList.contains('mm-studio-checkbox-mobile');

        // Si le layout actuel ne correspond pas à la checkbox existante, on la démonte pour la reconstruire
        if ((isMobile && !hasMobileClass) || (!isMobile && hasMobileClass)) {
          const wrapper = card.querySelector('.mm-studio-icon-wrapper');
          if (wrapper) {
            const nativeIcon = wrapper.querySelector('.mm-studio-native-icon');
            if (nativeIcon) {
              wrapper.parentNode.insertBefore(nativeIcon, wrapper);
              nativeIcon.classList.remove('mm-studio-native-icon');
            }
            wrapper.remove();
          }
          existingCheckbox.remove();
          card.classList.remove('mm-studio-item', 'mm-studio-mobile-item');
        } else {
          // Checkbox existante compatible, synchroniser son état avec selectedUuids
          existingCheckbox.checked = selectedUuids.has(itemKey);
          existingCheckbox.dataset.mmUuid = itemKey;
          return;
        }
      }

      // Créer la checkbox
      const checkbox = createElement('input', {
        type: 'checkbox',
        className: isMobile ? 'mm-studio-checkbox mm-studio-checkbox-mobile' : 'mm-studio-checkbox',
        'aria-label': `${t('selectButton') || 'Sélectionner'} ${title || 'élément'}`
      });
      checkbox.dataset.mmUuid = itemKey;

      checkbox.addEventListener('click', function (e) {
        e.stopPropagation();
      });

      checkbox.addEventListener('change', function () {
        handleCheckboxChange(checkbox);
      });

      // Restaurer l'état coché si cet UUID était sélectionné
      if (selectedUuids.has(itemKey)) {
        checkbox.checked = true;
      }

      if (isMobile) {
        // En mode mobile, insérer simplement à gauche de la carte sans wrapper l'icône
        card.classList.add('mm-studio-mobile-item');
        card.insertBefore(checkbox, card.firstChild);
      } else {
        // En mode desktop, survol d'icône avec wrapper
        const nativeIcon = findNativeIcon(card);
        if (nativeIcon) {
          card.classList.add('mm-studio-item');
          nativeIcon.classList.add('mm-studio-native-icon');

          // Créer un wrapper relative pour confiner le survol à l'icône seule
          const iconWrapper = createElement('div', { className: 'mm-studio-icon-wrapper' });
          nativeIcon.parentNode.insertBefore(iconWrapper, nativeIcon);

          // checkbox en premier, nativeIcon en second dans le wrapper
          iconWrapper.appendChild(checkbox);
          iconWrapper.appendChild(nativeIcon);
        } else {
          // Fallback si pas d'icône détectée
          card.insertBefore(checkbox, card.firstChild);
        }
      }
    });
  }

  /**
   * Gère le changement d'état d'une checkbox du Studio.
   */
  function handleCheckboxChange(checkbox) {
    const key = checkbox.dataset.mmUuid;
    if (!key) return;

    if (checkbox.checked) {
      selectedUuids.add(key);
    } else {
      selectedUuids.delete(key);
    }

    updateBatchDeleteButtonState();
  }

  /**
   * Crée ou met à jour le bouton de suppression en lot du Studio.
   */
  function updateBatchDeleteButtonState() {
    const studioPanel = findStudioPanel();
    if (!studioPanel) return;

    const count = selectedUuids.size;

    if (count > 0) {
      if (!batchDeleteWrapper) {
        // Chercher une zone d'en-tête du Studio pour injecter le bouton
        const header = studioPanel.querySelector('.studio-header, [class*="header"], h2, h3');

        batchDeleteWrapper = createElement('div', {
          className: 'mm-studio-batch-actions mm-visible',
          style: 'display: inline-flex; width: calc(100% - 32px); gap: 8px; margin: var(--mm-spacing-sm) var(--mm-spacing-md); align-items: center;'
        });

        batchDeleteBtn = createElement('button', {
          className: 'mm-btn mm-btn-error',
          style: 'flex: 1; justify-content: center; height: 36px; display: inline-flex; align-items: center;',
          textContent: `${t('studioDeleteButton') || 'Supprimer la sélection'} (${count})`,
          onClick: handleBatchDeleteClick
        });

        const resetBtn = createElement('button', {
          className: 'mm-btn mm-btn-secondary',
          style: 'width: 36px; height: 36px; padding: 0; display: flex; align-items: center; justify-content: center; flex-shrink: 0; border: 1px solid var(--mm-outline);',
          type: 'button',
          title: t('studioClearSelection') || 'Tout désélectionner',
          onClick: handleClearSelection
        }, [
          createElement('span', { textContent: '×', style: 'font-size: 20px; font-weight: bold; line-height: 1;' })
        ]);

        batchDeleteWrapper.appendChild(batchDeleteBtn);
        batchDeleteWrapper.appendChild(resetBtn);

        if (header) {
          header.parentNode.insertBefore(batchDeleteWrapper, header.nextSibling);
        } else {
          studioPanel.insertBefore(batchDeleteWrapper, studioPanel.firstChild);
        }
      } else {
        batchDeleteBtn.textContent = `${t('studioDeleteButton') || 'Supprimer la sélection'} (${count})`;
        batchDeleteWrapper.classList.add('mm-visible');
      }
    } else {
      if (batchDeleteWrapper) {
        batchDeleteWrapper.remove();
        batchDeleteWrapper = null;
        batchDeleteBtn = null;
      }
    }
  }

  /**
   * Désélectionne tous les éléments sélectionnés dans le Studio.
   */
  function handleClearSelection(e) {
    if (e) e.stopPropagation();

    const studioPanel = findStudioPanel();
    if (studioPanel) {
      studioPanel.querySelectorAll('.mm-studio-checkbox').forEach(cb => { cb.checked = false; });
    }

    selectedUuids.clear();
    updateBatchDeleteButtonState();
  }

  /**
   * Clic sur le bouton de suppression par lot du Studio.
   */
  const DELETE_KEYWORDS = [
    'supprimer', 'retirer', 'delete', 'remove', 'eliminar', 'quitar',
    'löschen', 'entfernen', 'apagar', 'remover', '削除', 'xóa', 'gỡ bỏ'
  ];

  function simulateClick(el) {
    if (!el) return;
    try {
      el.focus();
    } catch (e) {}
    el.click();
  }

  async function waitForElements(selector, keywords, maxWaitMs) {
    maxWaitMs = maxWaitMs || 1500;
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const elements = Array.from(document.querySelectorAll(selector));
      for (const el of elements) {
        const txt = (el.textContent || '').trim().toLowerCase();
        const match = keywords.some(kw => txt.indexOf(kw) !== -1);
        if (match) return el;
      }
      await new Promise(r => setTimeout(r, 50));
    }
    return null;
  }

  /**
   * Clic sur le bouton de suppression par lot du Studio.
   */
  async function handleBatchDeleteClick(e) {
    e.stopPropagation();
    if (isProcessing || selectedUuids.size === 0) return;

    const match = window.location.pathname.match(/\/notebook\/([a-zA-Z0-9_-]+)/);
    const notebookId = match ? match[1] : null;

    if (!notebookId) {
      window.MM.showAlertDialog('deleteError', 'deleteError');
      return;
    }

    const count = selectedUuids.size;

    // Demander confirmation
    window.MM.showConfirmDialog(
      'studioDeleteConfirmTitle',
      'studioDeleteConfirmMessage',
      [String(count)],
      async function () {
        isProcessing = true;
        if (batchDeleteBtn) batchDeleteBtn.disabled = true;

        const targetKeys = Array.from(selectedUuids);
        selectedUuids.clear();
        updateBatchDeleteButtonState();

        try {
          const studioPanel = findStudioPanel();
          const cards = studioPanel ? findStudioCards(studioPanel) : [];

          console.log(`[MM] StudioDelete : suppression native simulée de ${targetKeys.length} éléments...`);
          let succeeded = 0;
          let failed = 0;

          // Déconnecter temporairement l'observer pendant la suppression pour éviter les faux resets
          if (studioObserver) studioObserver.disconnect();

          for (let i = 0; i < targetKeys.length; i++) {
            const key = targetKeys[i];
            
            // Trouver la carte DOM correspondante
            const card = cards.find(c => {
              const cUuid = getStudioCardUuid(c);
              if (cUuid) {
                return cUuid.toLowerCase() === key.toLowerCase();
              }
              const title = getStudioCardTitle(c);
              const idx = cards.indexOf(c);
              const fallbackKey = `title:${title.trim().toLowerCase()}__idx:${idx}`;
              return fallbackKey.toLowerCase() === key.toLowerCase();
            });

            if (!card) {
              console.warn(`[MM] StudioDelete : impossible de trouver la carte DOM pour la clé ${key}`);
              failed++;
              continue;
            }

            const moreBtn = card.querySelector('.artifact-more-button, [class*="more-button"]');
            if (!moreBtn) {
              console.warn('[MM] StudioDelete : bouton options "..." introuvable sur la carte');
              failed++;
              continue;
            }

            // 1. Ouvrir le menu contextuel d'options natif d'Angular
            simulateClick(moreBtn);

            // 2. Attendre et cliquer sur l'option "Supprimer" du menu
            const deleteOption = await waitForElements(
              '[role="menuitem"], button, .mat-mdc-menu-item, .mdc-list-item, [class*="menu-item"], [class*="menuitem"]',
              DELETE_KEYWORDS,
              1000
            );

            if (deleteOption) {
              simulateClick(deleteOption);

              // 3. Confirmer le dialogue natif d'Angular si présent (ex: modale "Supprimer ?")
              const confirmBtn = await waitForElements(
                'mat-dialog-container button, .mat-mdc-dialog-container button, [role="dialog"] button, button',
                DELETE_KEYWORDS,
                1000
              );

              if (confirmBtn) {
                simulateClick(confirmBtn);
                succeeded++;
              } else {
                succeeded++;
              }
            } else {
              console.warn('[MM] StudioDelete : option "Supprimer" introuvable dans le menu contextuel');
              document.body.click(); // Fermer le menu
              failed++;
            }

            // Temps d'attente court pour laisser Angular appliquer la suppression et mettre à jour le DOM
            await new Promise(resolve => setTimeout(resolve, 450));
          }

          console.log(`[MM] StudioDelete terminé : ${succeeded} réussies, ${failed} échouées`);

          // Ré-observer le panneau Studio et relancer une injection propre
          if (studioPanel && studioObserver) {
            studioObserver.observe(studioPanel, {
              childList: true,
              subtree: true
            });
          }
          dispatchStudioInjections();

          if (failed > 0) {
            window.MM.showAlertDialog(
              'batchDeletePartialTitle',
              'batchDeletePartialMessage',
              [String(succeeded), String(failed)]
            );
          }
        } catch (err) {
          console.error('[MM] Échec de la suppression Studio par lot :', err);
          window.MM.showAlertDialog('deleteError', 'deleteError');
        } finally {
          isProcessing = false;
        }
      }
    );
  }

  let mobileTabHandler = null;
  let observedMobileTabs = [];

  function dispatchStudioInjections() {
    const studioPanel = findStudioPanel();
    if (!studioPanel) return;

    // Déconnecter temporairement l'observer pour éviter une cascade de mutations auto-déclenchée
    if (studioObserver) studioObserver.disconnect();
    injectStudioCheckboxes(studioPanel);
    if (studioObserver) {
      studioObserver.observe(studioPanel, {
        childList: true,
        subtree: true
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Cycle de vie
  // ═══════════════════════════════════════════════════════════════════════

  function initStudioDelete() {
    if (typeof window.MM.isFeatureEnabled === 'function' &&
        !window.MM.isFeatureEnabled('batchDelete')) return;

    let studioPanel = findStudioPanel();
    if (!studioPanel) {
      // Retenter plus tard si le Studio n'est pas encore monté
      setTimeout(initStudioDelete, 1000);
      return;
    }

    // Observer les changements du panneau Studio pour injecter les checkboxes dynamiquement
    studioObserver = new MutationObserver(function () {
      dispatchStudioInjections();
    });

    studioObserver.observe(studioPanel, {
      childList: true,
      subtree: true
    });

    // Écouter les changements d'onglet mobile avec un handler nommé nettoyable
    mobileTabHandler = function () {
      setTimeout(function () {
        const currentPanel = findStudioPanel();
        if (currentPanel && currentPanel !== studioPanel) {
          if (studioObserver) studioObserver.disconnect();
          studioPanel = currentPanel;
          studioObserver = new MutationObserver(dispatchStudioInjections);
          studioObserver.observe(studioPanel, { childList: true, subtree: true });
        }
        dispatchStudioInjections();
      }, 300);
    };

    observedMobileTabs = Array.from(document.querySelectorAll('[role="tab"]'));
    observedMobileTabs.forEach(tab => {
      tab.addEventListener('click', mobileTabHandler);
    });

    dispatchStudioInjections();
    console.log('[MM] Module studio-delete initialisé');
  }

  function cleanupStudioDelete() {
    if (studioObserver) {
      studioObserver.disconnect();
      studioObserver = null;
    }

    if (mobileTabHandler && observedMobileTabs.length > 0) {
      observedMobileTabs.forEach(tab => {
        tab.removeEventListener('click', mobileTabHandler);
      });
      observedMobileTabs = [];
      mobileTabHandler = null;
    }

    if (batchDeleteWrapper) {
      batchDeleteWrapper.remove();
      batchDeleteWrapper = null;
      batchDeleteBtn = null;
    }

    // Retirer toutes les checkboxes, wrappers et classes injectées
    const studioPanel = findStudioPanel();
    if (studioPanel) {
      // Unwrapper les icônes natives
      studioPanel.querySelectorAll('.mm-studio-icon-wrapper').forEach(wrapper => {
        const nativeIcon = wrapper.querySelector('.mm-studio-native-icon');
        if (nativeIcon) {
          wrapper.parentNode.insertBefore(nativeIcon, wrapper);
          nativeIcon.classList.remove('mm-studio-native-icon');
        }
        wrapper.remove();
      });

      studioPanel.querySelectorAll('.mm-studio-checkbox').forEach(cb => cb.remove());
      studioPanel.querySelectorAll('.mm-studio-item').forEach(card => {
        card.classList.remove('mm-studio-item');
      });
      studioPanel.querySelectorAll('.mm-studio-mobile-item').forEach(card => {
        card.classList.remove('mm-studio-mobile-item');
      });
    }

    selectedUuids.clear();
    isProcessing = false;
    console.log('[MM] Module studio-delete nettoyé');
  }

  // Exposition publique
  window.MM.dispatchStudioInjections = dispatchStudioInjections;
  window.MM.initStudioDelete = initStudioDelete;
  window.MM.cleanupStudioDelete = cleanupStudioDelete;
})();
