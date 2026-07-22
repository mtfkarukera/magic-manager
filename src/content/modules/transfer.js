// transfer.js — Module de copie inter-carnets de sources
// Auteur : MTF Karukera | Licence : MPL-2.0
// Dépendances :
// - window.MM (t, createElement, debounce, getCheckedSourceCheckboxes,
//   findSourceCardFromCheckbox, findSelectAllRow, getActiveNotebookId)
// - window.MM.rpc (listNotebooks, addUrlSource, addYoutubeSource,
//   addDriveSource, addTextSource, getSourceContentHtml, getNotebookSources)
// - window.MM.exportUtils (cleanSourceTitle)
// - window.MM.htmlToMd

'use strict';

(function () {
  const { t, createElement, debounce } = window.MM;

  // ═══════════════════════════════════════════════════════════════════════
  // État interne
  // ═══════════════════════════════════════════════════════════════════════

  /** Bouton de transfert par lot (injecté dynamiquement) */
  let batchTransferButton = null;

  /** Dernier nombre de sources cochées connu — verrou d'idempotence */
  let lastBatchTransferCount = -1;

  /** Témoin d'annulation des traitements par lot en cours */
  let transferCancelled = false;

  /** Helper de pause asynchrone pour l'espacement anti-rate-limiting */
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // ═══════════════════════════════════════════════════════════════════════
  // Pictogramme SVG
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Crée l'icône de transfert (flèche droite vers conteneur/barre).
   * @returns {SVGElement}
   */
  function createTransferIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'currentColor');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M14 6l-1.41 1.41L16.17 11H4v2h12.17l-3.58 3.59L14 18l6-6-6-6zM20 4v16h2V4h-2z');
    svg.appendChild(path);
    return svg;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Stratégie et exécution de transfert
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Détermine la stratégie de transfert optimale pour une source donnée.
   * @param {Object} source - Métadonnées de la source (kind, url, youtubeUrl, driveFileId, etc.)
   * @returns {Object} { method: 'drive'|'url'|'youtube'|'text', ...params }
   */
  function resolveTransferStrategy(source) {
    let effectiveKind = source.kind;
    // Désambiguïsation du code 14 (PDF hébergé sur Drive vs Google Sheet)
    if (effectiveKind === 14) {
      const mime = source.topLevelMime || source.driveMimeType || '';
      if (mime === 'application/pdf') {
        effectiveKind = 3;
      }
    }

    // 1. Règle Drive Universelle : Si un driveFileId est présent, toujours utiliser la méthode 'drive'
    if (source.driveFileId) {
      return {
        method: 'drive',
        fileId: source.driveFileId,
        mimeType: source.driveMimeType,
        title: source.title
      };
    }

    // 2. Détection hybride des images locales (non hébergées sur Drive ni URL)
    const titleLower = (source.title || '').toLowerCase();
    const isImageExtension = /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(titleLower);
    const isImageMime = (source.topLevelMime || source.driveMimeType || '').startsWith('image/');
    const isImageKind = effectiveKind === 13;

    if ((isImageKind || isImageMime || isImageExtension) && !source.url) {
      return {
        method: 'unsupported',
        title: source.title,
        reason: 'Image locale (copie inter-carnets non supportée par Google)'
      };
    }

    // 3. Pages Web
    if (effectiveKind === 5 && source.url) {
      return { method: 'url', url: source.url, title: source.title };
    }

    // 4. Vidéos YouTube
    if (effectiveKind === 9 && source.youtubeUrl) {
      return { method: 'youtube', url: source.youtubeUrl, title: source.title };
    }

    // 5. Fallback universel : extraction du contenu HTML → Markdown → source texte
    return {
      method: 'text',
      sourceId: source.id,
      title: source.title
    };
  }

  /**
   * Exécute le transfert d'une source unique vers un carnet cible.
   * @param {Object} strategy - Stratégie de transfert résolue
   * @param {string} targetNotebookId - ID du carnet de destination
   * @param {string} sourceNotebookId - ID du carnet source actuel
   */
  async function executeTransfer(strategy, targetNotebookId, sourceNotebookId) {
    switch (strategy.method) {
      case 'unsupported':
        throw new Error(strategy.reason || 'Source non prise en charge pour la copie inter-carnets.');

      case 'drive':
        return window.MM.rpc.addDriveSource(targetNotebookId, strategy.fileId, strategy.mimeType, strategy.title);

      case 'url':
        return window.MM.rpc.addUrlSource(targetNotebookId, strategy.url);

      case 'youtube':
        return window.MM.rpc.addYoutubeSource(targetNotebookId, strategy.url);

      case 'text': {
        const rawContent = await window.MM.rpc.getSourceContent(strategy.sourceId, sourceNotebookId, { format: 'html' });
        const content = (typeof rawContent === 'string' && rawContent.trim().length > 0)
          ? rawContent.trim()
          : '[Contenu de la source indisponible]';
        return window.MM.rpc.addTextSource(targetNotebookId, strategy.title, content);
      }

      default:
        throw new Error(`[MM] Stratégie de transfert inconnue : ${strategy.method}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Dialogues modaux (Sélection & Progression)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Affiche le dialogue modal de sélection du carnet destination.
   * @param {Array<Object>} sourcesToTransfer - Liste des sources à copier
   * @param {Function} onConfirm - Callback (targetNotebookId) => void
   */
  async function showNotebookSelectionDialog(sourcesToTransfer, onConfirm) {
    const currentNotebookId = window.MM.getActiveNotebookId();

    // 1. Charger la liste des carnets via RPC wXbhsf
    let notebooks = [];
    try {
      notebooks = await window.MM.rpc.listNotebooks();
    } catch (err) {
      console.error('[MM] Impossible de charger la liste des carnets :', err);
      if (typeof window.MM.showAlertDialog === 'function') {
        window.MM.showAlertDialog('transferError', 'Impossible de charger la liste de tes carnets.');
      }
      return;
    }

    if (!Array.isArray(notebooks) || notebooks.length === 0) {
      if (typeof window.MM.showAlertDialog === 'function') {
        window.MM.showAlertDialog('transferError', 'Aucun autre carnet disponible.');
      }
      return;
    }

    let selectedNotebookId = null;

    // Boutons de la modale
    const cancelBtn = createElement('button', {
      className: 'mm-btn mm-btn-secondary',
      textContent: t('dialogCancelButton') || 'Annuler',
      onClick: () => closeDialog()
    });

    const confirmBtn = createElement('button', {
      className: 'mm-btn mm-btn-primary',
      disabled: true,
      textContent: t('transferConfirmButton', [sourcesToTransfer.length]) || `Copier (${sourcesToTransfer.length} sources)`,
      onClick: () => {
        if (!selectedNotebookId) return;
        const targetId = selectedNotebookId;
        closeDialog();
        onConfirm(targetId);
      }
    });

    // Champ de recherche filtrant
    const searchInput = createElement('input', {
      type: 'text',
      className: 'mm-notebook-search',
      placeholder: t('transferSearchNotebook') || 'Rechercher un carnet...',
      onInput: (e) => {
        const query = e.target.value.trim().toLowerCase();
        const items = listContainer.querySelectorAll('.mm-notebook-item');
        items.forEach((item) => {
          const title = item.getAttribute('data-title') || '';
          if (!query || title.includes(query)) {
            item.style.display = '';
          } else {
            item.style.display = 'none';
          }
        });
      }
    });

    // Bouton Créer un nouveau carnet
    const createNotebookBtn = createElement('button', {
      type: 'button',
      className: 'mm-btn mm-btn-secondary mm-btn-create-notebook',
      textContent: t('transferNewNotebookBtn') || '+ Nouveau carnet',
      onClick: () => {
        const promptTitleKey = 'transferNewNotebookPrompt';
        const promptPlaceholderKey = 'transferNewNotebookPlaceholder';

        const doCreate = async (newTitle) => {
          if (!newTitle || !newTitle.trim()) return;
          try {
            createNotebookBtn.disabled = true;
            const newNb = await window.MM.rpc.createNotebook(newTitle.trim());
            createNotebookBtn.disabled = false;

            notebooks.unshift(newNb);
            const itemElem = renderNotebookItem(newNb);
            listContainer.prepend(itemElem);

            // Auto-sélectionner le carnet créé
            const rad = itemElem.querySelector('input[type="radio"]');
            if (rad) {
              rad.checked = true;
              selectedNotebookId = newNb.id;
              confirmBtn.disabled = false;
              updateSelectedStyles();
            }
          } catch (createErr) {
            createNotebookBtn.disabled = false;
            console.error('[MM] Échec de la création du carnet :', createErr);
            if (typeof window.MM.showAlertDialog === 'function') {
              window.MM.showAlertDialog('transferError', `Impossible de créer le carnet : ${createErr.message || createErr}`);
            }
          }
        };

        if (typeof window.MM.showPromptDialog === 'function') {
          window.MM.showPromptDialog(promptTitleKey, promptPlaceholderKey, doCreate);
        } else {
          const promptMsg = t(promptTitleKey) || 'Nom du nouveau carnet :';
          const inputTitle = window.prompt(promptMsg);
          if (inputTitle) doCreate(inputTitle);
        }
      }
    });

    const toolbar = createElement('div', { className: 'mm-transfer-toolbar' }, [
      searchInput,
      createNotebookBtn
    ]);

    // Conteneur de la liste des carnets
    const listContainer = createElement('div', { className: 'mm-notebook-list' });

    function renderNotebookItem(nb) {
      const isCurrent = nb.id === currentNotebookId;

      const radio = createElement('input', {
        type: 'radio',
        name: 'mm-target-notebook',
        id: `mm-nb-${nb.id}`,
        value: nb.id,
        disabled: isCurrent,
        onChange: () => {
          selectedNotebookId = nb.id;
          confirmBtn.disabled = false;
          updateSelectedStyles();
        }
      });

      let countText = t('transferSourcesCount', String(nb.sourceCount)) || `${nb.sourceCount} sources`;
      if (isCurrent) {
        countText += ` (${t('transferCurrentNotebook') || 'Carnet actuel'})`;
      }

      const countBadge = createElement('span', {
        className: 'mm-notebook-count',
        textContent: countText
      });

      const label = createElement('label', {
        htmlFor: `mm-nb-${nb.id}`,
        className: 'mm-notebook-label'
      }, [
        createElement('span', { className: 'mm-notebook-title', textContent: nb.title }),
        countBadge
      ]);

      const itemClasses = ['mm-notebook-item'];
      if (isCurrent) itemClasses.push('disabled');

      return createElement('div', {
        className: itemClasses.join(' '),
        'data-title': nb.title.toLowerCase(),
        onClick: () => {
          if (isCurrent) return;
          radio.checked = true;
          selectedNotebookId = nb.id;
          confirmBtn.disabled = false;
          updateSelectedStyles();
        }
      }, [radio, label]);
    }

    notebooks.forEach((nb) => {
      listContainer.appendChild(renderNotebookItem(nb));
    });

    function updateSelectedStyles() {
      const items = listContainer.querySelectorAll('.mm-notebook-item');
      items.forEach((item) => {
        const rad = item.querySelector('input[type="radio"]');
        if (rad && rad.checked) {
          item.classList.add('selected');
        } else {
          item.classList.remove('selected');
        }
      });
    }

    // Message d'information
    const infoText = createElement('p', {
      className: 'mm-transfer-info',
      textContent: t('transferFallbackInfo') || 'Les fichiers locaux seront convertis en Markdown enrichi.'
    });

    const dialogTitleId = 'mm-dialog-title-' + Date.now();
    const dialog = createElement('dialog', {
      className: 'mm-dialog mm-transfer-dialog',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': dialogTitleId
    }, [
      createElement('h2', { id: dialogTitleId, className: 'mm-dialog-title', textContent: t('transferDialogTitle') || 'Copier vers un autre carnet' }),
      createElement('p', { className: 'mm-dialog-message', textContent: t('transferSelectTarget') || 'Sélectionne le carnet de destination :' }),
      toolbar,
      listContainer,
      infoText,
      createElement('div', { className: 'mm-dialog-actions' }, [cancelBtn, confirmBtn])
    ]);

    function closeDialog() {
      dialog.close();
      dialog.remove();
    }

    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      closeDialog();
    });

    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) closeDialog();
    });

    document.body.appendChild(dialog);
    dialog.showModal();
    searchInput.focus();
  }

  /**
   * Affiche le dialogue modal de progression du transfert.
   * @param {number} total - Nombre total de sources à transférer
   * @returns {Object} Contrôleur de mise à jour UI { updateItem, setComplete, close }
   */
  function showTransferProgressDialog(total) {
    transferCancelled = false;

    const progressFill = createElement('div', {
      className: 'mm-progress-bar-fill',
      style: 'width: 0%;'
    });
    const progressBar = createElement('div', { className: 'mm-progress-bar' }, [progressFill]);

    const statusText = createElement('div', {
      className: 'mm-progress-status-text',
      textContent: `0 / ${total}`
    });

    const itemsList = createElement('div', { className: 'mm-transfer-items-list' });

    const cancelBtn = createElement('button', {
      className: 'mm-btn mm-btn-secondary',
      textContent: t('dialogCancelButton') || 'Annuler',
      onClick: () => {
        transferCancelled = true;
        cancelBtn.disabled = true;
        cancelBtn.textContent = 'Annulation...';
      }
    });

    const dialogTitleId = 'mm-dialog-title-' + Date.now();
    const dialog = createElement('dialog', {
      className: 'mm-dialog mm-transfer-progress-dialog',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': dialogTitleId
    }, [
      createElement('h2', { id: dialogTitleId, className: 'mm-dialog-title', textContent: t('transferInProgress') || 'Copie en cours...' }),
      progressBar,
      statusText,
      itemsList,
      createElement('div', { className: 'mm-dialog-actions' }, [cancelBtn])
    ]);

    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      transferCancelled = true;
    });

    document.body.appendChild(dialog);
    dialog.showModal();

    return {
      updateItem: (index, status, title, details) => {
        const percent = Math.round(((index + 1) / total) * 100);
        progressFill.style.width = `${percent}%`;
        statusText.textContent = `${index + 1} / ${total}`;

        let icon = '⏳';
        let statusClass = 'pending';
        if (status === 'success') {
          icon = '✅';
          statusClass = 'success';
        } else if (status === 'error') {
          icon = '❌';
          statusClass = 'error';
        }

        const row = createElement('div', { className: `mm-transfer-item ${statusClass}` }, [
          createElement('span', { className: 'mm-transfer-item-icon', textContent: icon }),
          createElement('span', { className: 'mm-transfer-item-title', textContent: title }),
          details ? createElement('span', { className: 'mm-transfer-item-details', textContent: `(${details})` }) : null
        ]);

        itemsList.appendChild(row);
        itemsList.scrollTop = itemsList.scrollHeight;
      },

      setComplete: (successCount, failCount) => {
        const titleEl = dialog.querySelector('.mm-dialog-title');
        if (titleEl) {
          titleEl.textContent = t('transferComplete') || 'Copie terminée';
        }
        statusText.textContent = t('transferPartialSuccess', [successCount, failCount]) || `${successCount} source(s) copiée(s), ${failCount} échecs`;

        cancelBtn.textContent = t('dialogConfirmButton') || 'Fermer';
        cancelBtn.disabled = false;
        cancelBtn.className = 'mm-btn mm-btn-primary';
        cancelBtn.onclick = () => {
          dialog.close();
          dialog.remove();
        };
      },

      close: () => {
        dialog.close();
        dialog.remove();
      }
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Déclencheur du transfert par lot
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Déclenche le flux de transfert pour les sources actuellement sélectionnées.
   */
  async function triggerBatchTransfer() {
    const checkedCheckboxes = window.MM.getCheckedSourceCheckboxes();
    if (!checkedCheckboxes || checkedCheckboxes.length === 0) return;

    const sourceTitles = [];
    checkedCheckboxes.forEach((cb) => {
      const sourceInfo = window.MM.findSourceCardFromCheckbox(cb);
      if (sourceInfo && sourceInfo.title) {
        const cleanTitle = typeof window.MM.exportUtils?.cleanSourceTitle === 'function'
          ? window.MM.exportUtils.cleanSourceTitle(sourceInfo.title)
          : sourceInfo.title.trim();
        sourceTitles.push(cleanTitle);
      }
    });

    if (sourceTitles.length === 0) return;

    const currentNotebookId = window.MM.getActiveNotebookId();
    if (!currentNotebookId) return;

    // Résoudre les métadonnées complètes des sources depuis l'API
    let currentSources = [];
    try {
      currentSources = await window.MM.rpc.getNotebookSources(currentNotebookId);
    } catch (e) {
      console.warn('[MM] Impossible d\'obtenir les métadonnées détaillées des sources :', e);
    }

    // Mapper les titres cochés vers les objets sources enrichis
    const sourcesToTransfer = sourceTitles.map((title) => {
      const normTitle = title.trim().toLowerCase();
      const match = currentSources.find((s) => s.title && s.title.trim().toLowerCase() === normTitle);
      return match || { id: null, title: title, kind: undefined };
    });

    // 1. Lancer le processus de transfert inter-carnets
    await startTransferProcess(sourcesToTransfer);
  }

  /**
   * Lance le processus de transfert inter-carnets (sélection carnet destination + progression).
   * @param {Array<Object>} sourcesToTransfer - Liste des objets sources enrichis à transférer
   */
  async function startTransferProcess(sourcesToTransfer) {
    if (!sourcesToTransfer || sourcesToTransfer.length === 0) return;

    const currentNotebookId = window.MM.getActiveNotebookId();
    if (!currentNotebookId) return;

    // 1. Demander le carnet destination
    await showNotebookSelectionDialog(sourcesToTransfer, async (targetNotebookId) => {
      // 2. Ouvrir le dialogue de progression
      const progressUi = showTransferProgressDialog(sourcesToTransfer.length);

      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < sourcesToTransfer.length; i++) {
        if (transferCancelled) {
          console.log('[MM] Transfert inter-carnets annulé par l\'utilisateur');
          break;
        }

        const src = sourcesToTransfer[i];
        let strategy = resolveTransferStrategy(src);

        if (strategy.method === 'unsupported') {
          failCount++;
          progressUi.updateItem(i, 'error', src.title, strategy.reason || 'Source non supportée');
          continue;
        }

        try {
          await executeTransfer(strategy, targetNotebookId, currentNotebookId);
          successCount++;
          progressUi.updateItem(i, 'success', src.title, strategy.method);
        } catch (err) {
          console.error(`[MM] Erreur lors de la copie de "${src.title}" (méthode: ${strategy.method}) :`, err);

          // Tentative de fallback en mode texte si la méthode initiale (Drive/URL) échoue
          if (strategy.method !== 'text' && src.id) {
            try {
              console.log(`[MM] Tentative de fallback texte pour "${src.title}"...`);
              const fallbackStrategy = { method: 'text', sourceId: src.id, title: src.title };
              await executeTransfer(fallbackStrategy, targetNotebookId, currentNotebookId);
              successCount++;
              progressUi.updateItem(i, 'success', src.title, 'text fallback');
            } catch (fallbackErr) {
              console.error(`[MM] Échec du fallback pour "${src.title}" :`, fallbackErr);
              failCount++;
              progressUi.updateItem(i, 'error', src.title, fallbackErr.message || 'Échec');
            }
          } else {
            failCount++;
            progressUi.updateItem(i, 'error', src.title, err.message || 'Échec');
          }
        }

        // Espacement anti-rate-limiting de 400ms entre chaque appel RPC
        if (i < sourcesToTransfer.length - 1 && !transferCancelled) {
          await sleep(400);
        }
      }

      progressUi.setComplete(successCount, failCount);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Gestion du Bouton Batch
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Met à jour réactivement l'état et la visibilité du bouton de transfert par lot.
   */
  function updateBatchTransferButtonState() {
    const checkedCheckboxes = window.MM.getCheckedSourceCheckboxes();
    const count = checkedCheckboxes ? checkedCheckboxes.length : 0;

    // Ancre prioritaire : panel-header du panneau sources (desktop)
    const sourcePanel = document.querySelector('section.source-panel, .source-panel, [class*="source-panel"]');
    const panelHeader = sourcePanel ? sourcePanel.querySelector('.panel-header, [class*="header"]') : null;

    // Détection du layout mobile pour rediriger vers le sticky-header
    const isMobileLayout = typeof window.MM.detectDesktopLayout === 'function' && !window.MM.detectDesktopLayout();

    let anchor = (!isMobileLayout && panelHeader) ? panelHeader : null;
    let isHeader = !!anchor;
    let isMobileSticky = false;

    if (!anchor) {
      // Fallback mobile : en-tête collant (sticky-header)
      const stickyHeader = typeof window.MM.getOrCreateStickyHeader === 'function'
        ? window.MM.getOrCreateStickyHeader() : null;
      if (stickyHeader) {
        anchor = stickyHeader.querySelector('.mm-sticky-header-actions');
        isMobileSticky = true;
        isHeader = true;
      }
    }

    if (!anchor) {
      // Fallback DOM général
      anchor = document.querySelector('.mm-search-bar') || window.MM.findSelectAllRow();
      isHeader = false;
    }

    if (!anchor) return;

    // Verrou d'idempotence
    if (count === lastBatchTransferCount) {
      const buttonIsCorrect = count === 0
        ? !batchTransferButton
        : (batchTransferButton && anchor.contains(batchTransferButton));
      if (buttonIsCorrect) return;
    }
    lastBatchTransferCount = count;

    console.debug(`[MM] updateBatchTransferButtonState : ${count} source(s) cochée(s) détectée(s).`);

    if (count > 0) {
      if (!batchTransferButton || !anchor.contains(batchTransferButton)) {
        if (batchTransferButton) batchTransferButton.remove();

        batchTransferButton = createElement('button', {
          className: isHeader ? 'mm-batch-transfer-btn mm-btn-icon' : 'mm-batch-transfer-btn mm-btn-row',
          title: `${t('transferBatchButton') || 'Copier vers un carnet'} (${count})`,
          'aria-label': `${t('transferBatchButton') || 'Copier vers un carnet'} (${count})`,
          onClick: triggerBatchTransfer
        }, [
          createTransferIcon(),
          createElement('span', {
            className: 'mm-badge-count',
            textContent: `(${count})`
          })
        ]);

        if (isHeader && !isMobileSticky) {
          const mergeBtn = anchor.querySelector('.mm-batch-merge-btn');
          const exportBtn = anchor.querySelector('.mm-batch-export-btn');
          const collapseBtn = window.MM.getNativeCollapseBtn(anchor);
          const targetBefore = mergeBtn || exportBtn || collapseBtn;
          if (targetBefore) {
            targetBefore.parentNode.insertBefore(batchTransferButton, targetBefore);
          } else {
            anchor.appendChild(batchTransferButton);
          }
        } else {
          anchor.appendChild(batchTransferButton);
        }
      } else {
        const span = batchTransferButton.querySelector('span');
        if (span) span.textContent = `(${count})`;
        batchTransferButton.title = `${t('transferBatchButton') || 'Copier vers un carnet'} (${count})`;
        batchTransferButton.setAttribute('aria-label', `${t('transferBatchButton') || 'Copier vers un carnet'} (${count})`);
      }
    } else {
      if (batchTransferButton) {
        batchTransferButton.remove();
        batchTransferButton = null;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Injection du Bouton de Transfert Individuel (source-viewer)
  // ═══════════════════════════════════════════════════════════════════════

  function cleanSourceTitle(title) {
    if (!title) return '';
    return title.replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * Injecte le bouton de transfert individuel dans l'en-tête de la consultation (source-viewer).
   */
  function checkAndInjectIndividualTransfer() {
    if (typeof window.MM.isFeatureEnabled === 'function' && !window.MM.isFeatureEnabled('transfer')) return;

    const sourceViewer = document.querySelector('source-viewer');
    if (!sourceViewer) return;

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
      title: t('transferButton') || 'Copier vers un carnet',
      'aria-label': t('transferButton') || 'Copier vers un carnet',
      onClick: async function (e) {
        e.stopPropagation();

        const notebookId = window.MM.getActiveNotebookId();
        if (!notebookId) return;

        const rawTitle = window.MM.findSourceViewerTitleText(sourceViewer) ||
                      (window.MM.findSourceViewerTitle(sourceViewer) || { textContent: '' }).textContent.trim();
        const cleanedTitle = cleanSourceTitle(rawTitle);
        if (!cleanedTitle) return;

        try {
          const allSources = await window.MM.rpc.getNotebookSources(notebookId);
          let targetSource = allSources.find(s => cleanSourceTitle(s.title) === cleanedTitle);

          if (!targetSource) {
            console.warn('[MM] Source non trouvée par titre exact pour transfert, tentative par sous-chaîne :', cleanedTitle);
            const prefix = cleanedTitle.substring(0, 20);
            targetSource = allSources.find(s => s.title && s.title.includes(prefix));
          }

          if (!targetSource) {
            targetSource = {
              id: 'fallback_' + Date.now(),
              title: cleanedTitle,
              kind: 1
            };
          }

          await startTransferProcess([targetSource]);
        } catch (err) {
          console.error('[MM] Erreur lors du transfert individuel :', err);
          if (typeof window.MM.showAlertDialog === 'function') {
            window.MM.showAlertDialog('transferError', 'Échec du transfert : ' + (err.message || err));
          }
        }
      }
    }, [createTransferIcon()]);

    // Insertion : Placer juste avant le bouton delete s'il existe, sinon avant collapseBtn
    const deleteBtn = collapseBtn.parentNode.querySelector('.mm-individual-delete-btn');
    const targetBefore = deleteBtn || collapseBtn;
    if (targetBefore && targetBefore.parentNode) {
      targetBefore.parentNode.insertBefore(transferBtn, targetBefore);
    } else {
      anchor.appendChild(transferBtn);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Initialisation et Nettoyage
  // ═══════════════════════════════════════════════════════════════════════

  function initTransfer() {
    updateBatchTransferButtonState();
    console.log('[MM] Module transfert initialisé');
  }

  function cleanupTransfer() {
    if (batchTransferButton) {
      batchTransferButton.remove();
      batchTransferButton = null;
    }
    lastBatchTransferCount = -1;
    console.log('[MM] Module transfert nettoyé');
  }

  // Exposition globale MM
  window.MM.initTransfer = initTransfer;
  window.MM.cleanupTransfer = cleanupTransfer;
  window.MM.updateBatchTransferButtonState = updateBatchTransferButtonState;
  window.MM.checkAndInjectIndividualTransfer = checkAndInjectIndividualTransfer;
})();
