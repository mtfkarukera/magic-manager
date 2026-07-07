// chatexport.js — Export de toute la conversation chat vers une note NotebookLM (F6)
// Auteur : MTF Karukera | Licence : MPL-2.0
// Dépendances : window.MM (utils.js + rpcclient.js chargés avant)
//
// Fonctionnement :
//  - Injecte UN SEUL bouton dans l'en-tête du panneau Discussion
//  - En cliquant, scrape l'intégralité du thread (toutes les questions & réponses)
//  - Formate le contenu en Markdown lisible
//  - Crée une véritable NOTE dans le Studio NotebookLM via le DOM natif

'use strict';

(function () {
  const { t, createElement, debounce } = window.MM;

  // Référence au bouton injecté (un seul à la fois)
  let exportChatBtn = null;
  // Observer pour surveiller l'apparition du panneau Discussion
  let chatHeaderObserver = null;

  // ═══════════════════════════════════════════════════════════════════════
  // 1. SCRAPER DU THREAD DE CONVERSATION — Approche robuste
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Extrait le texte propre d'un élément en ignorant les balises UI
   * (boutons, icônes, nos propres éléments MM).
   * @param {Element} el - Élément racine à extraire.
   * @returns {string} Texte brut nettoyé.
   */
  function extractCleanText(el) {
    // Cloner pour ne pas modifier le DOM réel
    const clone = el.cloneNode(true);

    // Supprimer les éléments interactifs et nos propres injections
    const toRemove = clone.querySelectorAll(
      'button, svg, [class*="action"], [class*="feedback"], ' +
      '[class*="copy-btn"], [class*="thumb"], ' +
      '.mm-code-block-header, .mm-code-block-copy-btn, .mm-chat-export-btn'
    );
    toRemove.forEach(function (node) { node.remove(); });

    // Récupérer le texte en préservant les sauts de ligne naturels
    const text = clone.innerText || clone.textContent || '';
    // Nettoyer les lignes vides excessives (max 2 sauts consécutifs)
    return text.replace(/\n{3,}/g, '\n\n').trim();
  }

  /**
   * Stratégie de détection du rôle d'un tour de chat.
   * NotebookLM alterne systématiquement : user → model → user → model…
   * On s'appuie d'abord sur les attributs, puis sur l'alternance.
   *
   * @param {Element} el - Élément représentant un tour de conversation.
   * @param {number} index - Position du tour dans la liste (0-indexé).
   * @returns {'user'|'ai'} Le rôle estimé de ce tour.
   */
  function detectRole(el, index) {
    // 1. Vérifier les attributs data-* (les plus fiables)
    const dataRole = el.getAttribute('data-turn-role') ||
                     el.getAttribute('data-role') ||
                     el.getAttribute('data-sender');
    if (dataRole) {
      const r = dataRole.toLowerCase();
      if (r === 'user' || r === 'human') return 'user';
      if (r === 'model' || r === 'assistant' || r === 'ai') return 'ai';
    }

    // 2. Vérifier les classes CSS contenant des mots-clés de rôle
    const cls = el.className || '';
    if (/user.?turn|human.?turn|user.?message/i.test(cls)) return 'user';
    if (/model.?turn|ai.?turn|assistant.?turn|response/i.test(cls)) return 'ai';

    // 3. Vérifier le tagName (NotebookLM utilise parfois des web components)
    const tag = el.tagName.toLowerCase();
    if (tag.includes('user') || tag.includes('human')) return 'user';
    if (tag.includes('model') || tag.includes('ai') || tag.includes('assistant')) return 'ai';

    // 4. Fallback : alternance (le chat commence toujours par l'utilisateur)
    return index % 2 === 0 ? 'user' : 'ai';
  }

  /**
   * Collecte tous les tours de conversation dans l'ordre DOM.
   * Stratégie : on cherche les éléments "racines" de chaque tour,
   * en évitant de retourner à la fois un parent et son enfant.
   *
   * @returns {Array<{role: string, text: string}>} Tours ordonnés.
   */
  function collectConversationTurns() {
    // Liste des sélecteurs de "conteneurs de tour" — du plus précis au plus générique.
    // On veut des éléments FRÈRES (siblings) au même niveau, pas parent+enfant.
    const TURN_CONTAINER_SELECTORS = [
      // Web components natifs NotebookLM (les plus stables)
      'chat-message',
      'conversation-turn',
      'model-response',
      // Sélecteurs structurels par classes
      '[class*="user-turn"]',
      '[class*="model-turn"]',
      '[class*="human-turn"]',
      '[class*="ai-turn"]',
      '[class*="chat-turn"]',
      '[class*="message-bubble"]',
      '[class*="chat-scroll-card"]'
    ];

    let turns = [];

    // Essayer chaque sélecteur et garder le premier qui donne des résultats
    for (const sel of TURN_CONTAINER_SELECTORS) {
      const found = Array.from(document.querySelectorAll(sel));
      if (found.length > 0) {
        console.log(`[MM] ChatExport : ${found.length} tour(s) trouvé(s) avec "${sel}"`);
        turns = found;
        break;
      }
    }

    // Si aucun sélecteur direct ne fonctionne, tenter via Shadow DOM
    if (turns.length === 0) {
      for (const sel of TURN_CONTAINER_SELECTORS) {
        const found = window.MM.findElementsInShadows(sel);
        if (found.length > 0) {
          console.log(`[MM] ChatExport : ${found.length} tour(s) trouvé(s) via Shadow DOM avec "${sel}"`);
          turns = found;
          break;
        }
      }
    }

    if (turns.length === 0) {
      console.warn('[MM] ChatExport : aucun tour de conversation trouvé.');
      return [];
    }

    // ── Déduplication : éliminer les éléments dont un ANCÊTRE est aussi dans la liste ──
    // Cela évite de retourner à la fois le parent et l'enfant.
    const turnSet = new Set(turns);
    const deduped = turns.filter(function (el) {
      let node = el.parentElement;
      while (node) {
        if (turnSet.has(node)) return false; // Un ancêtre est déjà dans la liste → doublon
        node = node.parentElement;
      }
      return true;
    });

    console.log(`[MM] ChatExport : ${deduped.length} tour(s) uniques après déduplication.`);

    // ── Trier dans l'ordre d'apparition dans le document ──
    deduped.sort(function (a, b) {
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    // ── Extraire le texte et attribuer les rôles ──
    return deduped.map(function (el, index) {
      return {
        role: detectRole(el, index),
        text: extractCleanText(el)
      };
    }).filter(function (turn) {
      return turn.text.length > 0;
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2. FORMATEUR MARKDOWN
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Formate la liste des tours de conversation en un document Markdown lisible.
   * @param {Array<{role: string, text: string}>} turns - Tours de la conversation.
   * @returns {string} Contenu Markdown formaté.
   */
  function formatAsMarkdown(turns) {
    const now = new Date();
    const dateStr = now.toLocaleDateString('fr-FR', {
      day: '2-digit', month: 'long', year: 'numeric'
    });
    const timeStr = now.toLocaleTimeString('fr-FR', {
      hour: '2-digit', minute: '2-digit'
    });

    const lines = [
      `# Conversation NotebookLM`,
      ``,
      `> Exporté le ${dateStr} à ${timeStr} par Magic Manager`,
      ``
    ];

    turns.forEach(function (turn) {
      let roleLabel;
      if (turn.role === 'user') {
        roleLabel = '## 🙋 Vous';
      } else {
        roleLabel = '## 🤖 NotebookLM';
      }

      lines.push(roleLabel);
      lines.push('');
      lines.push(turn.text);
      lines.push('');
      lines.push('---');
      lines.push('');
    });

    return lines.join('\n');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3. CRÉATION DE NOTE via le DOM natif (Studio)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Injecte du texte dans un textarea en passant par React/Angular setter
   * (car NotebookLM utilise un framework qui ignore la modification directe de .value).
   * @param {HTMLTextAreaElement|HTMLElement} input - L'élément de saisie.
   * @param {string} text - Le texte à injecter.
   */
  function setNativeValue(input, text) {
    // Utilisation du setter natif pour contourner le framework
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    );
    if (nativeInputValueSetter && nativeInputValueSetter.set) {
      nativeInputValueSetter.set.call(input, text);
    } else {
      input.value = text;
    }
    // Déclencher les événements pour notifier le framework
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * Sélecteurs candidats pour le bouton "Ajouter une note" natif de NotebookLM.
   * Ce bouton est dans le panneau Studio (à droite).
   */
  const ADD_NOTE_BUTTON_SELECTORS = [
    'button[aria-label*="note" i]',
    'button[aria-label*="Note" i]',
    'button[aria-label*="Ajouter" i]',
    'button[aria-label*="Add note" i]',
    'button[data-action*="note"]',
    '[class*="add-note"]',
    '[class*="create-note"]',
    // Le bouton visible "Ajouter une note" avec son icône en bas à droite du Studio
    '.studio-panel button[aria-label]',
    '[class*="studio"] button[aria-label]'
  ];

  /**
   * Sélecteurs candidats pour l'éditeur de saisie de note une fois ouvert.
   * NotebookLM peut utiliser un <textarea> OU un éditeur contenteditable (texte riche).
   */
  const NOTE_INPUT_SELECTORS = [
    // Éditeurs contenteditable (format riche, probable dans NotebookLM)
    '[contenteditable="true"][aria-label*="note" i]',
    '[contenteditable="true"][aria-multiline="true"]',
    '[contenteditable="true"][role="textbox"]',
    '[role="textbox"][aria-label*="note" i]',
    '[role="textbox"]',
    '[contenteditable="true"]',
    // <textarea> classique (fallback)
    'textarea[aria-label*="note" i]',
    'textarea[placeholder*="note" i]',
    'textarea:not([class*="search"]):not([class*="query"])',
    'textarea'
  ];

  /**
   * Crée une note dans le Studio NotebookLM via le DOM natif.
   * Séquence : clic sur "Ajouter une note" → attente du textarea → injection du texte → validation.
   * @param {string} content - Contenu Markdown à injecter dans la note.
   * @returns {Promise<void>}
   */
  async function createNoteViaDom(content) {
    // 1. Trouver le bouton "Ajouter une note"
    let addNoteBtn = null;
    for (const sel of ADD_NOTE_BUTTON_SELECTORS) {
      const candidates = Array.from(document.querySelectorAll(sel));
      // Filtrer pour n'avoir que les boutons dans le panneau Studio
      const studioBtn = candidates.find(function (btn) {
        return window.MM.isInsideSelector(
          btn,
          '.studio-panel, [class*="studio-panel"], [class*="studio"]'
        );
      });
      if (studioBtn) {
        addNoteBtn = studioBtn;
        break;
      }
      // Si on n'a pas trouvé dans le Studio, prendre le premier disponible
      if (candidates.length > 0 && !addNoteBtn) {
        addNoteBtn = candidates[0];
      }
    }

    // Fallback Shadow DOM
    if (!addNoteBtn) {
      const shadowCandidates = window.MM.findElementsInShadows(
        'button[aria-label*="note" i], button[aria-label*="Note" i]'
      );
      addNoteBtn = shadowCandidates[0] || null;
    }

    if (!addNoteBtn) {
      throw new Error('[MM] ChatExport : bouton "Ajouter une note" introuvable dans le Studio.');
    }

    console.log('[MM] ChatExport : clic sur le bouton "Ajouter une note". Bouton :', addNoteBtn.outerHTML.slice(0, 120));
    addNoteBtn.click();

    // 2. Attendre que l'éditeur de saisie apparaisse via MutationObserver (max 5 secondes)
    // Délai minimal de 50ms pour laisser le framework déclencher l'animation d'ouverture
    await new Promise(function (resolve) { setTimeout(resolve, 50); });

    const noteInput = await waitForElement(NOTE_INPUT_SELECTORS, 5000);
    if (!noteInput) {
      // Log diagnostic : lister tous les éléments actifs dans le document pour aider au debug
      const allEditable = document.querySelectorAll('[contenteditable], textarea, [role="textbox"]');
      console.warn('[MM] ChatExport : éditeur de note introuvable. Éléments éditables présents :', allEditable.length);
      allEditable.forEach(function (el) {
        console.warn('[MM] ChatExport :  →', el.tagName, el.getAttribute('aria-label'), el.className.slice(0, 60));
      });
      throw new Error('[MM] ChatExport : l\'éditeur de note n\'est pas apparu après le clic.');
    }

    console.log('[MM] ChatExport : éditeur de note détecté :', noteInput.tagName, noteInput.getAttribute('role'), noteInput.getAttribute('aria-label'));

    // 3. Injecter le contenu selon le type d'éditeur
    if (noteInput.tagName === 'TEXTAREA' || noteInput.tagName === 'INPUT') {
      // <textarea> standard : utiliser le setter natif React/Angular
      setNativeValue(noteInput, content);
    } else if (noteInput.isContentEditable) {
      // Éditeur contenteditable : injecter via innerText + événement 'input'
      noteInput.focus();
      // Effacer le contenu existant (placeholder)
      noteInput.innerHTML = '';
      // Insérer le texte brut ligne par ligne via document.execCommand (compatible CSP)
      // execCommand est déprécié mais reste le seul moyen fiable dans un contenteditable
      document.execCommand('insertText', false, content);
      // Fallback si execCommand ne fonctionne pas
      if (!noteInput.textContent || noteInput.textContent.trim() === '') {
        noteInput.textContent = content;
        noteInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    // 4. Donner le focus et laisser le framework traiter l'input
    noteInput.focus();
    await new Promise(function (resolve) { setTimeout(resolve, 300); });

    // 5. Enregistrer la note — chercher le bouton de validation qui est apparu
    const SAVE_SELECTORS = [
      'button[aria-label*="Enregistr" i]',
      'button[aria-label*="Sauvegarder" i]',
      'button[aria-label*="Save" i]',
      'button[aria-label*="Confirmer" i]',
      'button[aria-label*="Done" i]',
      'button[aria-label*="Terminer" i]',
      'button[type="submit"]'
    ];

    let saveBtn = null;
    for (const sel of SAVE_SELECTORS) {
      const found = Array.from(document.querySelectorAll(sel)).filter(function (btn) {
        return !btn.classList.contains('mm-chat-export-btn');
      });
      if (found.length > 0) {
        saveBtn = found[0];
        console.log('[MM] ChatExport : bouton de validation trouvé :', saveBtn.outerHTML.slice(0, 100));
        break;
      }
    }

    if (saveBtn) {
      console.log('[MM] ChatExport : clic sur le bouton de validation de la note.');
      saveBtn.click();
    } else {
      // Fallback : Ctrl+Enter ou Échap selon le comportement de NotebookLM
      console.log('[MM] ChatExport : bouton de validation introuvable, tentative Ctrl+Enter.');
      noteInput.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', ctrlKey: true, bubbles: true
      }));
      // Deuxième fallback : clic en dehors de l'éditeur pour déclencher l'auto-save
      await new Promise(function (resolve) { setTimeout(resolve, 200); });
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    }

    console.log('[MM] ChatExport : note créée avec succès.');
  }

  /**
   * Attend l'apparition d'un élément correspondant à l'un des sélecteurs.
   * Utilise un MutationObserver (fiable pour les éléments apparus de façon asynchrone)
   * plutôt que requestAnimationFrame.
   * @param {string[]} selectors - Liste de sélecteurs CSS à tester.
   * @param {number} timeoutMs - Délai maximum en millisecondes.
   * @returns {Promise<Element|null>} L'élément trouvé ou null si timeout.
   */
  function waitForElement(selectors, timeoutMs) {
    return new Promise(function (resolve) {

      // Vérifier si un élément correspond déjà dans le DOM actuel
      function findNow() {
        for (const sel of selectors) {
          try {
            const el = document.querySelector(sel);
            if (el) return el;
          } catch (e) { /* sélecteur invalide, on passe */ }
        }
        return null;
      }

      const existing = findNow();
      if (existing) {
        resolve(existing);
        return;
      }

      // Sinon, observer les mutations du DOM jusqu'au timeout
      const observer = new MutationObserver(function () {
        const found = findNow();
        if (found) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(found);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['contenteditable', 'role', 'aria-label']
      });

      const timer = setTimeout(function () {
        observer.disconnect();
        resolve(null);
      }, timeoutMs);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 4. ACTION PRINCIPALE D'EXPORT
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Exporte toute la conversation en une note dans le Studio NotebookLM.
   * Gère les états du bouton (chargement, succès, erreur).
   */
  async function handleExportChat() {
    if (!exportChatBtn) return;

    // Empêcher les doubles-clics pendant l'export
    exportChatBtn.disabled = true;
    showButtonFeedback('loading');

    try {
      // Collecter les tours de conversation
      const turns = collectConversationTurns();

      if (turns.length === 0) {
        console.warn('[MM] ChatExport : aucun tour de conversation trouvé à exporter.');
        showButtonFeedback('error');
        return;
      }

      console.log(`[MM] ChatExport : ${turns.length} tour(s) collecté(s).`);

      // Formater en Markdown
      const markdownContent = formatAsMarkdown(turns);

      // Créer la note via le DOM natif du Studio
      await createNoteViaDom(markdownContent);

      showButtonFeedback('success');

    } catch (err) {
      console.error('[MM] ChatExport : erreur lors de la création de la note :', err);
      showButtonFeedback('error');
    } finally {
      // Réactiver le bouton après un délai
      setTimeout(function () {
        if (exportChatBtn) {
          exportChatBtn.disabled = false;
          resetButtonIcon();
        }
      }, 2500);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 5. GESTION VISUELLE DU BOUTON
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Crée l'icône SVG du bouton d'export (bulle de chat avec flèche d'export).
   * @returns {SVGElement}
   */
  function createExportIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('fill', 'currentColor');
    svg.style.display = 'block';
    svg.style.pointerEvents = 'none';
    svg.style.flexShrink = '0';

    // Icône : bulle de chat avec flèche vers le bas (sauvegarde)
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d',
      'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z' +
      'M12 17l-5-5h3V8h4v4h3l-5 5z'
    );
    svg.appendChild(path);
    return svg;
  }

  /**
   * Affiche un retour visuel sur le bouton selon l'état de l'opération.
   * @param {'loading'|'success'|'error'} state - État à afficher.
   */
  function showButtonFeedback(state) {
    if (!exportChatBtn) return;

    exportChatBtn.innerHTML = '';

    if (state === 'loading') {
      const spinner = document.createElement('span');
      spinner.style.cssText = [
        'width: 14px', 'height: 14px',
        'border: 2px solid currentColor',
        'border-top-color: transparent',
        'border-radius: 50%',
        'display: inline-block',
        'animation: mm-spin 0.7s linear infinite'
      ].join('; ');
      exportChatBtn.appendChild(spinner);
      exportChatBtn.title = 'Export en cours…';

    } else if (state === 'success') {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('width', '18');
      svg.setAttribute('height', '18');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', '#4CAF50');
      svg.setAttribute('stroke-width', '2.5');
      const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      pl.setAttribute('points', '4 12 9 17 20 6');
      svg.appendChild(pl);
      exportChatBtn.appendChild(svg);
      exportChatBtn.title = 'Note créée !';

    } else if (state === 'error') {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('width', '18');
      svg.setAttribute('height', '18');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', '#FF7043');
      svg.setAttribute('stroke-width', '2.5');
      const l1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      l1.setAttribute('x1', '6'); l1.setAttribute('y1', '6');
      l1.setAttribute('x2', '18'); l1.setAttribute('y2', '18');
      const l2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      l2.setAttribute('x1', '18'); l2.setAttribute('y1', '6');
      l2.setAttribute('x2', '6'); l2.setAttribute('y2', '18');
      svg.appendChild(l1);
      svg.appendChild(l2);
      exportChatBtn.appendChild(svg);
      exportChatBtn.title = 'Erreur — voir la console pour le détail';
    }
  }

  /**
   * Remet l'icône d'origine sur le bouton après un retour visuel.
   */
  function resetButtonIcon() {
    if (!exportChatBtn) return;
    exportChatBtn.innerHTML = '';
    exportChatBtn.appendChild(createExportIcon());
    exportChatBtn.title = t('chatExportButton') || 'Exporter toute la conversation en note';
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 6. INJECTION DU BOUTON DANS L'EN-TÊTE DU PANNEAU DISCUSSION
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Ajoute la règle CSS d'animation du spinner dans le document (une seule fois).
   */
  function ensureSpinnerCss() {
    if (document.getElementById('mm-chatexport-css')) return;
    const style = document.createElement('style');
    style.id = 'mm-chatexport-css';
    style.textContent = '@keyframes mm-spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
  }

  /**
   * Sélecteurs candidats pour l'en-tête du panneau Discussion.
   */
  const CHAT_HEADER_SELECTORS = [
    'section.chat-panel [class*="header"]',
    '[class*="chat-header"]',
    '[class*="conversation-header"]',
    '[class*="chat-toolbar"]',
    '[class*="chat-actions"]'
  ];

  /**
   * Tente de trouver l'en-tête du panneau Discussion.
   * @returns {Element|null}
   */
  function findChatPanelHeader() {
    for (const sel of CHAT_HEADER_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return window.MM.findElementsInShadows(
      CHAT_HEADER_SELECTORS.join(', ')
    )[0] || null;
  }

  /**
   * Injecte le bouton d'export dans l'en-tête du panneau Discussion.
   */
  const tryInjectButton = debounce(function () {
    // Bouton déjà présent et dans le DOM → rien à faire
    if (exportChatBtn && document.contains(exportChatBtn)) return;

    // Nettoyer une référence orpheline
    if (exportChatBtn) exportChatBtn = null;

    const header = findChatPanelHeader();
    if (!header) return;

    ensureSpinnerCss();

    exportChatBtn = createElement('button', {
      className: 'mm-chat-export-btn',
      title: t('chatExportButton') || 'Exporter toute la conversation en note',
      style: [
        'display: inline-flex',
        'align-items: center',
        'justify-content: center',
        'width: 32px',
        'height: 32px',
        'border: none',
        'background: transparent',
        'color: var(--mm-on-surface, #c4c7c5)',
        'cursor: pointer',
        'border-radius: 50%',
        'padding: 0',
        'margin: 0 2px',
        'transition: background-color 0.15s ease, color 0.15s ease',
        'flex-shrink: 0'
      ].join('; '),
      onClick: function (e) {
        e.stopPropagation();
        handleExportChat();
      }
    }, [createExportIcon()]);

    exportChatBtn.addEventListener('mouseenter', function () {
      if (!exportChatBtn.disabled) {
        exportChatBtn.style.backgroundColor = 'rgba(197, 202, 233, 0.08)';
        exportChatBtn.style.color = 'var(--mm-primary, #c5cae9)';
      }
    });
    exportChatBtn.addEventListener('mouseleave', function () {
      exportChatBtn.style.backgroundColor = 'transparent';
      exportChatBtn.style.color = 'var(--mm-on-surface, #c4c7c5)';
    });

    // Insérer au début de l'en-tête (avant les icônes natives de Google)
    header.insertBefore(exportChatBtn, header.firstChild);
    console.log('[MM] ChatExport : bouton injecté dans l\'en-tête du panneau Discussion.');
  }, 300);

  // ═══════════════════════════════════════════════════════════════════════
  // 7. INITIALISATION ET NETTOYAGE
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Initialise le module d'export chat.
   */
  function initChatExport() {
    if (chatHeaderObserver) return;

    tryInjectButton();

    chatHeaderObserver = new MutationObserver(function () {
      tryInjectButton();
    });

    chatHeaderObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    console.log('[MM] Module chatExport initialisé');
  }

  /**
   * Nettoie les éléments UI et stoppe l'observation du DOM.
   */
  function cleanupChatExport() {
    if (chatHeaderObserver) {
      chatHeaderObserver.disconnect();
      chatHeaderObserver = null;
    }
    document.querySelectorAll('.mm-chat-export-btn').forEach(function (btn) {
      btn.remove();
    });
    exportChatBtn = null;
    console.log('[MM] Module chatExport nettoyé');
  }

  window.MM.initChatExport = initChatExport;
  window.MM.cleanupChatExport = cleanupChatExport;
})();
