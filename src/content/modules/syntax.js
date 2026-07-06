// syntax.js — Module de coloration syntaxique des blocs de code (F5)
// Auteur : MTF Karukera | Licence : MPL-2.0
// Dépendance : window.MM (utils.js chargé avant)

'use strict';

(function () {
  const { t, createElement, debounce } = window.MM;

  // ═══════════════════════════════════════════════════════════════════════
  // État interne
  // ═══════════════════════════════════════════════════════════════════════

  /** MutationObserver pour guetter les nouveaux messages de chat */
  let chatObserver = null;

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
  // Gestion et recherche récursive (y compris Shadow DOM)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Recherche récursivement des éléments correspondant au sélecteur,
   * y compris à l'intérieur de tous les Shadow Roots.
   * @param {string} selector - Sélecteur CSS.
   * @param {Element|Document} [root=document] - Point de départ de la recherche.
   * @returns {Array<Element>}
   */
  function findElementsInShadows(selector, root = document) {
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

  /**
   * Traite un bloc `<pre>` pour lui appliquer la structure et la coloration syntaxique.
   * @param {Element} preEl - L'élément `<pre>` natif.
   */
  function processPreBlock(preEl) {
    const codeEl = preEl.querySelector('code');
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
   * Parcourt la page pour traiter tous les blocs de code non encore gérés.
   */
  const scanAndHighlight = debounce(function () {
    // Utilisation de findElementsInShadows pour traverser le Shadow DOM
    const preBlocks = findElementsInShadows('pre:not([data-mm-syntax-processed="true"])');
    preBlocks.forEach(function (pre) {
      if (!pre.closest('.mm-code-block')) {
        processPreBlock(pre);
      }
    });
  }, 100);

  // ═══════════════════════════════════════════════════════════════════════
  // Initialisation et Nettoyage
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Initialise le module de coloration syntaxique.
   */
  function initSyntax() {
    if (chatObserver) return; // Déjà actif

    // Scanner immédiatement le DOM
    scanAndHighlight();

    // Observer global pour détecter l'apparition de nouveaux blocs de code
    chatObserver = new MutationObserver(function () {
      scanAndHighlight();
    });

    chatObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    console.log('[MM] Module coloration syntaxique initialisé');
  }

  /**
   * Nettoie les listeners et arrête l'observation.
   */
  function cleanupSyntax() {
    if (chatObserver) {
      chatObserver.disconnect();
      chatObserver = null;
    }
    console.log('[MM] Module coloration syntaxique nettoyé');
  }

  // Exposition dans le namespace global MM
  window.MM.initSyntax = initSyntax;
  window.MM.cleanupSyntax = cleanupSyntax;
})();
