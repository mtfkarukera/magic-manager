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

    cards.forEach((card) => {
      const cardUuid = getStudioCardUuid(card);
      const title = getStudioCardTitle(card);
      
      // GARANTIE ABSOLUE : Utiliser exclusivement l'UUID unique natif Google.
      // S'il n'est pas encore hydraté par Angular dans le DOM, on ignore temporairement cet élément.
      const itemKey = cardUuid;
      if (!itemKey) return;

      // Sécurité : s'assurer que si Angular recycle ce nœud DOM, ses styles d'opacité/visibilité sont nettoyés
      const host = card.closest('artifact-library-note, artifact-library-item') || card;
      if (host.style.opacity || host.style.visibility) {
        host.style.opacity = '';
        host.style.visibility = '';
      }

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

    // Demander confirmation globale
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
          console.log('[MM] StudioDelete : chargement de la liste des notes/artéfacts via RPC...');
          const [notesRaw, artifactsRaw] = await Promise.all([
            window.MM.rpc.getNotesAndMindMaps(notebookId),
            window.MM.rpc.getArtifactsList(notebookId)
          ]);

          const dbNotes = parseNotesResult(notesRaw);
          const dbArtifacts = parseArtifactsResult(artifactsRaw);
          const dbItems = dbNotes.concat(dbArtifacts);

          console.log(`[MM] StudioDelete : ${dbItems.length} éléments récupérés du serveur.`);

          const studioPanel = findStudioPanel();
          const cards = studioPanel ? findStudioCards(studioPanel) : [];
          const requests = [];
          const matchedCards = [];

          targetKeys.forEach(uuid => {
            const matchItem = dbItems.find(item => item.id.toLowerCase() === uuid.toLowerCase());

            if (matchItem) {
              console.log(`[MM] StudioDelete : suppression RPC de [${matchItem.id}] (${matchItem.title})`);
              const rpcId = matchItem.type === 'note' ? 'AH0mwd' : 'V5N4be';
              const params = matchItem.type === 'note'
                ? [notebookId, null, [matchItem.id]]
                : [[matchItem.typeCode || 1], matchItem.id];

              requests.push({ rpcId, params, type: matchItem.type, id: matchItem.id });

              // Trouver la carte DOM correspondante pour l'animation
              const matchedCard = cards.find(c => {
                const cUuid = getStudioCardUuid(c);
                return cUuid && cUuid.toLowerCase() === matchItem.id.toLowerCase();
              });
              if (matchedCard) {
                matchedCards.push(matchedCard);
              }
            } else {
              // Fallback si l'UUID n'est pas trouvé dans la liste RPC (ex: type spécial non listé)
              console.warn(`[MM] StudioDelete : UUID non trouvé dans le cache RPC, essai en tant que note pour [${uuid}]`);
              requests.push({
                rpcId: 'AH0mwd',
                params: [notebookId, null, [uuid]],
                type: 'note',
                id: uuid
              });
              const matchedCard = cards.find(c => {
                const cUuid = getStudioCardUuid(c);
                return cUuid && cUuid.toLowerCase() === uuid.toLowerCase();
              });
              if (matchedCard) {
                matchedCards.push(matchedCard);
              }
            }
          });

          if (requests.length === 0) {
            window.MM.showAlertDialog('deleteError', 'deleteError');
            isProcessing = false;
            if (batchDeleteBtn) batchDeleteBtn.disabled = false;
            return;
          }

          console.log(`[MM] StudioDelete : suppression séquentielle RPC de ${requests.length} éléments...`);
          let succeeded = 0;
          let failed = 0;

          // Déconnecter temporairement l'observer pendant la suppression pour éviter les interférences
          if (studioObserver) studioObserver.disconnect();

          for (let i = 0; i < requests.length; i++) {
            const req = requests[i];
            try {
              await window.MM.rpc.sendBatchExecute(req.rpcId, req.params, notebookId);
              succeeded++;
            } catch (err) {
              failed++;
              console.error(`[MM] Échec de suppression RPC pour ${req.rpcId} (${req.id}) :`, err);
            }

            if (i < requests.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 350));
            }
          }

          console.log(`[MM] StudioDelete terminé : ${succeeded} réussies, ${failed} échouées`);

          // Animer uniquement les cartes supprimées avec effet fondu doux et masquage visuel
          matchedCards.forEach(card => {
            const host = card.closest('artifact-library-note, artifact-library-item') || card;
            host.style.transition = 'opacity 0.4s ease';
            host.style.opacity = '0';
            setTimeout(() => {
              host.style.visibility = 'hidden';
            }, 400);
          });

          // Rétablir l'observer et relancer l'injection
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
