// syntax.js — Module de coloration syntaxique des blocs de code (F5)
// Auteur : MTF Karukera | Licence : MPL-2.0
// Dépendance : window.MM (utils.js chargé avant)

'use strict';

(function () {
  const { t, createElement, debounce } = window.MM;

  // ═══════════════════════════════════════════════════════════════════════
  // État interne
  // ═══════════════════════════════════════════════════════════════════════



  // ═══════════════════════════════════════════════════════════════════════
  // Parseur DOM Sécurisé (Coloration de syntaxe sans innerHTML)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Applique une coloration syntaxique légère et retourne un DocumentFragment.
   * Cette méthode est 100% sécurisée (sans innerHTML) pour respecter la CSP.
   * @param {string} code - Code source brut.
   * @param {string} lang - Langage détecté (ex: 'javascript', 'python').
   * @returns {DocumentFragment} Fragment de document contenant les nœuds colorés.
   */
  function highlightCode(code, lang) {
    const fragment = document.createDocumentFragment();

    const jsKeywords = [
      'const', 'let', 'var', 'function', 'class', 'return', 'if', 'else',
      'for', 'while', 'import', 'export', 'try', 'catch', 'new', 'null',
      'undefined', 'true', 'false', 'async', 'await', 'switch', 'case',
      'default', 'break', 'continue', 'typeof', 'instanceof', 'throw'
    ];
    const pyKeywords = [
      'def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while',
      'import', 'from', 'as', 'try', 'except', 'finally', 'print', 'in',
      'is', 'not', 'and', 'or', 'True', 'False', 'None', 'lambda', 'with', 'pass'
    ];

    let keywords = [];
    if (lang === 'javascript' || lang === 'js' || lang === 'json') {
      keywords = jsKeywords;
    } else if (lang === 'python' || lang === 'py') {
      keywords = pyKeywords;
    } else {
      keywords = jsKeywords.concat(pyKeywords);
    }

    // Expression régulière pour capturer les jetons syntaxiques
    const patterns = [
      '(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/.*|#.*)',
      '("(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'|`(?:\\\\.|[^`\\\\])*`)',
      '\\b(\\d+(?:\\.\\d+)?)\\b'
    ];

    if (keywords.length > 0) {
      patterns.push('\\b(' + keywords.join('|') + ')\\b');
    }

    const pattern = new RegExp(patterns.join('|'), 'g');
    let lastIndex = 0;
    let match;

    while ((match = pattern.exec(code)) !== null) {
      const textBefore = code.substring(lastIndex, match.index);
      if (textBefore) {
        fragment.appendChild(document.createTextNode(textBefore));
      }

      if (match[1]) {
        // Commentaire
        fragment.appendChild(createElement('span', { className: 'mm-token-comment', textContent: match[1] }));
      } else if (match[2]) {
        // String
        fragment.appendChild(createElement('span', { className: 'mm-token-string', textContent: match[2] }));
      } else if (match[3]) {
        // Number
        fragment.appendChild(createElement('span', { className: 'mm-token-number', textContent: match[3] }));
      } else if (match[4]) {
        // Keyword
        fragment.appendChild(createElement('span', { className: 'mm-token-keyword', textContent: match[4] }));
      }

      lastIndex = pattern.lastIndex;
    }

    const textRemaining = code.substring(lastIndex);
    if (textRemaining) {
      fragment.appendChild(document.createTextNode(textRemaining));
    }

    return fragment;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Recherche Shadow DOM ciblée
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Recherche récursivement des éléments dans les Shadow DOMs de manière ciblée.
   * Limité à la zone locale passée en paramètre pour des performances optimales.
   * @param {string} selector - Sélecteur CSS.
   * @param {Element|ShadowRoot} root - Racine de recherche.
   * @returns {Array<Element>}
   */
  function findElementsInShadows(selector, root) {
    let elements = Array.from(root.querySelectorAll(selector));
    const children = root.querySelectorAll('*');
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.shadowRoot) {
        elements = elements.concat(findElementsInShadows(selector, child.shadowRoot));
      }
    }
    return elements;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Détection du langage
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Détecte le langage à partir des classes de l'élément code ou pre.
   * @param {Element} pre - Élément pre parent.
   * @param {Element} code - Élément code enfant.
   * @returns {string} Langage détecté (ex: 'javascript', 'python', 'code').
   */
  function detectLanguage(pre, code) {
    const list = Array.from(code.classList).concat(Array.from(pre.classList));
    for (let i = 0; i < list.length; i++) {
      const cls = list[i];
      if (cls.indexOf('language-') === 0) {
        return cls.replace('language-', '');
      }
      if (cls.indexOf('lang-') === 0) {
        return cls.replace('lang-', '');
      }
    }
    return 'code';
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Détection du Streaming IA & Garde Anti-Coupure
  // ═══════════════════════════════════════════════════════════════════════

  let retryStreamingTimer = null;

  /**
   * Planifie un re-scan retardé pour capturer la fin du streaming
   * au cas où la disparition des indicateurs n'émettrait pas de mutation d'enfants.
   */
  function scheduleStreamingRetry() {
    if (retryStreamingTimer) {
      clearTimeout(retryStreamingTimer);
    }
    retryStreamingTimer = setTimeout(function () {
      retryStreamingTimer = null;
      scanAndHighlight();
    }, 600);
  }

  /**
   * Vérifie si l'IA est actuellement en train de générer ou diffuser (streaming) une réponse.
   * Analyse multi-niveaux résiliente au responsive Mobile (onglets) et Desktop (3 colonnes) :
   * 1. Détection du bouton Stop / Arrêter / Interrompre (global ou dans les capsules de chat).
   * 2. Inspection des icônes et classes de streaming dans les conteneurs de prompt et de discussion.
   * @returns {boolean} true si une génération est en cours.
   */
  function isStreamingActive() {
    // 1. Recherche du bouton d'arrêt/interruption (multilingue) dans tout le document
    const stopSelectors = [
      'button[aria-label*="stop" i]',
      'button[aria-label*="arrê" i]',
      'button[aria-label*="interromp" i]',
      'button[aria-label*="cancel" i]',
      'button[aria-label*="annul" i]',
      'button[aria-label*="halt" i]',
      'button[aria-label*="deten" i]',
      'button[aria-label*="abbrech" i]',
      'button[mattooltip*="stop" i]',
      'button[mattooltip*="arrê" i]',
      'button[mattooltip*="interromp" i]',
      'button[title*="stop" i]',
      'button[title*="arrê" i]',
      'button[title*="interromp" i]',
      'button.chat-stop-button',
      '[class*="stop-button"]'
    ];

    const stopButtons = document.querySelectorAll(stopSelectors.join(', '));
    for (let i = 0; i < stopButtons.length; i++) {
      const btn = stopButtons[i];
      if (btn.offsetWidth > 0 || btn.offsetHeight > 0 || (btn.getClientRects && btn.getClientRects().length > 0)) {
        return true;
      }
    }

    // 2. Détection par icône mat-icon stop ou svg stop dans les conteneurs de prompt/discussion
    const promptContainers = document.querySelectorAll(
      'query-input, .query-box, [class*="query-box"], .chat-input, [class*="chat-input"], form, section.chat-panel, [class*="chat-panel"], chat-panel'
    );
    for (let i = 0; i < promptContainers.length; i++) {
      const container = promptContainers[i];
      const iconBtn = container.querySelector('button mat-icon, button svg');
      if (iconBtn) {
        const iconText = (iconBtn.textContent || '').trim().toLowerCase();
        const iconName = (iconBtn.getAttribute('data-mat-icon-name') || '').toLowerCase();
        if (iconText === 'stop' || iconName === 'stop') {
          return true;
        }
      }
      if (container.querySelector('[class*="streaming"], [class*="generating"], mat-progress-bar')) {
        return true;
      }
    }

    return false;
  }

  /**
   * Traite un bloc `<pre>` pour lui appliquer la structure et la coloration syntaxique.
   * @param {Element} preEl - L'élément `<pre>` natif.
   */
  function processPreBlock(preEl) {
    // Garde 1 : ne jamais appliquer de boîte de code sur une note éditable du Studio.
    // Les messages du Chat ne sont jamais des notes éditables du Studio et sont toujours traités.
    const isInsideStudioEditor = !!preEl.closest('[class*="studio"], [class*="note"]') && !!preEl.closest('[contenteditable="true"], [contenteditable=""]');
    if (preEl.isContentEditable || isInsideStudioEditor) {
      return;
    }

    // Garde 2 (Défense en profondeur Mobile & Desktop) : Si le bloc se trouve dans un tour de discussion du Chat,
    // vérifier impérativement que la réponse de l'IA est complètement achevée (présence des boutons d'actions finales).
    const chatTurn = preEl.closest(
      'chat-message, conversation-turn, model-response, [class*="model-turn"], [class*="ai-turn"], [class*="chat-turn"], [class*="message-bubble"], [class*="chat-scroll-card"]'
    );
    if (chatTurn) {
      // Les réponses terminées affichent les boutons d'actions (Copier la réponse, Sauvegarder dans une note, Pouces)
      const hasFinalActions = !!chatTurn.querySelector(
        'button[aria-label*="épingl" i], button[aria-label*="note" i], button[aria-label*="Note" i], button[aria-label*="copi" i], button[aria-label*="copy" i], button[aria-label*="thumb" i], button[aria-label*="pouce" i]'
      );
      // S'il n'y a pas encore d'actions finales, le message est en cours de streaming : différer l'habillage
      if (!hasFinalActions) {
        scheduleStreamingRetry();
        return;
      }
    }

    const codeEl = preEl.querySelector('code') || preEl;
    if (!codeEl) return;

    // 1. Éviter le traitement multiple en marquant avant toute manipulation
    preEl.setAttribute('data-mm-syntax-processed', 'true');

    // 2. Détecter le langage et récupérer le texte brut
    const lang = detectLanguage(preEl, codeEl);
    const rawCode = codeEl.textContent;

    // 3. Créer le bouton Copier
    const copyBtn = createElement('button', {
      className: 'mm-code-copy-btn',
      textContent: t('codeCopyButton'),
      onClick: function () {
        navigator.clipboard.writeText(rawCode).then(function () {
          copyBtn.textContent = t('codeCopied');
          copyBtn.classList.add('mm-copied');
          setTimeout(function () {
            copyBtn.textContent = t('codeCopyButton');
            copyBtn.classList.remove('mm-copied');
          }, 1500);
        }).catch(function (err) {
          console.error('[MM] Impossible de copier le code :', err);
        });
      }
    });

    // 4. Créer l'en-tête
    const header = createElement('div', { className: 'mm-code-header' }, [
      createElement('span', { className: 'mm-code-lang', textContent: lang }),
      copyBtn
    ]);

    // 5. Nouveau bloc code et pre
    const newCode = createElement('code', {}, []);
    const highlightedFragment = highlightCode(rawCode, lang);
    newCode.appendChild(highlightedFragment);

    const newPre = createElement('pre', {}, [newCode]);

    // 6. Enveloppe complète mm-code-block
    const codeBlockContainer = createElement('div', {
      className: 'mm-code-block'
    }, [header, newPre]);

    // 7. Remplacement dans le DOM
    if (preEl.parentNode) {
      preEl.parentNode.replaceChild(codeBlockContainer, preEl);
    }
  }

  /**
   * Parcourt la zone de chat et les notes en lecture seule du Studio pour traiter tous les blocs de code non encore gérés.
   * IMPORTANT : Ne traite RIEN si l'IA est en cours de streaming (le DOM n'est pas stabilisé).
   */
  const scanAndHighlight = debounce(function () {
    if (typeof window.MM.isFeatureEnabled === 'function' && !window.MM.isFeatureEnabled('syntax')) {
      return;
    }

    // Garde anti-streaming sentinelle (Mobile & Desktop)
    if (isStreamingActive()) {
      scheduleStreamingRetry();
      return;
    }

    // Scope global : couvre le chat ET le Studio (notes en lecture seule).
    const scanRoot = document.body;

    // Recherche récursive Shadow DOM
    const preBlocks = findElementsInShadows('pre:not([data-mm-syntax-processed="true"])', scanRoot);
    preBlocks.forEach(function (pre) {
      const isInsideStudioEditor = !!pre.closest('[class*="studio"], [class*="note"]') && !!pre.closest('[contenteditable="true"], [contenteditable=""]');
      if (!pre.isContentEditable && !isInsideStudioEditor && !pre.closest('.mm-code-block')) {
        processPreBlock(pre);
      }
    });
  }, 250);

  // ═══════════════════════════════════════════════════════════════════════
  // Initialisation et Nettoyage
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Initialise le module de coloration syntaxique.
   */
  function initSyntax() {
    // Scanner immédiatement la zone de chat
    scanAndHighlight();
    console.log('[MM] Module coloration syntaxique initialisé');
  }

  /**
   * Nettoie les conteneurs décorés et restaure les balises pre natives.
   */
  function cleanupSyntax() {
    if (retryStreamingTimer) {
      clearTimeout(retryStreamingTimer);
      retryStreamingTimer = null;
    }
    const codeBlocks = document.querySelectorAll('.mm-code-block');
    codeBlocks.forEach(block => {
      const codeEl = block.querySelector('code');
      const rawText = codeEl ? codeEl.textContent : '';
      const originalPre = document.createElement('pre');
      const originalCode = document.createElement('code');
      originalCode.textContent = rawText;
      originalPre.appendChild(originalCode);
      if (block.parentNode) {
        block.parentNode.replaceChild(originalPre, block);
      }
    });
    console.log('[MM] Module coloration syntaxique nettoyé');
  }

  // Exposition dans le namespace global MM
  window.MM.initSyntax = initSyntax;
  window.MM.cleanupSyntax = cleanupSyntax;
  window.MM.scanAndHighlight = scanAndHighlight;
})();
