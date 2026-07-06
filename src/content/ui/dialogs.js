// dialogs.js — Module de dialogues modaux partagés
// Auteur : MTF Karukera | Licence : MPL-2.0
//
// Fournit des dialogues modaux réutilisables par tous les modules :
// - Dialogue de confirmation (suppression, actions irréversibles)
// - Dialogue de choix de format (MD/PDF)
// Design Material Design 3, fermeture via Echap, overlay semi-transparent.
// Dépendance : window.MM (utils.js chargé avant)

'use strict';

(function () {
  const { t, createElement } = window.MM;

  // ═══════════════════════════════════════════════════════════════════════
  // État interne
  // ═══════════════════════════════════════════════════════════════════════

  /** Référence à l'overlay de la modale active (null si aucune) */
  let activeOverlay = null;

  /** Handler de la touche Echap pour fermer la modale */
  let escapeHandler = null;

  // ═══════════════════════════════════════════════════════════════════════
  // Fonctions internes
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Ferme la modale active et nettoie les listeners.
   */
  function closeDialog() {
    if (activeOverlay) {
      activeOverlay.remove();
      activeOverlay = null;
    }
    if (escapeHandler) {
      document.removeEventListener('keydown', escapeHandler);
      escapeHandler = null;
    }
  }

  /**
   * Installe le handler Echap pour la modale.
   * @param {Function} [onCancel] - Callback optionnel à exécuter en plus de fermer.
   */
  function setupEscapeHandler(onCancel) {
    escapeHandler = (e) => {
      if (e.key === 'Escape') {
        closeDialog();
        if (onCancel) onCancel();
      }
    };
    document.addEventListener('keydown', escapeHandler);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // API publique
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Affiche un dialogue de confirmation avec titre, message et deux boutons.
   *
   * @param {string}   titleKey            - Clé i18n du titre.
   * @param {string}   messageKey          - Clé i18n du message.
   * @param {Array}    [messageSubstitutions=[]] - Substitutions pour le message.
   * @param {Function} onConfirm           - Callback exécuté sur confirmation.
   * @param {Function} [onCancel]          - Callback exécuté sur annulation.
   */
  function showConfirmDialog(titleKey, messageKey, messageSubstitutions, onConfirm, onCancel) {
    // Fermer toute modale précédente
    closeDialog();

    // Bouton Annuler
    const cancelBtn = createElement('button', {
      className: 'mm-btn mm-btn-secondary',
      textContent: t('dialogCancelButton'),
      onClick: () => {
        closeDialog();
        if (onCancel) onCancel();
      }
    });

    // Bouton Confirmer
    const confirmBtn = createElement('button', {
      className: 'mm-btn mm-btn-primary',
      textContent: t('dialogConfirmButton'),
      onClick: () => {
        if (confirmBtn.dataset.clicked === 'true') return;
        confirmBtn.dataset.clicked = 'true';
        closeDialog();
        if (typeof onConfirm === 'function') {
          onConfirm();
        }
      }
    });

    // Contenu de la modale
    const dialog = createElement('div', { className: 'mm-dialog' }, [
      createElement('h2', { className: 'mm-dialog-title', textContent: t(titleKey) }),
      createElement('p', { className: 'mm-dialog-message', textContent: t(messageKey, messageSubstitutions || []) }),
      createElement('div', { className: 'mm-dialog-actions' }, [cancelBtn, confirmBtn])
    ]);

    // Overlay
    activeOverlay = createElement('div', { className: 'mm-dialog-overlay' }, [dialog]);

    // Clic sur l'overlay (hors dialog) pour fermer
    activeOverlay.addEventListener('click', (e) => {
      if (e.target === activeOverlay) {
        closeDialog();
        if (onCancel) onCancel();
      }
    });

    document.body.appendChild(activeOverlay);
    setupEscapeHandler(onCancel);

    // Focus sur le bouton Annuler par défaut (sécurité)
    cancelBtn.focus();
  }

  /**
   * Affiche un dialogue de choix de format (Markdown ou PDF).
   *
   * @param {string|Function} titleOrCallback - Clé i18n du titre OU callback onChoice si pas de titre.
   * @param {Function}        [onChoice]      - Callback appelé avec 'md' ou 'pdf' (si titre fourni).
   */
  function showFormatChoiceDialog(titleOrCallback, onChoice) {
    // Fermer toute modale précédente
    closeDialog();

    // Support de la signature courte showFormatChoiceDialog(onChoice)
    let titleKey, callback;
    if (typeof titleOrCallback === 'function') {
      titleKey = 'mergeDialogTitle';
      callback = titleOrCallback;
    } else {
      titleKey = titleOrCallback || 'mergeDialogTitle';
      callback = onChoice;
    }

    // Boutons de format
    const mdBtn = createElement('button', {
      className: 'mm-btn mm-btn-secondary',
      textContent: t('mergeFormatMd'),
      onClick: () => { closeDialog(); callback('md'); }
    });

    const pdfBtn = createElement('button', {
      className: 'mm-btn mm-btn-primary',
      textContent: t('mergeFormatPdf'),
      onClick: () => { closeDialog(); callback('pdf'); }
    });

    const cancelBtn = createElement('button', {
      className: 'mm-btn mm-btn-secondary',
      textContent: t('dialogCancelButton'),
      onClick: () => closeDialog()
    });

    // Contenu
    const dialog = createElement('div', { className: 'mm-dialog' }, [
      createElement('h2', { className: 'mm-dialog-title', textContent: t(titleKey) }),
      createElement('p', { className: 'mm-dialog-message', textContent: t('mergeFormatLabel') }),
      createElement('div', { className: 'mm-dialog-actions' }, [cancelBtn, mdBtn, pdfBtn])
    ]);

    // Overlay
    activeOverlay = createElement('div', { className: 'mm-dialog-overlay' }, [dialog]);
    activeOverlay.addEventListener('click', (e) => {
      if (e.target === activeOverlay) closeDialog();
    });

    document.body.appendChild(activeOverlay);
    setupEscapeHandler();
  }

  // Exposition dans le namespace global MM
  window.MM.showConfirmDialog = showConfirmDialog;
  window.MM.showFormatChoiceDialog = showFormatChoiceDialog;
  window.MM.closeDialog = closeDialog;
})();
