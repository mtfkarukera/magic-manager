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

  /** Référence à l'élément qui avait le focus avant l'ouverture de la modale */
  let lastFocusedElement = null;

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

      // Restauration du focus clavier sur l'élément déclencheur
      if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
        try {
          lastFocusedElement.focus();
        } catch (err) {
          // Ignorer si l'élément n'est plus disponible
        }
        lastFocusedElement = null;
      }
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
    // Mémoriser l'élément déclencheur
    lastFocusedElement = document.activeElement;

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
   * Affiche un dialogue de choix de format (Markdown, PDF Simple ou PDF Structuré).
   * Utilisé pour l'export individuel.
   *
   * @param {string|Function} titleOrCallback - Clé i18n du titre OU callback onChoice si pas de titre.
   * @param {Function}        [onChoice]      - Callback appelé avec 'md', 'pdf-simple' ou 'pdf-structured' (si titre fourni).
   */
  function showFormatChoiceDialog(titleOrCallback, onChoice) {
    let callback = typeof titleOrCallback === 'function' ? titleOrCallback : onChoice;
    showExportFormatDialog(callback);
  }

  function showExportDialog(titleOrCallback, onChoice) {
    let callback = typeof titleOrCallback === 'function' ? titleOrCallback : onChoice;
    showExportFormatDialog(callback);
  }

  /**
   * Affiche un dialogue riche pour le choix de format en lot (export batch).
   * Présente 3 options avec boutons radio et descriptions détaillées.
   *
   * @param {Function} callback - Appelé avec le format choisi ('md', 'pdf-simple', 'pdf-structured')
   */
  function showExportFormatDialog(callback) {
    lastFocusedElement = document.activeElement;
    closeDialog();

    let selectedFormat = 'md-riche'; // Format par défaut

    const formats = [
      { id: 'md-riche', title: 'exportFormatMarkdownRiche', desc: 'exportFormatMarkdownRicheDesc' },
      { id: 'md-simple', title: 'exportFormatMarkdownSimple', desc: 'exportFormatMarkdownSimpleDesc' },
      { id: 'pdf-riche', title: 'exportFormatPdfRiche', desc: 'exportFormatPdfRicheDesc' },
      { id: 'pdf-simple', title: 'exportFormatPdfSimple', desc: 'exportFormatPdfSimpleDesc' }
    ];

    const optionContainer = createElement('div', {
      className: 'mm-export-options-list',
      role: 'radiogroup',
      'aria-label': t('exportFormatLabel') || 'Formats d\'exportation'
    });

    // Générer chaque élément d'option avec radio
    const optionEls = formats.map(f => {
      const radio = createElement('input', {
        type: 'radio',
        name: 'mm-export-format',
        id: `mm-format-${f.id}`,
        value: f.id,
        checked: f.id === selectedFormat,
        onChange: () => {
          selectedFormat = f.id;
          updateSelectionStyles();
        }
      });

      const label = createElement('label', {
        htmlFor: `mm-format-${f.id}`,
        className: 'mm-export-format-label'
      }, [
        createElement('span', { className: 'mm-export-format-title', textContent: t(f.title) }),
        createElement('span', { className: 'mm-export-format-desc', textContent: t(f.desc) })
      ]);

      const optionWrapper = createElement('div', {
        className: `mm-export-format-option${f.id === selectedFormat ? ' selected' : ''}`,
        onClick: () => {
          selectedFormat = f.id;
          updateSelectionStyles();
        }
      }, [radio, label]);

      return { id: f.id, el: optionWrapper, radio };
    });

    optionEls.forEach(opt => optionContainer.appendChild(opt.el));

    function updateSelectionStyles() {
      optionEls.forEach(opt => {
        if (opt.id === selectedFormat) {
          opt.el.classList.add('selected');
          opt.radio.checked = true;
        } else {
          opt.el.classList.remove('selected');
        }
      });
    }

    const cancelBtn = createElement('button', {
      className: 'mm-btn mm-btn-secondary',
      textContent: t('dialogCancelButton'),
      onClick: () => closeDialog()
    });

    const actionBtn = createElement('button', {
      className: 'mm-btn mm-btn-primary',
      textContent: t('exportBtnLabel') || 'Exporter',
      onClick: () => {
        closeDialog();
        callback(selectedFormat);
      }
    });

    const dialogTitleId = 'mm-dialog-title-' + Date.now();
    const dialog = createElement('dialog', {
      className: 'mm-dialog mm-export-dialog',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': dialogTitleId
    }, [
      createElement('h2', { id: dialogTitleId, className: 'mm-dialog-title', textContent: t('exportFormatDialogTitle') || 'Format d\'exportation' }),
      optionContainer,
      createElement('div', { className: 'mm-dialog-warning', textContent: t('truncationWarning') }),
      createElement('div', { className: 'mm-dialog-actions' }, [cancelBtn, actionBtn])
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

    actionBtn.focus();
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
    lastFocusedElement = document.activeElement;
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

  /**
   * Affiche un dialogue de saisie textuelle non bloquant (remplace prompt()).
   *
   * @param {string}   titleKey            - Clé i18n du titre (ou texte brut).
   * @param {string}   placeholderKey      - Clé i18n du placeholder (ou texte brut).
   * @param {Function} onSubmit            - Callback appelé avec la valeur saisie non vide.
   * @param {Function} [onCancel]          - Callback appelé sur annulation.
   */
  function showPromptDialog(titleKey, placeholderKey, onSubmit, onCancel) {
    lastFocusedElement = document.activeElement;
    closeDialog();

    const inputEl = createElement('input', {
      type: 'text',
      className: 'mm-dialog-input',
      placeholder: t(placeholderKey) || placeholderKey,
      'aria-label': t(placeholderKey) || placeholderKey
    });

    const cancelBtn = createElement('button', {
      className: 'mm-btn mm-btn-secondary',
      textContent: t('dialogCancelButton') || 'Annuler',
      onClick: () => {
        closeDialog();
        if (onCancel) onCancel();
      }
    });

    const confirmBtn = createElement('button', {
      className: 'mm-btn mm-btn-primary',
      textContent: t('dialogConfirmButton') || 'OK',
      onClick: () => {
        const val = inputEl.value.trim();
        if (!val) return;
        closeDialog();
        if (typeof onSubmit === 'function') onSubmit(val);
      }
    });

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        confirmBtn.click();
      }
    });

    const dialogTitleId = 'mm-dialog-title-' + Date.now();
    const dialog = createElement('dialog', {
      className: 'mm-dialog mm-dialog-prompt',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': dialogTitleId
    }, [
      createElement('h2', { id: dialogTitleId, className: 'mm-dialog-title', textContent: t(titleKey) || titleKey }),
      createElement('div', { className: 'mm-dialog-field' }, [inputEl]),
      createElement('div', { className: 'mm-dialog-actions' }, [cancelBtn, confirmBtn])
    ]);

    activeDialog = dialog;

    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      closeDialog();
      if (onCancel) onCancel();
    });

    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) {
        closeDialog();
        if (onCancel) onCancel();
      }
    });

    document.body.appendChild(dialog);
    dialog.showModal();

    inputEl.focus();
  }

  // Exposition dans le namespace global MM
  window.MM.showConfirmDialog = showConfirmDialog;
  window.MM.showFormatChoiceDialog = showFormatChoiceDialog;
  window.MM.showExportFormatDialog = showExportFormatDialog;
  window.MM.showAlertDialog = showAlertDialog;
  window.MM.showPromptDialog = showPromptDialog;
  window.MM.closeDialog = closeDialog;
})();

