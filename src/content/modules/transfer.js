// transfer.js — Module de transfert de sources inter-carnets
// Auteur : MTF Karukera | Licence : MPL-2.0

(function() {
  'use strict';

  // Namespace global
  window.MM = window.MM || {};

  const t = window.MM.t;
  const createElement = window.MM.createElement;

  let lastBatchTransferCount = -1;
  let batchTransferButton = null;

  console.log('[MM] Module transfer chargé.');

  // ═══════════════════════════════════════════════════════════════════════
  // 1. CRÉATION DU DIALOGUE DE TRANSFERT (MODALE)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Affiche la modale de sélection de carnet pour le transfert.
   *
   * @param {string} title - Titre à afficher.
   * @param {Function} onConfirm - Callback appelé avec la liste des notebookIds sélectionnés.
   */
  async function showTransferDialog(title, onConfirm) {
    // Créer la modale
    const dialog = createElement('dialog', {
      className: 'mm-dialog mm-transfer-dialog',
      role: 'dialog',
      'aria-modal': 'true'
    });

    const header = createElement('div', { className: 'mm-dialog-header' }, [
      createElement('h3', { textContent: title }),
      createElement('button', {
        className: 'mm-btn-icon mm-dialog-close-btn',
        title: t('cancel') || 'Annuler',
        'aria-label': t('cancel') || 'Annuler',
        onClick: () => dialog.close()
      }, [
        createElement('svg', {
          viewBox: '0 0 24 24',
          className: 'mm-icon-svg',
          'aria-hidden': 'true',
          innerHTML: '<path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/>'
        })
      ])
    ]);

    const body = createElement('div', { className: 'mm-dialog-body' });
    const footer = createElement('div', { className: 'mm-dialog-footer' });

    // Message de chargement initial
    const loader = createElement('div', {
      className: 'mm-loader-container',
      textContent: t('loadingNotebooks') || 'Chargement des carnets...'
    });
    body.appendChild(loader);

    // Boutons d'action
    const cancelBtn = createElement('button', {
      className: 'mm-btn mm-btn-secondary',
      textContent: t('cancel') || 'Annuler',
      onClick: () => dialog.close()
    });

    const confirmBtn = createElement('button', {
      className: 'mm-btn mm-btn-primary',
      disabled: true,
      textContent: t('transfer') || 'Transférer',
      onClick: () => {
        const checkedBoxes = body.querySelectorAll('input[type="checkbox"]:checked');
        const selectedIds = Array.from(checkedBoxes).map(cb => cb.dataset.notebookId);
        onConfirm(selectedIds);
        dialog.close();
      }
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);

    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(footer);

    document.body.appendChild(dialog);

    // Mémoriser le focus actuel et ouvrir le dialogue
    const lastFocusedElement = document.activeElement;
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (lastFocusedElement) lastFocusedElement.focus();
    });

    dialog.showModal();

    // Charger les notebooks
    try {
      const notebooks = await window.MM.rpc.listNotebooks();
      body.removeChild(loader);

      // Si aucun carnet n'est trouvé
      if (notebooks.length === 0) {
        body.appendChild(createElement('p', {
          className: 'mm-dialog-empty-msg',
          textContent: t('noNotebooksFound') || 'Aucun autre carnet trouvé.'
        }));
        return;
      }

      // Champ de recherche rapide
      const searchInput = createElement('input', {
        type: 'text',
        className: 'mm-transfer-search-input',
        placeholder: t('searchNotebookPlaceholder') || 'Rechercher un carnet...'
      });

      // Liste scrollable des carnets
      const listContainer = createElement('div', { className: 'mm-transfer-list-container' });

      // Exclure le notebook courant de la liste de transfert
      const currentNotebookId = window.MM.getActiveNotebookId();
      const otherNotebooks = notebooks.filter(nb => nb.id !== currentNotebookId);

      if (otherNotebooks.length === 0) {
        body.appendChild(createElement('p', {
          className: 'mm-dialog-empty-msg',
          textContent: t('noOtherNotebooksFound') || 'Aucun autre carnet disponible pour le transfert.'
        }));
        return;
      }

      const rows = otherNotebooks.map(nb => {
        const checkbox = createElement('input', {
          type: 'checkbox',
          className: 'mm-transfer-checkbox',
          id: `nb-cb-${nb.id}`,
          'data-notebook-id': nb.id,
          onChange: () => {
            const hasChecked = !!listContainer.querySelector('input[type="checkbox"]:checked');
            confirmBtn.disabled = !hasChecked;
          }
        });

        const label = createElement('label', {
          htmlFor: `nb-cb-${nb.id}`,
          textContent: nb.title
        });

        return createElement('div', { className: 'mm-transfer-row' }, [checkbox, label]);
      });

      rows.forEach(row => listContainer.appendChild(row));

      // Recherche interactive
      searchInput.addEventListener('input', () => {
        const query = searchInput.value.toLowerCase().trim();
        rows.forEach((row, idx) => {
          const title = otherNotebooks[idx].title.toLowerCase();
          row.style.display = title.includes(query) ? '' : 'none';
        });
      });

      body.appendChild(searchInput);
      body.appendChild(listContainer);

      // Focus sur le champ de recherche
      searchInput.focus();

    } catch (err) {
      console.error('[MM] Erreur lors du chargement des carnets :', err);
      body.textContent = '';
      body.appendChild(createElement('p', {
        className: 'mm-dialog-error-msg',
        textContent: t('errorLoadingNotebooks') || 'Erreur lors du chargement des carnets.'
      }));
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2. EXÉCUTION DU TRANSFERT
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Exécute le transfert asynchrone des sources sélectionnées vers les notebooks cibles.
   *
   * @param {Array<string>} sourceIds - Identifiants des sources à transférer.
   * @param {Array<string>} targetNotebookIds - Identifiants des notebooks cibles.
   */
  async function executeTransfer(sourceIds, targetNotebookIds) {
    if (sourceIds.length === 0 || targetNotebookIds.length === 0) return;

    // Afficher la modale de progression
    const progressDialog = window.MM.showProgressDialog(
      t('transferProgressTitle') || 'Transfert en cours...',
      t('transferProgressMsg') || 'Copie des sources vers les carnets cibles...'
    );

    let isCancelled = false;
    progressDialog.addEventListener('close', () => {
      isCancelled = true;
    });

    const totalSteps = sourceIds.length * targetNotebookIds.length;
    let currentStep = 0;

    try {
      for (const sourceId of sourceIds) {
        if (isCancelled) break;

        // Récupérer le contenu de la source courante
        const currentNotebookId = window.MM.getActiveNotebookId();
        const content = await window.MM.rpc.getSourceContent(sourceId, currentNotebookId);
        const sourcesList = await window.MM.rpc.getNotebookSources(currentNotebookId);
        const sourceData = sourcesList.find(s => s.id === sourceId);
        const title = sourceData ? sourceData.title : 'Source transférée';

        for (const targetNotebookId of targetNotebookIds) {
          if (isCancelled) break;

          currentStep++;
          window.MM.updateProgressDialog(
            progressDialog,
            Math.round((currentStep / totalSteps) * 100),
            `${t('transferringSource') || 'Transfert de'} "${title}" (${currentStep}/${totalSteps})`
          );

          // Créer la source dans le notebook cible
          await window.MM.rpc.addTextSource(targetNotebookId, title, content);

          // Espacer les requêtes pour le rate-limiting
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }

      progressDialog.close();

      if (!isCancelled) {
        window.MM.showAlertDialog(
          t('transferSuccessTitle') || 'Transfert réussi',
          t('transferSuccessMsg') || 'Les sources ont été copiées avec succès.'
        );
      }

    } catch (err) {
      console.error('[MM] Erreur lors de l\'exécution du transfert :', err);
      progressDialog.close();
      window.MM.showAlertDialog(
        t('transferErrorTitle') || 'Échec du transfert',
        `${t('transferErrorMsg') || 'Une erreur est survenue lors du transfert :'} ${err.message}`
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3. INJECTIONS DES BOUTONS DANS L'UI
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Crée l'icône SVG du bouton de transfert.
   */
  function createTransferIcon() {
    return createElement('svg', {
      viewBox: '0 0 24 24',
      className: 'mm-icon-svg',
      'aria-hidden': 'true',
      innerHTML: '<path d="M19 10.08L15.06 6.14L13.65 7.56L15.09 9H9V11H15.09L13.65 12.44L15.06 13.86L19 10.08M19 2H5C3.89 2 3 2.9 3 4V20C3 21.1 3.89 22 5 22H19C20.1 22 21 21.1 21 20V4C21 2.9 20.1 2 19 2M19 20H5V4H19V20Z"/>'
    });
  }

  /**
   * Vérifie et injecte le bouton de transfert individuel dans le visualiseur de source.
   */
  function checkAndInjectIndividualTransfer() {
    if (!window.MM.isFeatureEnabled('transfer')) return;

    const sourceViewer = document.querySelector('source-viewer, [class*="source-viewer"]');
    if (!sourceViewer) return;

    // 1. Trouver le panel-header du panneau des sources (mode desktop)
    const sourcePanel = document.querySelector('section.source-panel');
    const panelHeader = sourcePanel ? sourcePanel.querySelector('.panel-header') : null;

    let anchor = panelHeader;
    let collapseBtn = null;

    if (panelHeader) {
      const nativeButtons = Array.from(panelHeader.querySelectorAll(
        'button:not(.mm-individual-delete-btn):not(.mm-individual-export-btn):not(.mm-individual-transfer-btn)'
      ));
      collapseBtn = nativeButtons.length > 0 ? nativeButtons[nativeButtons.length - 1] : null;
    }

    // 2. Si non trouvé (mode mobile), s'ancrer sur le bouton de retour du document
    if (!anchor || !collapseBtn) {
      const closeBtn = window.MM.findSourceViewerCloseButton(sourceViewer);
      if (closeBtn) {
        anchor = closeBtn.parentNode;
        collapseBtn = closeBtn;
      }
    }

    if (!anchor || !collapseBtn) {
      const retryCount = parseInt(sourceViewer.dataset.mmTransferRetryCount || '0', 10);
      if (retryCount < 3) {
        sourceViewer.dataset.mmTransferRetryCount = String(retryCount + 1);
        setTimeout(function () {
          checkAndInjectIndividualTransfer();
        }, retryCount === 0 ? 100 : 300);
      }
      return;
    }

    if (collapseBtn.parentNode.querySelector('.mm-individual-transfer-btn')) return;

    const transferBtn = createElement('button', {
      className: 'mm-individual-transfer-btn mm-btn-icon',
      title: t('transferButton') || 'Copier vers un autre carnet',
      'aria-label': t('transferButton') || 'Copier vers un autre carnet',
      onClick: function (e) {
        e.stopPropagation();

        const currentData = window.MM.findIndividualSourceData();
        if (!currentData) return;

        // Trouver l'ID de la source correspondante dans le DOM
        const currentNotebookId = window.MM.getActiveNotebookId();
        window.MM.rpc.getNotebookSources(currentNotebookId).then(sources => {
          const match = sources.find(s => s.title === currentData.title);
          if (!match) {
            console.error('[MM] Impossible de trouver la source par son titre.');
            return;
          }

          showTransferDialog(t('transferDialogTitle') || 'Copier la source vers...', (targetNotebookIds) => {
            executeTransfer([match.id], targetNotebookIds);
          });
        });
      }
    }, [createTransferIcon()]);

    // Insérer à gauche du bouton export MM s'il existe, ou à gauche de delete
    const exportBtn = collapseBtn.parentNode.querySelector('.mm-individual-export-btn');
    const deleteBtn = collapseBtn.parentNode.querySelector('.mm-individual-delete-btn');
    const anchorBefore = exportBtn || deleteBtn || collapseBtn;
    collapseBtn.parentNode.insertBefore(transferBtn, anchorBefore);
    console.log('[MM] Bouton transfert individuel injecté dans section.source-panel .panel-header');
  }

  /**
   * Vérifie et injecte le bouton de transfert en lot dans le panneau des sources.
   */
  function updateBatchTransferButtonState() {
    if (!window.MM.isFeatureEnabled('transfer')) {
      if (batchTransferButton) {
        batchTransferButton.remove();
        batchTransferButton = null;
      }
      return;
    }

    const checked = window.MM.getCheckedSourceCheckboxes();
    const count = checked.length;

    // Ancre prioritaire : le panel-header du panneau des sources de NotebookLM (desktop)
    const sourcePanel = document.querySelector('section.source-panel, .source-panel, [class*="source-panel"]');
    const panelHeader = sourcePanel ? sourcePanel.querySelector('.panel-header, [class*="header"]') : null;

    let anchor = panelHeader;
    let isHeader = true;

    if (!anchor) {
      // Tenter d'utiliser l'en-tête collant mobile
      const stickyHeader = window.MM.getOrCreateStickyHeader();
      if (stickyHeader) {
        anchor = stickyHeader.querySelector('.mm-sticky-header-actions');
      }
    }

    if (!anchor) {
      anchor = document.querySelector('.mm-search-bar') || window.MM.findSelectAllRow();
      isHeader = false;
    }

    if (!anchor) {
      return;
    }

    if (count === lastBatchTransferCount) {
      const buttonIsCorrect = count === 0
        ? !batchTransferButton
        : (batchTransferButton && anchor.contains(batchTransferButton));
      if (buttonIsCorrect) return;
    }

    lastBatchTransferCount = count;

    if (count === 0) {
      if (batchTransferButton) {
        batchTransferButton.remove();
        batchTransferButton = null;
        console.log('[MM] Retrait du bouton de transfert en lot (0 source cochée).');
      }
      return;
    }

    if (batchTransferButton) {
      batchTransferButton.remove();
    }

    // Créer le bouton de transfert
    batchTransferButton = createElement('button', {
      className: 'mm-batch-transfer-btn mm-btn-icon mm-pulse-animation',
      title: `${t('transferSelected') || 'Copier les sources sélectionnées'} (${count})`,
      'aria-label': `${t('transferSelected') || 'Copier les sources sélectionnées'} (${count})`,
      onClick: function (e) {
        e.stopPropagation();

        const checkedBoxes = window.MM.getCheckedSourceCheckboxes();
        const sourceIds = Array.from(checkedBoxes).map(cb => {
          const card = window.MM.findSourceCardFromCheckbox(cb);
          return card ? card.dataset.sourceId : null;
        }).filter(Boolean);

        if (sourceIds.length === 0) return;

        showTransferDialog(
          `${t('transferSelectedTitle') || 'Copier les'} ${count} ${t('sourcesSelected') || 'sources sélectionnées vers...'}`,
          (targetNotebookIds) => {
            executeTransfer(sourceIds, targetNotebookIds);
          }
        );
      }
    }, [createTransferIcon()]);

    if (isHeader) {
      // Insérer à gauche du bouton export batch
      const batchExport = anchor.querySelector('.mm-batch-export-btn');
      const batchMerge = anchor.querySelector('.mm-batch-merge-btn');
      const searchBar = anchor.querySelector('.mm-search-bar');
      const anchorBefore = batchExport || batchMerge || searchBar;
      
      if (anchorBefore) {
        anchor.insertBefore(batchTransferButton, anchorBefore);
      } else {
        anchor.appendChild(batchTransferButton);
      }
    } else {
      anchor.appendChild(batchTransferButton);
    }

    console.log(`[MM] Bouton transfert en lot injecté (sources cochées: ${count}).`);
  }

  /**
   * Supprime proprement tous les éléments injectés par le module.
   */
  function cleanupTransferModule() {
    if (batchTransferButton) {
      batchTransferButton.remove();
      batchTransferButton = null;
    }
    const indTransfer = document.querySelectorAll('.mm-individual-transfer-btn');
    indTransfer.forEach(btn => btn.remove());
    lastBatchTransferCount = -1;
    console.log('[MM] Module transfer nettoyé.');
  }

  // Exposition publique pour l'orchestrateur et l'observer
  window.MM.transfer = {
    checkAndInjectIndividualTransfer: checkAndInjectIndividualTransfer,
    updateBatchTransferButtonState: updateBatchTransferButtonState,
    cleanup: cleanupTransferModule
  };

})();
