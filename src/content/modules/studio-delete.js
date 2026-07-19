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
  let selectedItems = new Map(); // Clé = titre normalisé (string), Valeur = { title, checkbox }
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

  // ═══════════════════════════════════════════════════════════════════════
  // Parseurs RPC Résilients
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
      if (typeof id !== 'string' || id.length < 10) return null;
      if (!Array.isArray(data) || data.length < 5) return null;
      
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
  // Routines d'Injection
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Injecte les checkboxes de survol dans chaque carte du Studio.
   */
  function injectStudioCheckboxes(studioPanel) {
    const cards = findStudioCards(studioPanel);
    if (cards.length === 0) return;

    const isMobile = typeof window.MM.detectDesktopLayout === 'function' && !window.MM.detectDesktopLayout();

    cards.forEach(card => {
      const existingCheckbox = card.querySelector('.mm-studio-checkbox');

      if (existingCheckbox) {
        const hasMobileClass = existingCheckbox.classList.contains('mm-studio-checkbox-mobile');

        // Si le layout actuel ne correspond pas à la checkbox existante, on la démonte pour la reconstruire
        if ((isMobile && !hasMobileClass) || (!isMobile && hasMobileClass)) {
          // 1. Restaurer l'icône native si elle était enveloppée
          const wrapper = card.querySelector('.mm-studio-icon-wrapper');
          if (wrapper) {
            const nativeIcon = wrapper.querySelector('.mm-studio-native-icon');
            if (nativeIcon) {
              wrapper.parentNode.insertBefore(nativeIcon, wrapper);
              nativeIcon.classList.remove('mm-studio-native-icon');
            }
            wrapper.remove();
          }
          // 2. Supprimer la checkbox obsolète
          existingCheckbox.remove();
          card.classList.remove('mm-studio-item', 'mm-studio-mobile-item');
        } else {
          // Checkbox existante compatible, pas besoin de ré-injecter
          return;
        }
      }

      const title = getStudioCardTitle(card);
      if (!title) return;

      const normalizedTitle = title.trim().toLowerCase();

      // Créer la checkbox
      const checkbox = createElement('input', {
        type: 'checkbox',
        className: isMobile ? 'mm-studio-checkbox mm-studio-checkbox-mobile' : 'mm-studio-checkbox',
        'aria-label': `${t('selectButton') || 'Sélectionner'} ${title}`
      });

      checkbox.addEventListener('click', function (e) {
        e.stopPropagation();
      });

      checkbox.addEventListener('change', function () {
        handleCheckboxChange(card, checkbox, title);
      });

      // Restaurer l'état coché si cette carte était déjà sélectionnée (ex: après retour du viewer ou switch layout)
      if (selectedItems.has(normalizedTitle)) {
        checkbox.checked = true;
        // Mettre à jour la référence de la checkbox dans la Map
        selectedItems.set(normalizedTitle, { title: title, checkbox: checkbox });
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
  function handleCheckboxChange(card, checkbox, title) {
    const key = title.trim().toLowerCase();
    if (checkbox.checked) {
      selectedItems.set(key, { title: title, checkbox: checkbox });
    } else {
      selectedItems.delete(key);
    }

    updateBatchDeleteButtonState();
  }

  /**
   * Crée ou met à jour le bouton de suppression en lot du Studio.
   */
  function updateBatchDeleteButtonState() {
    const studioPanel = findStudioPanel();
    if (!studioPanel) return;

    const count = selectedItems.size;

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
          // Insérer juste après le header
          header.parentNode.insertBefore(batchDeleteWrapper, header.nextSibling);
        } else {
          // Insérer au tout début
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

    // Décocher toutes les checkboxes visibles dans le DOM du Studio
    const studioPanel = findStudioPanel();
    if (studioPanel) {
      studioPanel.querySelectorAll('.mm-studio-checkbox').forEach(cb => cb.checked = false);
    }

    selectedItems.clear();
    updateBatchDeleteButtonState();
  }

  /**
   * Clic sur le bouton de suppression par lot du Studio.
   */
  async function handleBatchDeleteClick(e) {
    e.stopPropagation();
    if (isProcessing || selectedItems.size === 0) return;

    const match = window.location.pathname.match(/\/notebook\/([a-zA-Z0-9_-]+)/);
    const notebookId = match ? match[1] : null;

    if (!notebookId) {
      window.MM.showAlertDialog('deleteError', 'deleteError');
      return;
    }

    // Demander confirmation
    window.MM.showConfirmDialog(
      'studioDeleteConfirmTitle',
      'studioDeleteConfirmMessage',
      [String(selectedItems.size)],
      async function () {
        isProcessing = true;
        if (batchDeleteBtn) batchDeleteBtn.disabled = true;

        try {
          // 1. Récupérer toutes les notes et artéfacts du serveur pour pouvoir faire le mapping par titre
          console.log('[MM] StudioDelete : chargement de la liste des notes/artéfacts via RPC...');
          const [notesRaw, artifactsRaw] = await Promise.all([
            window.MM.rpc.getNotesAndMindMaps(notebookId),
            window.MM.rpc.getArtifactsList(notebookId)
          ]);

          const dbNotes = parseNotesResult(notesRaw);
          const dbArtifacts = parseArtifactsResult(artifactsRaw);
          const dbItems = dbNotes.concat(dbArtifacts);

          console.log(`[MM] StudioDelete : ${dbItems.length} éléments récupérés du serveur.`);

          // 2. Résoudre les IDs des éléments cochés (avec déduplication)
          const requests = [];
          const matchedCards = [];
          const remainingItems = [...dbItems];

          // Retrouver les cartes du DOM actuellement affichées dans le Studio
          const studioPanel = findStudioPanel();
          const currentDOMCards = studioPanel ? findStudioCards(studioPanel) : [];
          const titleToCardDOM = new Map();
          currentDOMCards.forEach(card => {
            const tVal = getStudioCardTitle(card);
            if (tVal) titleToCardDOM.set(tVal.trim().toLowerCase(), card);
          });

          selectedItems.forEach((info, normalizedTitle) => {
            const cardTitle = info.title.toLowerCase();
            
            // Trouver l'élément correspondant dans la base RPC en évitant les doublons
            const matchIndex = remainingItems.findIndex(item => {
              const dbTitle = item.title.toLowerCase();
              return dbTitle.includes(cardTitle) || cardTitle.includes(dbTitle);
            });

            if (matchIndex !== -1) {
              const matchItem = remainingItems[matchIndex];
              // Retirer de la liste pour ne pas mapper deux cartes différentes sur le même ID serveur
              remainingItems.splice(matchIndex, 1);

              const rpcId = matchItem.type === 'note' ? 'AH0mwd' : 'V5N4be';
              const params = matchItem.type === 'note' 
                ? [notebookId, null, [matchItem.id]] // Payload DELETE_NOTE
                : [[matchItem.typeCode || 1], matchItem.id]; // Payload DELETE_ARTIFACT corrigé

              requests.push({ rpcId: rpcId, params: params, type: matchItem.type, id: matchItem.id });
              
              // Retrouver la carte DOM actuelle si elle est affichée
              const currentCardDOM = titleToCardDOM.get(normalizedTitle);
              if (currentCardDOM) {
                matchedCards.push({ card: currentCardDOM, id: matchItem.id });
              }
            } else {
              console.warn(`[MM] StudioDelete : impossible de mapper la carte "${info.title}" à un ID RPC.`);
            }
          });

          if (requests.length === 0) {
            window.MM.showAlertDialog('deleteError', 'deleteError');
            isProcessing = false;
            if (batchDeleteBtn) batchDeleteBtn.disabled = false;
            return;
          }

          // 3. Envoyer la suppression séquentiellement (pour contourner les limitations Google batchexecute multi-identique)
          console.log(`[MM] StudioDelete : suppression séquentielle de ${requests.length} éléments Studio...`);
          let succeeded = 0;
          let failed = 0;

          for (let i = 0; i < requests.length; i++) {
            const req = requests[i];
            try {
              await window.MM.rpc.sendBatchExecute(req.rpcId, req.params, notebookId);
              succeeded++;
            } catch (err) {
              failed++;
              console.error(`[MM] Échec de suppression RPC pour ${req.rpcId} (${req.id}) :`, err);
            }

            // Attendre un peu avant la suppression suivante pour éviter d'être bloqué par rate-limiting
            if (i < requests.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 400));
            }
          }

          console.log(`[MM] StudioDelete terminé : ${succeeded} réussies, ${failed} échouées`);

          // 4. Retirer les cartes du DOM avec animation
          matchedCards.forEach(info => {
            info.card.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
            info.card.style.opacity = '0';
            info.card.style.transform = 'scale(0.9)';
            setTimeout(() => {
              info.card.remove();
            }, 400);
          });

          // Gérer le cas d'échecs partiels
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
          selectedItems.clear();
          updateBatchDeleteButtonState();
        }
      }
    );
  }

  /**
   * Exécute les injections dans le Studio.
   */
  function dispatchStudioInjections() {
    const studioPanel = findStudioPanel();
    if (!studioPanel) return;

    injectStudioCheckboxes(studioPanel);
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

    // Écouter les changements d'onglet mobile pour ré-observer le Studio s'il a changé de nœud
    document.querySelectorAll('[role="tab"]').forEach(tab => {
      tab.addEventListener('click', function () {
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
      });
    });

    dispatchStudioInjections();
    console.log('[MM] Module studio-delete initialisé');
  }

  function cleanupStudioDelete() {
    if (studioObserver) {
      studioObserver.disconnect();
      studioObserver = null;
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

    selectedItems.clear();
    isProcessing = false;
    console.log('[MM] Module studio-delete nettoyé');
  }

  // Exposition publique
  window.MM.dispatchStudioInjections = dispatchStudioInjections;
  window.MM.initStudioDelete = initStudioDelete;
  window.MM.cleanupStudioDelete = cleanupStudioDelete;
})();
