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

// Exposition dans le namespace global MM
window.MM.t = t;
window.MM.applyI18n = applyI18n;
window.MM.createElement = createElement;
window.MM.debounce = debounce;
window.MM.findElementsInShadows = findElementsInShadows;
window.MM.isInsideSelector = isInsideSelector;
