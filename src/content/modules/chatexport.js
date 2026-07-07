// chatexport.js — Export de toute la conversation chat vers une note NotebookLM (F6)
// Auteur : MTF Karukera | Licence : MPL-2.0
// Dépendances : window.MM (utils.js + rpcclient.js chargés avant)
//
// Fonctionnement :
//  - Injecte UN SEUL bouton dans l'en-tête du panneau Discussion
//  - En cliquant, scrape l'intégralité du thread (toutes les questions & réponses)
//  - Formate le contenu en Markdown lisible
//  - Crée une nouvelle source dans NotebookLM via RPC addTextSource

'use strict';

(function () {
  const { t, createElement, debounce } = window.MM;

  // Référence au bouton injecté (un seul à la fois)
  let exportChatBtn = null;
  // Observer pour surveiller l'apparition du panneau Discussion
  let chatHeaderObserver = null;

  // ═══════════════════════════════════════════════════════════════════════
  // 1. RÉCUPÉRATION DE L'ID DU NOTEBOOK (identique à merge.js)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Extrait l'identifiant du notebook depuis l'URL courante.
   * @returns {string|null} L'ID du notebook ou null si introuvable.
   */
  function getActiveNotebookId() {
    const m = window.location.pathname.match(/\/notebook\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2. SCRAPER DU THREAD DE CONVERSATION
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
      '[class*="copy"], [class*="thumb"], [aria-label], ' +
      '.mm-code-block-header, .mm-code-block-copy-btn'
    );
    toRemove.forEach(function (node) { node.remove(); });

    // Récupérer le texte en préservant les sauts de ligne naturels
    return clone.innerText || clone.textContent || '';
  }

  /**
   * Tente de trouver le conteneur principal du thread de chat.
   * NotebookLM utilise une architecture SPA — on teste plusieurs sélecteurs.
   * @returns {Element|null} Le conteneur des messages ou null.
   */
  function findChatScrollContainer() {
    // Ordre de priorité : du plus spécifique au plus générique
    const candidates = [
      'chat-scroll-container',
      '[class*="chat-scroll"]',
      '[class*="conversation-container"]',
      '[class*="messages-container"]',
      '[class*="chat-messages"]',
      'section.chat-panel [class*="scroll"]',
      'section.chat-panel'
    ];

    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) {
        console.log(`[MM] ChatExport : conteneur trouvé avec "${sel}"`);
        return el;
      }
    }

    // Fallback via Shadow DOM
    const shadowResults = window.MM.findElementsInShadows(
      '[class*="chat-scroll"], [class*="chat-messages"], [class*="conversation"]'
    );
    if (shadowResults.length > 0) {
      console.log('[MM] ChatExport : conteneur trouvé via Shadow DOM');
      return shadowResults[0];
    }

    console.warn('[MM] ChatExport : aucun conteneur de chat trouvé.');
    return null;
  }

  /**
   * Sélecteurs pour distinguer les tours utilisateur des tours IA.
   * On teste plusieurs attributs car les classes de NotebookLM sont obfusquées.
   */
  const USER_TURN_SELECTORS = [
    '[class*="user-turn"]',
    '[class*="human-turn"]',
    '[class*="user-message"]',
    '[class*="human-message"]',
    '[data-turn-role="user"]',
    '[aria-label*="Vous"]',
    '[aria-label*="You"]'
  ].join(', ');

  const AI_TURN_SELECTORS = [
    '[class*="model-turn"]',
    '[class*="ai-turn"]',
    '[class*="assistant-turn"]',
    '[class*="ai-message"]',
    '[class*="model-message"]',
    '[class*="response-container"]',
    '[data-turn-role="model"]',
    '[data-turn-role="assistant"]'
  ].join(', ');

  /**
   * Collecte tous les tours de conversation (utilisateur + IA) dans l'ordre.
   * @returns {Array<{role: string, text: string}>} Liste ordonnée des tours.
   */
  function collectConversationTurns() {
    const container = findChatScrollContainer();
    if (!container) return [];

    // Récupérer tous les éléments — on va les différencier par leurs attributs
    const allPossibleTurns = window.MM.findElementsInShadows(
      USER_TURN_SELECTORS + ', ' + AI_TURN_SELECTORS,
      container
    );

    // Si les sélecteurs précis ne donnent rien, on tente une approche alternative :
    // chercher tous les éléments de niveau "tour" (chat-message, etc.)
    if (allPossibleTurns.length === 0) {
      console.warn('[MM] ChatExport : sélecteurs de tours précis infructueux. Tentative générique...');
      const genericTurns = window.MM.findElementsInShadows(
        'chat-message, [class*="chat-turn"], [class*="message-bubble"]',
        container
      );
      if (genericTurns.length === 0) {
        console.warn('[MM] ChatExport : aucun tour trouvé dans le chat.');
        return [];
      }
      // Mode dégradé : on ne peut pas distinguer les rôles
      return genericTurns.map(function (el) {
        return { role: 'message', text: extractCleanText(el).trim() };
      }).filter(function (turn) { return turn.text.length > 0; });
    }

    // Filtrer les doublons (un enfant peut correspondre à plusieurs sélecteurs)
    const seenEls = new Set();
    const turns = [];

    allPossibleTurns.forEach(function (el) {
      if (seenEls.has(el)) return;
      seenEls.add(el);

      // Déterminer le rôle de ce tour
      const isUser = el.matches ? el.matches(USER_TURN_SELECTORS) : false;
      const text = extractCleanText(el).trim();
      if (!text) return;

      turns.push({
        role: isUser ? 'user' : 'ai',
        el: el
      });
    });

    // Trier dans l'ordre d'apparition dans le DOM
    turns.sort(function (a, b) {
      const pos = a.el.compareDocumentPosition(b.el);
      return (pos & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
    });

    // Extraire le texte final
    return turns.map(function (turn) {
      return {
        role: turn.role,
        text: extractCleanText(turn.el).trim()
      };
    }).filter(function (turn) { return turn.text.length > 0; });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3. FORMATEUR MARKDOWN
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

    turns.forEach(function (turn, index) {
      let roleLabel;
      if (turn.role === 'user') {
        roleLabel = '## 🙋 Vous';
      } else if (turn.role === 'ai') {
        roleLabel = '## 🤖 NotebookLM';
      } else {
        roleLabel = `## 💬 Message ${index + 1}`;
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
  // 4. ACTION PRINCIPALE D'EXPORT
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Exporte toute la conversation en une note NotebookLM via RPC.
   * Gère les états du bouton (chargement, succès, erreur).
   */
  async function handleExportChat() {
    if (!exportChatBtn) return;

    const notebookId = getActiveNotebookId();
    if (!notebookId) {
      console.error('[MM] ChatExport : impossible d\'identifier le notebook courant.');
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

      // Construire le titre de la note : "Chat — JJ/MM/AAAA HH:MM"
      const now = new Date();
      const noteTitle = `Chat — ${now.toLocaleDateString('fr-FR')} ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;

      // Envoyer via RPC addTextSource
      await window.MM.rpc.addTextSource(notebookId, noteTitle, markdownContent);

      console.log(`[MM] ChatExport : note "${noteTitle}" créée avec succès.`);
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
   * Crée l'icône SVG du bouton d'export (une conversation avec une flèche).
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

    // Icône : bulle de chat avec flèche vers le bas (save/export)
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

    // Vider l'icône courante
    exportChatBtn.innerHTML = '';

    if (state === 'loading') {
      // Indicateur de chargement animé (cercle CSS)
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
      // Coche verte
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
      // Croix orange
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
      exportChatBtn.title = 'Erreur lors de l\'export';
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
   * On cible la barre d'en-tête du panneau central qui contient les icônes natives.
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
    // Recherche dans le Shadow DOM
    return window.MM.findElementsInShadows(
      CHAT_HEADER_SELECTORS.join(', ')
    )[0] || null;
  }

  /**
   * Injecte le bouton d'export dans l'en-tête du panneau Discussion.
   * Vérifie qu'il n'est pas déjà présent avant d'injecter.
   */
  const tryInjectButton = debounce(function () {
    // Bouton déjà présent et toujours dans le DOM → rien à faire
    if (exportChatBtn && document.contains(exportChatBtn)) return;

    // Nettoyer une référence orpheline si le bouton a été supprimé par une navigation SPA
    if (exportChatBtn) {
      exportChatBtn = null;
    }

    const header = findChatPanelHeader();
    if (!header) {
      console.log('[MM] ChatExport : en-tête du panneau Discussion pas encore disponible.');
      return;
    }

    ensureSpinnerCss();

    // Créer le bouton
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

    // Effets de survol
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
   * Lance un observer pour injecter le bouton dès que l'en-tête apparaît.
   */
  function initChatExport() {
    if (chatHeaderObserver) return; // Déjà actif

    // Tentative immédiate
    tryInjectButton();

    // Observer pour réinjecter le bouton si la SPA navigue
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

    // Supprimer le bouton injecté
    document.querySelectorAll('.mm-chat-export-btn').forEach(function (btn) {
      btn.remove();
    });
    exportChatBtn = null;

    console.log('[MM] Module chatExport nettoyé');
  }

  // Exposition publique
  window.MM.initChatExport = initChatExport;
  window.MM.cleanupChatExport = cleanupChatExport;
})();
