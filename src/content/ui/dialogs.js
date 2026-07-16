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

  /** Référence à la modale active (null si aucune) */
  let activeDialog = null;

  // ═══════════════════════════════════════════════════════════════════════
  // Fonctions internes
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Ferme la modale active et nettoie les listeners.
   */
  function closeDialog() {
    if (activeDialog) {
      try {
        activeDialog.close();
      } catch (e) {
        // Ignorer si déjà fermé
      }
      activeDialog.remove();
      activeDialog = null;
    }
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

    const dialogTitleId = 'mm-dialog-title-' + Date.now();
    // Contenu de la modale sous forme de dialog natif
    const dialog = createElement('dialog', {
      className: 'mm-dialog',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': dialogTitleId
    }, [
      createElement('h2', { id: dialogTitleId, className: 'mm-dialog-title', textContent: t(titleKey) }),
      createElement('p', { className: 'mm-dialog-message', textContent: t(messageKey, messageSubstitutions || []) }),
      createElement('div', { className: 'mm-dialog-actions' }, [cancelBtn, confirmBtn])
    ]);

    activeDialog = dialog;

    // Fermeture native via touche Echap
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      closeDialog();
      if (onCancel) onCancel();
    });

    // Clic extérieur (sur le ::backdrop) pour fermer
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) {
        closeDialog();
        if (onCancel) onCancel();
      }
    });

    document.body.appendChild(dialog);
    dialog.showModal();

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

    const dialogTitleId = 'mm-dialog-title-' + Date.now();
    // Contenu sous forme de dialog natif
    const dialog = createElement('dialog', {
      className: 'mm-dialog',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': dialogTitleId
    }, [
      createElement('h2', { id: dialogTitleId, className: 'mm-dialog-title', textContent: t(titleKey) }),
      createElement('p', { className: 'mm-dialog-message', textContent: t('mergeFormatLabel') }),
      createElement('div', { className: 'mm-dialog-actions' }, [cancelBtn, mdBtn, pdfBtn])
    ]);

    activeDialog = dialog;

    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      closeDialog();
    });

    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) closeDialog();
    });

    document.body.appendChild(dialog);
    dialog.showModal();

    cancelBtn.focus();
  }

  /**
   * Affiche un dialogue d'alerte simple non bloquant (remplace alert()).
   *
   * @param {string}   titleKey            - Clé i18n du titre.
   * @param {string}   messageKey          - Clé i18n du message.
   * @param {Array}    [messageSubstitutions=[]] - Substitutions pour le message.
   * @param {Function} [onClose]           - Callback exécuté à la fermeture.
   */
  function showAlertDialog(titleKey, messageKey, messageSubstitutions, onClose) {
    closeDialog();

    const okBtn = createElement('button', {
      className: 'mm-btn mm-btn-primary',
      textContent: t('dialogConfirmButton') || 'OK',
      onClick: () => {
        closeDialog();
        if (onClose) onClose();
      }
    });

    const dialogTitleId = 'mm-dialog-title-' + Date.now();
    const dialog = createElement('dialog', {
      className: 'mm-dialog mm-dialog-alert',
      role: 'alertdialog',
      'aria-modal': 'true',
      'aria-labelledby': dialogTitleId
    }, [
      createElement('h2', { id: dialogTitleId, className: 'mm-dialog-title', textContent: t(titleKey) || titleKey }),
      createElement('p', { className: 'mm-dialog-message', textContent: t(messageKey, messageSubstitutions || []) || messageKey }),
      createElement('div', { className: 'mm-dialog-actions' }, [okBtn])
    ]);

    activeDialog = dialog;

    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      closeDialog();
      if (onClose) onClose();
    });

    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) {
        closeDialog();
        if (onClose) onClose();
      }
    });

    document.body.appendChild(dialog);
    dialog.showModal();

    okBtn.focus();
  }

  // Exposition dans le namespace global MM
  window.MM.showConfirmDialog = showConfirmDialog;
  window.MM.showFormatChoiceDialog = showFormatChoiceDialog;
  window.MM.showAlertDialog = showAlertDialog;
  window.MM.closeDialog = closeDialog;
})();

