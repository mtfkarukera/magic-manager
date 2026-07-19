// batch-delete.js — Suppression par lot de sources
// Auteur : MTF Karukera | Licence : MPL-2.0
// Dépendances : window.MM (utils.js, dialogs.js, rpcclient.js et source-helpers.js chargés avant)

'use strict';

(function () {
  const { t, createElement } = window.MM;

  // ═══════════════════════════════════════════════════════════════════════
  // État interne
  // ═══════════════════════════════════════════════════════════════════════
  let batchDeleteBtn = null;
  let batchDeleteBtnMobile = null;
  let isProcessing = false;

  // ═══════════════════════════════════════════════════════════════════════
  // Utilitaires de rendu
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Crée l'icône SVG de corbeille (identique à delete.js).
   */
  function createTrashIcon(size) {
    size = size || 15;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.display = 'block';
    svg.style.pointerEvents = 'none';

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d',
      'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z'
    );

    svg.appendChild(path);
    return svg;
  }

  let lastBatchDeleteCount = -1;

  /**
   * Met à jour la visibilité, le compteur et l'emplacement du bouton batch delete.
   * Injecte ou retire dynamiquement le bouton selon le nombre d'éléments sélectionnés.
   */
  function updateBatchDeleteButtonState() {
    if (typeof window.MM.isFeatureEnabled === 'function' &&
        !window.MM.isFeatureEnabled('batchDelete')) return;

    const checked = window.MM.getCheckedSourceCheckboxes();
    const count = checked.length;

    // Ancre prioritaire : le panel-header du panneau des sources de NotebookLM (desktop)
    const sourcePanel = document.querySelector('section.source-panel, .source-panel, [class*="source-panel"]');
    const panelHeader = sourcePanel ? sourcePanel.querySelector('.panel-header, [class*="header"]') : null;

    // En mode mobile, forcer l'utilisation du sticky-header même si le panel-header existe
    const isMobileLayout = typeof window.MM.detectDesktopLayout === 'function' && !window.MM.detectDesktopLayout();

    let anchor = (!isMobileLayout && panelHeader) ? panelHeader : null;
    let isHeader = !!anchor;
    let isMobileSticky = false;

    if (!anchor) {
      // Utiliser l'en-tête collant mobile
      const stickyHeader = window.MM.getOrCreateStickyHeader();
      if (stickyHeader) {
        anchor = stickyHeader.querySelector('.mm-sticky-header-actions');
        isMobileSticky = true;
        isHeader = true;
      }
    }

    if (!anchor) {
      anchor = document.querySelector('.mm-search-bar') || window.MM.findSelectAllRow();
      isHeader = false;
    }

    if (!anchor) {
      console.warn('[MM] updateBatchDeleteButtonState : aucune ancre trouvée.');
      return;
    }

    // Verrou d'idempotence : interrompt si l'état ou la position n'a pas changé
    if (count === lastBatchDeleteCount) {
      const buttonIsCorrect = count === 0
        ? !batchDeleteBtn
        : (batchDeleteBtn && anchor.contains(batchDeleteBtn));
      if (buttonIsCorrect) return;
    }
    lastBatchDeleteCount = count;

    if (count > 0) {
      if (!batchDeleteBtn || !anchor.contains(batchDeleteBtn)) {
        if (batchDeleteBtn) batchDeleteBtn.remove();

        batchDeleteBtn = createElement('button', {
          className: isHeader ? 'mm-batch-delete-btn mm-btn-icon' : 'mm-batch-delete-btn mm-btn-row',
          title: `${t('batchDeleteButton')} (${count})`,
          'aria-label': `${t('batchDeleteButton')} (${count})`,
          onClick: handleBatchDeleteClick
        }, [
          createTrashIcon(isMobileSticky ? 20 : 18),
          createElement('span', {
            className: 'mm-badge-count',
            textContent: `(${count})`
          })
        ]);

        if (isHeader) {
          if (isMobileSticky) {
            anchor.appendChild(batchDeleteBtn);
          } else {
            // Trouver le bouton collapse natif (le bouton retour ←)
            const nativeButtons = Array.from(anchor.querySelectorAll(
              'button:not(.mm-batch-merge-btn):not(.mm-batch-export-btn):not(.mm-batch-delete-btn):not(.mm-individual-delete-btn):not(.mm-individual-export-btn)'
            ));
            const collapseBtn = nativeButtons[nativeButtons.length - 1];
            if (collapseBtn) {
              // Insérer à gauche des boutons d'export et de fusion MM, ou collapseBtn
              const firstMmBtn = anchor.querySelector('.mm-batch-export-btn, .mm-batch-merge-btn');
              const targetBefore = firstMmBtn || collapseBtn;
              targetBefore.parentNode.insertBefore(batchDeleteBtn, targetBefore);
            } else {
              anchor.appendChild(batchDeleteBtn);
            }
          }
        } else {
          anchor.appendChild(batchDeleteBtn);
        }
      } else {
        // Mettre à jour le badge existant
        const badge = batchDeleteBtn.querySelector('.mm-badge-count');
        if (badge) badge.textContent = `(${count})`;
        batchDeleteBtn.title = `${t('batchDeleteButton')} (${count})`;
        batchDeleteBtn.setAttribute('aria-label', `${t('batchDeleteButton')} (${count})`);
      }
    } else {
      if (batchDeleteBtn) {
        batchDeleteBtn.remove();
        batchDeleteBtn = null;
      }
    }
  }


  /**
   * Fallback séquentiel en cas d'échec de la suppression par lot (rate limit, etc.)
   */
  async function fallbackSequentialDelete(sourceInfos, notebookId) {
    console.log('[MM] Repli sur la suppression séquentielle...');
    let succeeded = 0;
    
    for (const info of sourceInfos) {
      try {
        await window.MM.rpc.deleteSource(info.sourceId, notebookId);
        succeeded++;
        
        if (info.card) {
          info.card.style.transition = 'opacity 0.3s ease';
          info.card.style.opacity = '0';
          setTimeout(function () { info.card.remove(); }, 300);
        }
        
        // Délai de précaution anti-429
        await new Promise(function (r) { setTimeout(r, 300); });
      } catch (err) {
        console.error(`[MM] Échec de la suppression séquentielle pour ${info.sourceId} :`, err);
      }
    }
    
    console.log(`[MM] Suppression séquentielle terminée : ${succeeded}/${sourceInfos.length} réussies`);
  }

  /**
   * Handler au clic sur le bouton de suppression en lot.
   */
  async function handleBatchDeleteClick(e) {
    e.stopPropagation();
    if (isProcessing) return;

    const checkedBoxes = window.MM.getCheckedSourceCheckboxes();
    const count = checkedBoxes.length;
    if (count === 0) return;

    // Récupérer les informations des cartes
    const sourceInfos = [];
    for (const cb of checkedBoxes) {
      const cardInfo = window.MM.findSourceCardFromCheckbox(cb);
      if (!cardInfo || !cardInfo.card) continue;
      const sourceId = window.MM.extractSourceId(cardInfo.card);
      if (sourceId) {
        sourceInfos.push({ sourceId, card: cardInfo.card });
      }
    }

    if (sourceInfos.length === 0) {
      window.MM.showAlertDialog('deleteError', 'deleteError');
      return;
    }

    // Demander confirmation avant de supprimer
    window.MM.showConfirmDialog(
      'batchDeleteConfirmTitle',
      'batchDeleteConfirmMessage',
      [String(sourceInfos.length)],
      async function () {
        isProcessing = true;
        const match = window.location.pathname.match(/\/notebook\/([a-zA-Z0-9_-]+)/);
        const notebookId = match ? match[1] : null;

        if (!notebookId) {
          window.MM.showAlertDialog('deleteError', 'deleteError');
          isProcessing = false;
          return;
        }

        try {
          // Préparer les requêtes multi-RPC pour le batchexecute (rpc: tGMBJ)
          const requests = sourceInfos.map(function (info) {
            return { rpcId: 'tGMBJ', params: [[[info.sourceId]]] };
          });

          // Exécuter l'appel batch
          const result = await window.MM.rpc.sendBatchMultiple(requests, notebookId);

          console.log(`[MM] Suppression par lot : ${result.succeeded} réussies, ${result.failed} échouées`);

          // Animer la disparition des cartes réussies
          for (const info of sourceInfos) {
            if (info.card) {
              info.card.style.transition = 'opacity 0.4s ease, max-height 0.4s ease';
              info.card.style.opacity = '0';
              info.card.style.maxHeight = info.card.offsetHeight + 'px';
              
              setTimeout(function () {
                info.card.style.maxHeight = '0';
                info.card.style.overflow = 'hidden';
              }, 50);
              
              setTimeout(function () {
                info.card.remove();
              }, 450);
            }
          }

          // Gérer le cas d'échecs partiels
          if (result.failed > 0) {
            window.MM.showAlertDialog(
              'batchDeletePartialTitle',
              'batchDeletePartialMessage',
              [String(result.succeeded), String(result.failed)]
            );
          }
        } catch (err) {
          console.error('[MM] Erreur lors de la suppression batch, tentative de repli...', err);
          await fallbackSequentialDelete(sourceInfos, notebookId);
        } finally {
          isProcessing = false;
          // Réinitialiser la sélection dans panel-observer via un clic global ou décompte
          if (typeof window.MM.resetSelection === 'function') {
            window.MM.resetSelection();
          }
        }
      }
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Cycle de vie
  // ═══════════════════════════════════════════════════════════════════════

  function initBatchDelete() {
    console.log('[MM] Module batch-delete initialisé');
  }

  function cleanupBatchDelete() {
    if (batchDeleteBtn) {
      batchDeleteBtn.remove();
      batchDeleteBtn = null;
    }
    if (batchDeleteBtnMobile) {
      batchDeleteBtnMobile.remove();
      batchDeleteBtnMobile = null;
    }
    isProcessing = false;
    console.log('[MM] Module batch-delete nettoyé');
  }

  // Exposition publique
  window.MM.initBatchDelete = initBatchDelete;
  window.MM.cleanupBatchDelete = cleanupBatchDelete;
  window.MM.updateBatchDeleteButtonState = updateBatchDeleteButtonState;
})();
