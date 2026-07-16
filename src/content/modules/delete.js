// delete.js — Module de suppression à la volée d'une source (F4)
// Auteur : MTF Karukera | Licence : MPL-2.0
// Dépendance : window.MM (utils.js et dialogs.js chargés avant)

'use strict';

(function () {
  const { t, debounce } = window.MM;

  console.log('[MM] === CHARGEMENT DE DELETE.JS V19 (PANEL HEADER SUPPRESSION) ===');

  // ═══════════════════════════════════════════════════════════════════════
  // État interne
  // ═══════════════════════════════════════════════════════════════════════

  /** Observer DOM global pour détecter l'ouverture du panneau individuel */
  let listObserver = null;

  /** Verrou global pour empêcher les doubles suppressions concurrentes */
  let isDeleting = false;

  // ═══════════════════════════════════════════════════════════════════════
  // Sélecteurs DOM — fondés sur le diagnostic réel de NotebookLM
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Retourne tous les conteneurs individuels de source dans la sidebar.
   * @returns {Element[]}
   */
  function findSourceContainers() {
    return Array.from(
      document.querySelectorAll('div.single-source-container')
    );
  }

  /**
   * Trouve le bouton "⋮" (more_vert) dans un conteneur de source donné.
   */
  function findMoreButton(container) {
    const buttons = container.querySelectorAll('button');
    for (const btn of buttons) {
      const txt = (btn.textContent || '').trim();
      if (txt === 'more_vert' || txt === 'more_horiz') return btn;
    }
    for (const btn of buttons) {
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (label === 'plus' || label === 'more' || label === 'more options') {
        return btn;
      }
    }
    return null;
  }

  /**
   * Extrait le titre de la source depuis un conteneur.
   */
  function getSourceTitle(container) {
    const stretchedBtn = container.querySelector('button.source-stretched-button');
    if (stretchedBtn) {
      return stretchedBtn.getAttribute('aria-label') || '';
    }
    const checkbox = container.querySelector('input[type="checkbox"]');
    if (checkbox) {
      return checkbox.getAttribute('aria-label') || '';
    }
    return t('defaultDocumentTitle');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Simulation de clic robuste pour frameworks (Angular/Lit)
  // ═══════════════════════════════════════════════════════════════════════

  function simulateClick(el) {
    if (!el) return;
    try {
      el.focus();
    } catch (e) {}
    el.click();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Routine de recherche résiliente et asynchrone (Retry Polling)
  // ═══════════════════════════════════════════════════════════════════════

  async function waitForElements(selector, keywords, maxWaitMs) {
    maxWaitMs = maxWaitMs || 1500;
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const elements = Array.from(document.querySelectorAll(selector));
      for (const el of elements) {
        const txt = (el.textContent || '').trim().toLowerCase();
        const match = keywords.some(function (kw) {
          return txt.indexOf(kw) !== -1;
        });
        if (match) return el;
      }
      await new Promise(function (r) { setTimeout(r, 50); });
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Extraction de l'ID de source (Heuristiques robustes)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Extrait de façon robuste l'identifiant de source à partir de son conteneur DOM.
   * Scanne les attributs du conteneur et de tous ses descendants à la recherche d'UUIDs
   * ou du préfixe spécifique s:... de Google.
   *
   * @param {Element} container - Conteneur DOM de la source.
   * @returns {string|null} - ID de la source trouvé, ou null.
   */
  function extractSourceId(container) {
    if (!container) return null;

    // 1. Recherche d'attributs de données explicites
    const dataAttrs = ['data-id', 'data-source-id', 'data-sourceid', 'data-doc-id'];
    for (const attr of dataAttrs) {
      let val = container.getAttribute(attr);
      if (val) return val;

      const childWithAttr = container.querySelector(`[${attr}]`);
      if (childWithAttr) {
        val = childWithAttr.getAttribute(attr);
        if (val) return val;
      }
    }

    // 2. Analyse de motifs (regex) dans tous les attributs textuels
    const uuidPattern = /[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}/i;
    const googleSourcePattern = /s:[a-zA-Z0-9_-]+/i;

    function searchPattern(str) {
      if (!str) return null;
      let match = str.match(uuidPattern);
      if (match) return match[0];
      match = str.match(googleSourcePattern);
      if (match) return match[0];
      return null;
    }

    // Tester les attributs communs sur le conteneur lui-même
    const containerAttrs = ['id', 'jslog', 'jsdata', 'jsaction', 'aria-describedby'];
    for (const attr of containerAttrs) {
      const id = searchPattern(container.getAttribute(attr));
      if (id) return id;
    }

    // Tester les attributs sur tous les descendants (checkboxes, boutons, etc.)
    const children = container.querySelectorAll('*');
    for (const child of children) {
      const childAttrs = ['id', 'name', 'jslog', 'jsdata', 'jsaction', 'aria-describedby', 'aria-label', 'value'];
      for (const attr of childAttrs) {
        const id = searchPattern(child.getAttribute(attr));
        if (id) return id;
      }
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Routine de suppression native (Virtual Flow Deletion)
  // ═══════════════════════════════════════════════════════════════════════

  const DELETE_KEYWORDS = [
    'supprimer', 'retirer', 'delete', 'remove', 'eliminar', 'quitar',
    'löschen', 'entfernen', 'apagar', 'remover', '削除', 'xóa', 'gỡ bỏ'
  ];

  /**
   * Ouvre directement le dialogue de confirmation natif de Google.
   */
  async function triggerNativeDeleteDialog(container) {
    if (isDeleting) return;
    isDeleting = true;

    try {
      const moreBtn = findMoreButton(container);
      if (!moreBtn) return;
      simulateClick(moreBtn);

      const deleteOption = await waitForElements(
        '[role="menuitem"], button, .mat-mdc-menu-item, .mdc-list-item, [class*="menu-item"], [class*="menuitem"]',
        DELETE_KEYWORDS,
        1500
      );

      if (deleteOption) {
        simulateClick(deleteOption);
      } else {
        document.body.click(); // Fermer le menu
      }
    } catch (err) {
      console.error('[MM] Erreur lors de la suppression native :', err);
    } finally {
      setTimeout(function () {
        isDeleting = false;
      }, 1000);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Pictogramme SVG de corbeille
  // ═══════════════════════════════════════════════════════════════════════

  function createTrashIcon(size) {
    size = size || 15;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('fill', 'currentColor');
    svg.style.display = 'block';
    svg.style.pointerEvents = 'none';

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d',
      'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z'
    );

    svg.appendChild(path);
    return svg;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Injection dans le panneau de consultation individuelle (carré rouge)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Injecte le bouton corbeille directement à gauche du bouton de fermeture/réduction.
   * Le conteneur source est identifié avant l'injection pour éviter tout problème de timing.
   */
  function checkAndInjectIndividualDelete() {
    if (window.location.pathname.indexOf('/notebook/') === -1) return;

    // 1. Détecter si un source-viewer est actif (preuve que la vue est ouverte)
    const sourceViewer = document.querySelector('source-viewer');
    if (!sourceViewer) return;

    // 2. Récupérer le titre du document ouvert (recherche robuste)
    const titleEl = window.MM.findSourceViewerTitle(sourceViewer);
    const sourcePanel = document.querySelector('section.source-panel');
    const panelHeader = sourcePanel ? sourcePanel.querySelector('.panel-header') : null;

    let anchor = panelHeader;
    let collapseBtn = null;

    if (panelHeader) {
      const nativeButtons = Array.from(panelHeader.querySelectorAll(
        'button:not(.mm-individual-delete-btn):not(.mm-individual-export-btn)'
      ));
      collapseBtn = nativeButtons.length > 0 ? nativeButtons[nativeButtons.length - 1] : null;
    }

    // 3. Mode mobile/sans-header : s'ancrer sur le bouton de retour du document
    if (!anchor || !collapseBtn) {
      const closeBtn = window.MM.findSourceViewerCloseButton(sourceViewer);
      if (closeBtn) {
        anchor = closeBtn.parentNode;
        collapseBtn = closeBtn;
      }
    }

    // Si les éléments requis ne sont pas encore prêts (en cours d'hydratation asynchrone par Angular)
    if (!titleEl || !titleEl.textContent.trim() || !anchor || !collapseBtn) {
      const retryCount = parseInt(sourceViewer.dataset.mmDeleteRetryCount || '0', 10);
      if (retryCount < 3) {
        sourceViewer.dataset.mmDeleteRetryCount = String(retryCount + 1);
        setTimeout(function () {
          checkAndInjectIndividualDelete();
        }, retryCount === 0 ? 100 : 300);
      }
      return;
    }

    // Vérifier localement sous le parent commun pour éviter de détecter
    // des boutons fantômes d'autres onglets mis en cache par Angular
    if (collapseBtn.parentNode.querySelector('.mm-individual-delete-btn')) return;

    // Utiliser findSourceViewerTitleText pour un titre propre (sans icônes Material)
    const sourceTitle = window.MM.findSourceViewerTitleText(sourceViewer) || titleEl.textContent.trim();

    // 5. Trouver le conteneur source correspondant dans la liste (il est encore dans le DOM)
    //    Les single-source-container existent même quand source-viewer est ouvert
    let targetContainer = null;
    const containers = findSourceContainers();
    for (const ctr of containers) {
      const title = getSourceTitle(ctr);
      // Comparaison souple sur les 25 premiers caractères
      const prefix = sourceTitle.substring(0, 25);
      if (title && title.includes(prefix)) {
        targetContainer = ctr;
        break;
      }
    }

    // Créer le bouton corbeille
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'mm-individual-delete-btn';
    deleteBtn.title = t('deleteConfirmTitle');
    deleteBtn.setAttribute('aria-label', t('deleteConfirmTitle'));
    deleteBtn.appendChild(createTrashIcon(16));

    deleteBtn.addEventListener('click', function (e) {
      e.stopPropagation();

      if (!targetContainer) {
        // Fallback : re-chercher si le conteneur n'a pas été trouvé à l'injection
        const allContainers = findSourceContainers();
        for (const ctr of allContainers) {
          const title = getSourceTitle(ctr);
          if (title && title.includes(sourceTitle.substring(0, 25))) {
            targetContainer = ctr;
            break;
          }
        }
      }

      if (targetContainer) {
        // Tenter la suppression via RPC en arrière-plan
        const match = window.location.pathname.match(/\/notebook\/([a-zA-Z0-9_-]+)/);
        const notebookId = match ? match[1] : null;
        const sourceId = extractSourceId(targetContainer);

        if (notebookId && sourceId) {
          const isConfirmed = confirm(`${t('deleteConfirmTitle')} "${sourceTitle}" ?`);
          if (!isConfirmed) return;

          deleteBtn.disabled = true;
          console.log(`[MM] Suppression par RPC de la source ${sourceId} dans le notebook ${notebookId}`);

          window.MM.rpc.deleteSource(sourceId, notebookId)
            .then(function () {
              console.log('[MM] Suppression RPC réussie. Nettoyage de l\'interface.');

              // Retirer visuellement la source du DOM avec effet fondu
              if (targetContainer) {
                targetContainer.style.transition = 'opacity 0.4s ease';
                targetContainer.style.opacity = '0';
                setTimeout(function () {
                  targetContainer.remove();
                }, 400);
              }

              // Fermer le panneau individuel (collapse)
              simulateClick(collapseBtn);
            })
            .catch(function (err) {
              console.error('[MM] Échec de la suppression RPC, repli sur le flux natif :', err);
              // Fallback en cas d'erreur de communication ou d'expiration de session
              triggerNativeDeleteDialog(targetContainer);
            })
            .finally(function () {
              deleteBtn.disabled = false;
            });
        } else {
          console.warn('[MM] Informations de source ou de notebook manquantes pour RPC, utilisation du flux natif.');
          triggerNativeDeleteDialog(targetContainer);
        }
      } else {
        // Dernier recours : fermer le panneau et réessayer
        simulateClick(collapseBtn);
        setTimeout(function () {
          const fallback = findSourceContainers();
          for (const ctr of fallback) {
            const title = getSourceTitle(ctr);
            if (title && title.includes(sourceTitle.substring(0, 25))) {
              triggerNativeDeleteDialog(ctr);
              break;
            }
          }
        }, 400);
      }
    });

    // Insérer juste à gauche du bouton collapse natif (carré rouge)
    collapseBtn.parentNode.insertBefore(deleteBtn, collapseBtn);
    console.log('[MM] Bouton corbeille injecté dans section.source-panel .panel-header, source cible :', sourceTitle);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Cycle de vie
  // ═══════════════════════════════════════════════════════════════════════

  function initDelete() {
    // L'observer sur le DOM est géré de manière centralisée dans panel-observer.js
    // On se contente d'exposer les fonctions d'injection et de cleanup
    console.log('[MM] Module suppression initialisé (v19 — panel header suppression)');
  }

  function cleanupDelete() {
    document.querySelectorAll('.mm-individual-delete-btn').forEach(
      function (b) { b.remove(); }
    );
    console.log('[MM] Module suppression nettoyé');
  }

  window.MM.initDelete = initDelete;
  window.MM.cleanupDelete = cleanupDelete;
  // Exposé pour panel-observer.js
  window.MM.checkAndInjectIndividualDelete = checkAndInjectIndividualDelete;
})();
