// utils.js — Fonctions utilitaires partagées
// Auteur : MTF Karukera | Licence : MPL-2.0
// Chargé en premier par le manifest — initialise le namespace global MM.

'use strict';

// Namespace global de l'extension — tous les modules y exposent leurs fonctions
window.MM = window.MM || {};

/**
 * Résout une clé i18n en chaîne traduite.
 * Wrapper simplifié autour de browser.i18n.getMessage().
 *
 * @param  {string}              key            - Clé de traduction (ex: "settingsTitle").
 * @param  {string|Array|null}   [substitutions] - Substitutions positionnelles ($1, $2…).
 * @returns {string} Chaîne traduite, ou la clé elle-même si introuvable.
 */
function t(key, substitutions) {
  const msg = browser.i18n.getMessage(key, substitutions);
  if (!msg) {
    console.warn('[MM] Clé i18n manquante:', key);
    return key;
  }
  return msg;
}

/**
 * Applique les traductions i18n aux éléments du DOM portant des attributs data-i18n.
 * Supporte trois modes :
 *   - data-i18n="key"             → traduit le textContent
 *   - data-i18n-placeholder="key" → traduit l'attribut placeholder
 *   - data-i18n-title="key"       → traduit l'attribut title
 *
 * @param {Element} [root=document] - Racine de la recherche dans le DOM.
 */
function applyI18n(root = document) {
  // Traduction du contenu textuel
  const elements = root.querySelectorAll('[data-i18n]');
  for (const el of elements) {
    const key = el.getAttribute('data-i18n');
    const translated = t(key);
    if (translated !== key) {
      el.textContent = translated;
    }
  }

  // Traduction des placeholders d'input
  const placeholders = root.querySelectorAll('[data-i18n-placeholder]');
  for (const el of placeholders) {
    const key = el.getAttribute('data-i18n-placeholder');
    const translated = t(key);
    if (translated !== key) {
      el.placeholder = translated;
    }
  }

  // Traduction des attributs title (infobulles)
  const titles = root.querySelectorAll('[data-i18n-title]');
  for (const el of titles) {
    const key = el.getAttribute('data-i18n-title');
    const translated = t(key);
    if (translated !== key) {
      el.title = translated;
    }
  }
}

/**
 * Crée un élément DOM de manière sécurisée (sans innerHTML).
 * Respecte la CSP stricte imposée par Firefox MV3.
 *
 * @param {string} tag - Nom de la balise HTML (ex: "div", "button").
 * @param {Object} [attrs={}] - Attributs à appliquer sur l'élément.
 *   Les clés spéciales reconnues :
 *     - className : affecte el.className
 *     - textContent : affecte el.textContent
 *     - onXxx : ajoute un addEventListener (ex: onClick → "click")
 *   Tout autre clé est traitée comme un setAttribute().
 * @param {Array<Element|string>} [children=[]] - Enfants à ajouter (éléments ou texte).
 * @returns {Element} L'élément DOM créé.
 */
function createElement(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'className') {
      el.className = value;
    } else if (key === 'textContent') {
      el.textContent = value;
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      el.setAttribute(key, value);
    }
  }
  for (const child of children) {
    if (typeof child === 'string') {
      el.appendChild(document.createTextNode(child));
    } else if (child instanceof Element) {
      el.appendChild(child);
    }
  }
  return el;
}

/**
 * Débouncer standard — retarde l'exécution d'une fonction jusqu'à
 * ce qu'un délai se soit écoulé sans nouvel appel.
 *
 * @param {Function} fn - Fonction à débouncer.
 * @param {number} delay - Délai en millisecondes.
 * @returns {Function} Fonction debouncée.
 */
function debounce(fn, delay) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

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
 * Vérifie récursivement si un élément se trouve à l'intérieur d'un sélecteur,
 * en traversant les Shadow Roots vers les hôtes parents.
 * @param {Element} element - L'élément à tester.
 * @param {string} selector - Le sélecteur CSS de recherche.
 * @returns {boolean} True si l'élément ou l'un de ses parents correspond au sélecteur.
 */
function isInsideSelector(element, selector) {
  let el = element;
  while (el) {
    if (el instanceof Element && el.matches(selector)) {
      return true;
    }
    el = el.parentNode || (el.host ? el.host : null);
  }
  return false;
}

/**
 * Extrait l'identifiant du notebook actif depuis l'URL courante.
 * @returns {string|null} Identifiant du notebook ou null.
 */
function getActiveNotebookId() {
  const m = window.location.pathname.match(/\/notebook\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

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

/**
 * Convertit une chaîne de caractères HTML en Markdown formaté de façon sémantique et propre.
 * Utilise le DOMParser natif du navigateur pour une analyse robuste.
 *
 * @param {string} html - Chaîne HTML source.
 * @returns {string} Chaîne Markdown résultante.
 */
function htmlToMarkdown(html) {
  if (!html) return '';

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Traiter récursivement chaque nœud HTML
  function walk(node, listContext = null) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.nodeValue;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    const tagName = node.tagName.toUpperCase();
    let childrenContent = '';

    // Déterminer le type de liste
    let newListContext = listContext;
    if (tagName === 'UL') {
      newListContext = { type: 'ul', index: 0 };
    } else if (tagName === 'OL') {
      newListContext = { type: 'ol', index: 0 };
    }

    for (const child of node.childNodes) {
      childrenContent += walk(child, newListContext);
    }

    switch (tagName) {
      case 'H1':
        return `\n\n# ${childrenContent.trim()}\n\n`;
      case 'H2':
        return `\n\n## ${childrenContent.trim()}\n\n`;
      case 'H3':
        return `\n\n### ${childrenContent.trim()}\n\n`;
      case 'H4':
        return `\n\n#### ${childrenContent.trim()}\n\n`;
      case 'H5':
        return `\n\n##### ${childrenContent.trim()}\n\n`;
      case 'H6':
        return `\n\n###### ${childrenContent.trim()}\n\n`;
      
      case 'P':
      case 'DIV': {
        const trimmed = childrenContent.trim();
        return trimmed ? `\n\n${trimmed}\n\n` : '';
      }
      
      case 'BR':
        return '\n';
      
      case 'STRONG':
      case 'B': {
        const strVal = childrenContent.trim();
        return strVal ? `**${strVal}**` : '';
      }
      
      case 'EM':
      case 'I': {
        const emVal = childrenContent.trim();
        return emVal ? `*${emVal}*` : '';
      }

      case 'U': {
        const uVal = childrenContent.trim();
        return uVal ? `_${uVal}_` : '';
      }

      case 'CODE':
        return `\`${childrenContent}\``;

      case 'PRE':
        return `\n\n\`\`\`\n${childrenContent}\n\`\`\`\n\n`;
      
      case 'A': {
        const href = node.getAttribute('href');
        const text = childrenContent.trim();
        if (href && text) {
          return `[${text}](${href})`;
        }
        return text || href || '';
      }
      
      case 'IMG': {
        const src = node.getAttribute('src') || '';
        const alt = node.getAttribute('alt') || 'Image';
        return `\n![${alt}](${src})\n`;
      }

      case 'LI': {
        let prefix = '- ';
        if (listContext && listContext.type === 'ol') {
          listContext.index++;
          prefix = `${listContext.index}. `;
        }
        const liContent = childrenContent.trim().replace(/\n+/g, ' ');
        return `\n${prefix}${liContent}`;
      }

      case 'UL':
      case 'OL':
        return `\n${childrenContent}\n`;

      case 'BLOCKQUOTE':
        return `\n\n> ${childrenContent.trim().split('\n').join('\n> ')}\n\n`;

      case 'HR':
        return '\n\n---\n\n';

      default:
        return childrenContent;
    }
  }

  let markdown = walk(doc.body);

  // Nettoyage final du texte : sauts de lignes multiples, espaces etc.
  markdown = markdown
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\r/g, '')
    .trim();

  return markdown;
}

// Exposition dans le namespace global MM
window.MM.t = t;
window.MM.applyI18n = applyI18n;
window.MM.createElement = createElement;
window.MM.debounce = debounce;
window.MM.findElementsInShadows = findElementsInShadows;
window.MM.isInsideSelector = isInsideSelector;
window.MM.getActiveNotebookId = getActiveNotebookId;
window.MM.extractSourceId = extractSourceId;
window.MM.htmlToMarkdown = htmlToMarkdown;
