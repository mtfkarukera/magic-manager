// chatexport.js — Module d'export de la conversation chat vers une note (F6)
// Auteur : MTF Karukera | Licence : MPL-2.0
// Dépendance : window.MM (utils.js chargé avant)

'use strict';

(function () {
  const { t, createElement, debounce } = window.MM;

  let chatObserver = null;

  /**
   * Crée l'icône SVG du bouton de sauvegarde de note.
   */
  function createNoteIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'currentColor');
    svg.style.display = 'block';
    svg.style.pointerEvents = 'none';

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zm-2-4H7v-2h10v2zm0-4H7V9h10v2z');
    svg.appendChild(path);
    return svg;
  }

  /**
   * Gère l'action de sauvegarde de la réponse de l'IA en note.
   * Recherche et clique sur le bouton natif Google dans le conteneur d'actions.
   *
   * @param {Element} actionsContainer - Conteneur d'actions de la bulle de message.
   */
  function handleSaveToNote(actionsContainer) {
    // Liste des sélecteurs possibles pour le bouton d'épinglage/sauvegarde de note natif de Google
    const nativeSaveBtn = actionsContainer.querySelector(
      'button[aria-label*="note"], button[aria-label*="Note"], button[aria-label*="sauveg"], button[aria-label*="Enregistr"], button[aria-label*="pin"], button[aria-label*="Pin"]'
    );

    if (nativeSaveBtn) {
      console.log('[MM] Clic sur le bouton d\'enregistrement de note natif de Google');
      nativeSaveBtn.click();
    } else {
      console.warn('[MM] Impossible de localiser le bouton de sauvegarde natif de Google dans ce conteneur.');
      // Fallback : Message d'erreur
      alert(t('chatExportError') || 'Impossible de sauvegarder cette réponse. Le bouton natif n\'a pas été trouvé.');
    }
  }

  /**
   * Scanne le chat pour injecter notre bouton sous chaque réponse de l'IA.
   */
  const injectExportButtons = debounce(function () {
    // Repérer les boutons thumbs-up ou thumbs-down pour identifier les conteneurs d'actions des messages de l'IA
    const thumbsButtons = document.querySelectorAll(
      'button[aria-label*="Bonne"], button[aria-label*="Good"], button[aria-label*="thumb"], button[aria-label*="Thumb"]'
    );

    thumbsButtons.forEach(btn => {
      const actionsContainer = btn.parentElement;
      if (!actionsContainer || actionsContainer.querySelector('.mm-chat-export-btn')) return;

      // Bouton personnalisé stylisé
      const exportBtn = createElement('button', {
        className: 'mm-chat-export-btn',
        title: t('chatExportButton') || 'Enregistrer dans une note',
        style: 'width: 32px; height: 32px; border: none; background: transparent; color: var(--mm-on-surface, #e3e3e3); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; padding: 0; margin-right: 4px; transition: background-color var(--mm-transition-fast), color var(--mm-transition-fast); vertical-align: middle;',
        onClick: function (e) {
          e.stopPropagation();
          handleSaveToNote(actionsContainer);
        }
      }, [createNoteIcon()]);

      // Effets de survol
      exportBtn.addEventListener('mouseenter', function () {
        exportBtn.style.backgroundColor = 'rgba(66, 133, 244, 0.08)';
        exportBtn.style.color = 'var(--mm-primary, #4285F4)';
      });
      exportBtn.addEventListener('mouseleave', function () {
        exportBtn.style.backgroundColor = 'transparent';
        exportBtn.style.color = 'var(--mm-on-surface, #e3e3e3)';
      });

      // Insérer notre bouton au début du conteneur d'actions du message
      actionsContainer.insertBefore(exportBtn, actionsContainer.firstChild);
    });
  }, 150);

  /**
   * Initialise le module d'export chat dans la vue chat.
   */
  function initChatExport() {
    if (chatObserver) return; // Déjà actif

    // Scanner et injecter immédiatement
    injectExportButtons();

    // Observer pour suivre l'apparition des nouvelles réponses de l'IA dans la zone de chat
    chatObserver = new MutationObserver(function () {
      injectExportButtons();
    });

    chatObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    console.log('[MM] Module chatExport initialisé');
  }

  /**
   * Nettoie les éléments UI injectés par le module d'export chat.
   */
  function cleanupChatExport() {
    if (chatObserver) {
      chatObserver.disconnect();
      chatObserver = null;
    }

    // Supprimer tous les boutons injectés
    document.querySelectorAll('.mm-chat-export-btn').forEach(btn => btn.remove());

    console.log('[MM] Module chatExport nettoyé');
  }

  window.MM.initChatExport = initChatExport;
  window.MM.cleanupChatExport = cleanupChatExport;
})();
