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
  const { t, createElement } = window.MM;

  // Référence au bouton injecté (un seul à la fois)
  let exportChatBtn = null;
  // Stockage des timers d'initialisation pour éviter les fuites de ressources
  let initTimers = [];

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
   * Obtient le parent d'un élément, y compris à travers les Shadow Roots.
   * @param {Element} el - Élément enfant.
   * @returns {Element|null} Le parent ou l'hôte (host) du Shadow Root.
   */
  function getParent(el) {
    if (!el) return null;
    return el.parentElement || (el.parentNode && el.parentNode.host) || el.parentNode || null;
  }

  /**
   * Stratégie de détection du rôle d'un tour de chat.
   * NotebookLM alterne systématiquement : user → model → user → model…
   * Mais on renforce avec des indices forts (ex: présence de boutons de feedback ou d'épinglage AI).
   *
   * @param {Element} el - Élément représentant un tour de conversation.
   * @param {number} index - Position du tour dans la liste (0-indexé).
   * @returns {'user'|'ai'} Le rôle estimé de ce tour.
   */
  function detectRole(el, index) {
    // 1. Si le bloc contient des boutons spécifiques à l'IA (feedback, copier, épingler un message individuel)
    // C'est un indicateur absolu d'un message IA.
    const hasAiIndicators = window.MM.findElementsInShadows(
      'button[aria-label*="épingl" i], button[aria-label*="note" i], button[aria-label*="Note" i], button[aria-label*="copi" i], button[aria-label*="copy" i], button[aria-label*="thumb" i], button[aria-label*="pouce" i]',
      el
    ).length > 0;

    if (hasAiIndicators) {
      return 'ai';
    }

    // 2. Vérifier les attributs data-*
    const dataRole = el.getAttribute('data-turn-role') ||
                     el.getAttribute('data-role') ||
                     el.getAttribute('data-sender');
    if (dataRole) {
      const r = dataRole.toLowerCase();
      if (r === 'user' || r === 'human') return 'user';
      if (r === 'model' || r === 'assistant' || r === 'ai') return 'ai';
    }

    // 3. Vérifier les classes CSS
    const cls = el.className || '';
    if (/user.?turn|human.?turn|user.?message/i.test(cls)) return 'user';
    if (/model.?turn|ai.?turn|assistant.?turn|response/i.test(cls)) return 'ai';

    // 4. Vérifier le tagName
    const tag = el.tagName.toLowerCase();
    if (tag.includes('user') || tag.includes('human')) return 'user';
    if (tag.includes('model') || tag.includes('ai') || tag.includes('assistant')) return 'ai';

    // 5. Fallback : alternance
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

    // ── Déduplication robuste traversant le Shadow DOM ──
    const turnSet = new Set(turns);
    const deduped = turns.filter(function (el) {
      let node = getParent(el);
      while (node) {
        if (turnSet.has(node)) return false; // Un ancêtre est dans la liste → doublon parent/enfant
        node = getParent(node);
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
    'button[class*="add-note"]',
    'button[class*="create-note"]',
    '.add-note-button-container button',
    // Le bouton visible "Ajouter une note" avec son icône en bas à droite du Studio
    '.studio-panel button[aria-label]',
    '[class*="studio"] button[aria-label]',
    '.studio-panel button',
    '[class*="studio"] button'
  ];

  /**
   * Sélecteurs candidats pour l'éditeur de saisie de note une fois ouvert.
   * On veut cibler spécifiquement les éléments modifiables du Studio.
   */
  const NOTE_INPUT_SELECTORS = [
    '[contenteditable="true"]',
    '[role="textbox"]',
    'textarea'
  ];

  function getActiveNotebookName() {
    const titleLabel = document.querySelector('.title-label-inner');
    if (titleLabel) return titleLabel.textContent.trim();
    const titleInput = document.querySelector('.title-input');
    if (titleInput) return titleInput.value.trim();
    return 'Notebook';
  }

  async function createNoteViaRpc(notebookId, title, content) {
    if (!notebookId) {
      throw new Error('[MM] ChatExport : impossible de détecter l\'identifiant du notebook dans l\'URL.');
    }

    console.log(`[MM] ChatExport : envoi de la création RPC direct pour "${title}"`);
    await window.MM.rpc.createNoteRpc(notebookId, title, content);
    console.log('[MM] ChatExport : note créée avec succès via RPC direct.');
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

    // Capturer notebookId dès le clic initial de façon synchrone
    const notebookId = window.MM.getActiveNotebookId();
    if (!notebookId) {
      console.error('[MM] ChatExport : notebookId absent au clic');
      showButtonFeedback('error');
      return;
    }

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

      // Générer le titre de la note incluant le nom du carnet
      const dateStr = new Date().toLocaleDateString('fr-FR', {
        day: '2-digit', month: '2-digit', year: 'numeric'
      });
      const notebookName = getActiveNotebookName();
      const noteTitle = `Discussion - ${notebookName} (${dateStr})`;

      // Créer la note via le RPC direct en tâche de fond (sans toucher au DOM)
      await createNoteViaRpc(notebookId, noteTitle, markdownContent);

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
    svg.setAttribute('aria-hidden', 'true');
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

    exportChatBtn.replaceChildren();

    if (state === 'loading') {
      const spinner = document.createElement('span');
      spinner.className = 'mm-chat-spinner';
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
    exportChatBtn.replaceChildren();
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
    'section[class*="chat"] [class*="header"]',
    'section[class*="conversation"] [class*="header"]',
    '[class*="chat-panel"] [class*="header"]',
    '[class*="conversation-panel"] [class*="header"]',
    '[class*="chat-header"]',
    '[class*="conversation-header"]',
    '[class*="chat-toolbar"]',
    '[class*="chat-actions"]'
  ];

  const CHAT_HEADER_EXCLUSIONS = 'section.source-panel, [class*="source-panel"], .left-sidebar, mat-tab-header, [class*="tab-header"], [role="tablist"], .mobile-header, mat-tab-nav-bar, [class*="emoji"], [class*="keyboard"], .chat-input, [class*="input-container"]';

  /**
   * Tente de trouver l'en-tête du panneau Discussion de manière ultra-robuste.
   * Branched hermétiquement entre Desktop (100% logique v0.14.1 éprouvée) et Mobile.
   * @returns {Element|null}
   */
  function findChatPanelHeader() {
    const isDesktop = typeof window.MM.detectDesktopLayout === 'function'
      ? window.MM.detectDesktopLayout()
      : window.innerWidth > 900;

    if (isDesktop) {
      // ═══════════════════════════════════════════════════════════════════
      // BRANCHE DESKTOP (Logique v0.14.1 exacte, 100% stable et testée)
      // ═══════════════════════════════════════════════════════════════════

      // 1. Approche par texte : chercher un panel-header contenant "Discussion" ou "Chat"
      const panelHeaders = document.querySelectorAll('.panel-header, [class*="panel-header"], [class*="header"]');
      for (const h of panelHeaders) {
        // Écarter uniquement le panneau des sources de gauche
        if (h.closest('section.source-panel, [class*="source-panel"], .left-sidebar')) {
          continue;
        }
        const text = h.textContent || '';
        if (/discussion|chat/i.test(text)) {
          return h;
        }
      }

      // 2. Approche descendante : Partir du textarea du chat pour cibler son conteneur
      const chatInput = document.querySelector(
        'textarea[aria-label*="Ask" i], ' +
        'textarea[placeholder*="Ask" i], ' +
        'textarea[aria-label*="tapez" i], ' +
        'textarea[aria-label*="Start typing" i], ' +
        '.chat-input textarea'
      );
      if (chatInput) {
        const chatPanel = chatInput.closest(
          'section, div[role="region"], [class*="chat-panel"], [class*="conversation-panel"]'
        );
        if (chatPanel) {
          const header = chatPanel.querySelector(
            '.panel-header, [class*="header"], [class*="toolbar"]'
          );
          if (header && !header.closest('section.source-panel, [class*="source-panel"], .left-sidebar')) {
            return header;
          }
        }
      }

      // 3. Repli candidats directs Desktop
      for (const sel of CHAT_HEADER_SELECTORS) {
        const candidates = document.querySelectorAll(sel);
        for (const el of candidates) {
          if (!el.closest('section.source-panel, [class*="source-panel"], .left-sidebar')) {
            return el;
          }
        }
      }

      return null;
    }

    // ═══════════════════════════════════════════════════════════════════
    // BRANCHE MOBILE (Ciblage direct de la sous-barre sous les onglets — Ligne 4)
    // En mode mobile, la sous-barre contenant 'tune' et 'more_vert' est située
    // directement sous la barre d'onglets (mat-tab-header) et au-dessus du chatPanel.
    // ═══════════════════════════════════════════════════════════════════

    // 1. Chercher l'icône de réglages 'tune' ou 'sliders' dans la sous-barre d'outils mobile
    const allIcons = document.querySelectorAll('mat-icon');
    for (const icon of allIcons) {
      const text = (icon.textContent || '').trim();
      if (text === 'tune' || text === 'sliders') {
        // Ignorer si l'icône fait partie de la barre d'onglets du haut ou du panneau sources
        if (icon.closest('mat-tab-header, [role="tablist"], section.source-panel, [class*="source-panel"]')) {
          continue;
        }

        // Remonter au conteneur flex complet de la sous-barre (largeur > 100px)
        let row = icon.parentElement;
        while (row && row !== document.body) {
          if (row.closest('mat-tab-header, [role="tablist"], section.source-panel')) break;
          const rect = row.getBoundingClientRect();
          if (rect.width > 100 && rect.height > 20 && rect.height < 70) {
            console.debug('[MM] [ChatExport] Mobile : sous-barre trouvée via icône tune dans :', row.tagName + '.' + row.className);
            return row;
          }
          row = row.parentElement;
        }
      }
    }

    // 2. Fallback ciblé : chercher l'en-tête interne du panneau chat ou la barre d'outils mobile
    const chatPanel = document.querySelector(
      'section.chat-panel, [class*="chat-panel"], [class*="conversation-panel"]'
    );
    if (chatPanel) {
      const candidateHeaders = chatPanel.querySelectorAll('.panel-header, [class*="panel-header"], [class*="toolbar"]');
      for (const ch of candidateHeaders) {
        if (!ch.closest('mat-tab-header, [role="tablist"]') && ch.offsetWidth > 100) {
          console.debug('[MM] [ChatExport] Mobile : sous-barre trouvée via candidateHeader dans chatPanel');
          return ch;
        }
      }
    }

    return null;
  }

  /**
   * Injecte le bouton d'export dans l'en-tête du panneau Discussion.
   * Fonction pure, sans debounce intégré.
   */
  function tryInjectButton() {
    // Garde-fou préférence active
    if (typeof window.MM.isFeatureEnabled === 'function') {
      if (!window.MM.isFeatureEnabled('chatExport')) {
        if (exportChatBtn) {
          exportChatBtn.remove();
          exportChatBtn = null;
        }
        return;
      }
    }

    // Bouton déjà présent dans le DOM → on applique quand même le contrôle de visibilité
    let justCreated = false;
    if (!exportChatBtn || !document.contains(exportChatBtn)) {
      if (exportChatBtn) exportChatBtn = null;

      const header = findChatPanelHeader();
      if (!header) {
        console.warn('[MM] [ChatExport] En-tête de Discussion introuvable dans la page.');
        return;
      }

      console.log('[MM] [ChatExport] Bouton injecté dans :', header.tagName + '.' + header.className);
      ensureSpinnerCss();

      exportChatBtn = createElement('button', {
        className: 'mm-chat-export-btn mm-btn-icon',
        title: t('chatExportButton') || 'Exporter toute la conversation en note',
        'aria-label': t('chatExportButton') || 'Exporter toute la conversation en note',
        onClick: function (e) {
          e.stopPropagation();
          handleExportChat();
        }
      }, [createExportIcon()]);

      // Insérer au début de l'en-tête (avant les icônes natives de Google)
      header.insertBefore(exportChatBtn, header.firstChild);
      console.log('[MM] ChatExport : bouton injecté dans l\'en-tête du panneau Discussion.');
      justCreated = true;
    }

    // Gestion de la visibilité et du positionnement en mode mobile (Option 1 : Poussée à gauche & Centrage)
    const isMobileMode = typeof window.MM.detectDesktopLayout === 'function' ? !window.MM.detectDesktopLayout() : false;
    if (isMobileMode) {
      const activeTab = document.querySelector('div[role="tab"][aria-selected="true"], .mat-mdc-tab-active');
      const isChatActive = activeTab && /discussion|chat/i.test(activeTab.textContent || '');
      if (!isChatActive) {
        exportChatBtn.style.setProperty('display', 'none', 'important');
      } else {
        exportChatBtn.style.setProperty('display', 'inline-flex', '');
        exportChatBtn.style.setProperty('margin-right', 'auto', 'important');
        exportChatBtn.style.setProperty('align-self', 'center', 'important');
      }
    } else {
      // Sur desktop, toujours visible dans l'en-tête dédié (réinitialiser les styles mobile)
      exportChatBtn.style.setProperty('display', '', '');
      exportChatBtn.style.removeProperty('margin-right');
      exportChatBtn.style.removeProperty('align-self');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 7. INITIALISATION ET NETTOYAGE
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Initialise le module d'export chat.
   */
  function initChatExport() {
    // Nettoyer les timers en cours avant de réinitialiser
    initTimers.forEach(clearTimeout);
    initTimers = [];

    // Tentative immédiate + différées pour laisser le DOM se stabiliser au chargement
    tryInjectButton();
    initTimers.push(setTimeout(tryInjectButton, 500));
    initTimers.push(setTimeout(tryInjectButton, 1500));

    console.log('[MM] Module chatExport initialisé');
  }

  /**
   * Nettoie les éléments UI.
   */
  function cleanupChatExport() {
    // Annuler tous les timers d'initialisation programmés
    initTimers.forEach(clearTimeout);
    initTimers = [];

    document.querySelectorAll('.mm-chat-export-btn').forEach(function (btn) {
      btn.remove();
    });
    exportChatBtn = null;
    console.log('[MM] Module chatExport nettoyé');
  }

  window.MM.initChatExport = initChatExport;
  window.MM.cleanupChatExport = cleanupChatExport;
  window.MM.checkAndInjectChatExport = tryInjectButton;
})();
