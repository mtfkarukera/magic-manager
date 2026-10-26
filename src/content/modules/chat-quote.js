// chat-quote.js — Module de citation synthétique de réponses dans le chat (Quote-to-Prompt)
// Auteur : MTF Karukera | Licence : MPL-2.0
// Dépendance : window.MM (utils.js chargé avant)

'use strict';

(function () {
  const { t, createElement } = window.MM;

  // ═══════════════════════════════════════════════════════════════════════
  // État interne
  // ═══════════════════════════════════════════════════════════════════════

  /** Référence au bouton flottant "Citer" injecté dans le DOM */
  let quotePill = null;

  /** Indique si les écouteurs d'événements sont actifs */
  let isListening = false;

  /** Timer pour regrouper et temporiser les vérifications de sélection */
  let selectionCheckTimeout = null;

  // ═══════════════════════════════════════════════════════════════════════
  // 1. Algorithme de Synthèse (Seuil 80 car. & Troncature Tête + Queue)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Tronque et synthétise une sélection textuelle à 80 caractères maximum.
   * Si le texte dépasse 80 caractères, applique la troncature "Tête + Queue"
   * calée sur les limites de mots entiers.
   *
   * @param {string} rawText - Texte brut sélectionné par l'utilisateur.
   * @returns {string} Texte synthétisé prêt pour la citation.
   */
  function synthesizeQuote(rawText) {
    if (!rawText) return '';

    // Normaliser les espaces et sauts de ligne multiples
    const clean = rawText.replace(/\s+/g, ' ').trim();
    if (clean.length <= 80) {
      return clean;
    }

    // Cible : ~35 caractères au début, ~30 à la fin
    const headTarget = 35;
    const tailTarget = 30;

    // Découpage tête sur frontière de mot
    let head = clean.substring(0, headTarget);
    const lastSpaceHead = head.lastIndexOf(' ');
    if (lastSpaceHead > 15) {
      head = head.substring(0, lastSpaceHead);
    }

    // Découpage queue sur frontière de mot
    let tail = clean.substring(clean.length - tailTarget);
    const firstSpaceTail = tail.indexOf(' ');
    if (firstSpaceTail !== -1 && firstSpaceTail < 15) {
      tail = tail.substring(firstSpaceTail + 1);
    }

    return `${head.trim()} [...] ${tail.trim()}`;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Validation Sécurisée du Conteneur (Réponses IA exclusivement)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Vérifie si un nœud DOM appartient bien à une bulle de réponse émise par l'IA.
   * Exclut formellement les questions utilisateur, le panneau des sources et le Studio.
   *
   * @param {Node} node - Nœud du Range de sélection.
   * @returns {boolean} true si le nœud se trouve dans une réponse de l'IA.
   */
  function isInsideAiMessage(node) {
    if (!node) return false;
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!el) return false;

    // 1. Exclure immédiatement les zones de formulaire, panneaux latéraux et nos composants
    if (el.closest('textarea, input, [contenteditable="true"], .chat-input, [class*="query-box"], section.source-panel, studio-panel, .left-sidebar, .mm-floating-quote-pill, .mm-search-bar')) {
      return false;
    }

    // 2. Trouver le conteneur de message ou tour de discussion le plus proche
    const turnEl = el.closest(
      'chat-message, conversation-turn, model-response, [class*="model-turn"], [class*="ai-turn"], [class*="chat-turn"], [class*="message-bubble"], [class*="chat-scroll-card"]'
    );
    if (!turnEl) return false;

    // 3. Exclure formellement les tours utilisateur
    if (turnEl.closest('[class*="user-turn"], [class*="human-turn"], [class*="user-message"]')) {
      return false;
    }
    const turnCls = turnEl.className || '';
    if (/user.?turn|human.?turn|user.?message/i.test(turnCls)) {
      return false;
    }

    // 4. Critère direct : balise ou classe indiquant un tour de modèle / IA
    if (/model|ai|assistant/i.test(turnEl.tagName) || /model|ai|assistant|response/i.test(turnCls)) {
      return true;
    }

    // 5. Critère heuristique fort : présence d'indicateurs de réponse IA (pouces, copier, note)
    const hasAiIndicators = turnEl.querySelector(
      'button[aria-label*="épingl" i], button[aria-label*="note" i], button[aria-label*="Note" i], button[aria-label*="copi" i], button[aria-label*="copy" i], button[aria-label*="thumb" i], button[aria-label*="pouce" i]'
    );
    return !!hasAiIndicators;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3. Bouton Flottant Material Design 3 (Création & Positionnement)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Crée l'icône SVG des guillemets Material Design (format_quote).
   * @returns {SVGElement}
   */
  function createQuoteIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');

    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z');
    svg.appendChild(path);
    return svg;
  }

  /**
   * S'assure que l'élément DOM du bouton flottant existe dans le body.
   * @returns {HTMLElement} L'élément du bouton flottant.
   */
  function ensureFloatingPill() {
    if (quotePill && document.body.contains(quotePill)) return quotePill;

    const quoteLabel = t('chatQuoteTooltip') || 'Citer ce passage dans le chat';
    quotePill = createElement('button', {
      className: 'mm-floating-quote-pill',
      type: 'button',
      'aria-label': quoteLabel,
      title: quoteLabel
    });

    const icon = createQuoteIcon();
    const label = createElement('span', {
      className: 'mm-quote-pill-text',
      textContent: t('chatQuoteButton') || 'Citer'
    });

    quotePill.appendChild(icon);
    quotePill.appendChild(label);

    // Empêcher la perte de sélection au clic sur la pilule
    quotePill.addEventListener('mousedown', function (e) {
      e.preventDefault();
      e.stopPropagation();
    });

    quotePill.addEventListener('click', handleQuoteClick);

    document.body.appendChild(quotePill);
    return quotePill;
  }

  /**
   * Affiche et positionne la pilule flottante au-dessus de la sélection.
   * @param {Range} range - Le range de sélection actif.
   */
  function showFloatingPill(range) {
    const pill = ensureFloatingPill();
    const rect = range.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
      hideFloatingPill();
      return;
    }

    // Affichage initial pour mesurer la taille de la pilule
    pill.style.display = 'inline-flex';
    pill.style.visibility = 'hidden';
    const pillRect = pill.getBoundingClientRect();
    const pillWidth = pillRect.width || 80;
    const pillHeight = pillRect.height || 32;

    // Calcul vertical : au-dessus de la sélection par défaut
    let top = rect.top - pillHeight - 8 + window.scrollY;
    // Si trop proche du bord supérieur de la vue, basculer en dessous
    if (rect.top - pillHeight - 8 < 10) {
      top = rect.bottom + 8 + window.scrollY;
    }

    // Calcul horizontal : centré sur la sélection avec clamping
    let left = rect.left + (rect.width / 2) - (pillWidth / 2) + window.scrollX;
    const minLeft = 10 + window.scrollX;
    const maxLeft = window.innerWidth - pillWidth - 10 + window.scrollX;
    if (left < minLeft) left = minLeft;
    if (left > maxLeft) left = maxLeft;

    pill.style.top = `${Math.round(top)}px`;
    pill.style.left = `${Math.round(left)}px`;
    pill.style.visibility = 'visible';
    pill.classList.add('mm-visible');
  }

  /**
   * Masque la pilule flottante.
   */
  function hideFloatingPill() {
    if (quotePill) {
      quotePill.classList.remove('mm-visible');
      quotePill.style.display = 'none';
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 4. Injection dans le Textarea (Multi-Citations & Modèle Angular)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Recherche le textarea de saisie de prompt actif dans la zone de chat.
   * @returns {HTMLTextAreaElement|null}
   */
  function findChatTextarea() {
    const selectors = [
      'textarea[aria-label*="Ask" i]',
      'textarea[placeholder*="Ask" i]',
      'textarea[placeholder*="question" i]',
      'textarea[placeholder*="Posez" i]',
      'textarea[aria-label*="Query" i]',
      'textarea[aria-label*="tapez" i]',
      'textarea[aria-label*="Start typing" i]',
      '.chat-input textarea',
      'form:has(textarea) textarea',
      'textarea'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null && !el.closest('section.source-panel, studio-panel, .left-sidebar')) {
        return el;
      }
    }
    return null;
  }

  /**
   * Insère une citation formatée dans le champ de saisie du chat.
   * Concatène proprement avec un double saut de ligne en cas de multi-citations.
   *
   * @param {string} synthQuote - Citation synthétique.
   */
  function insertQuoteIntoChatInput(synthQuote) {
    const textarea = findChatTextarea();
    if (!textarea) {
      console.warn('[MM] Champ de saisie du chat introuvable pour la citation');
      return;
    }

    const formattedQuote = `> « ${synthQuote} »\n`;
    const currentVal = textarea.value || '';

    let newVal = '';
    let newCursorPos = 0;

    if (!currentVal.trim()) {
      newVal = formattedQuote;
      newCursorPos = newVal.length;
    } else {
      // Séparer les blocs par un double saut de ligne sans écraser le texte existant
      const trimmedVal = currentVal.replace(/\n+$/, '');
      newVal = `${trimmedVal}\n\n${formattedQuote}`;
      newCursorPos = newVal.length;
    }

    // 1. Affecter la nouvelle valeur
    textarea.value = newVal;

    // 2. Redonner le focus et positionner le curseur après la citation
    textarea.focus();
    textarea.setSelectionRange(newCursorPos, newCursorPos);

    // 3. Déclencher les événements Angular pour activer le bouton "Envoyer" et l'auto-resize
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));

    // 4. Faire défiler le textarea vers le bas pour afficher le curseur actif
    textarea.scrollTop = textarea.scrollHeight;
  }

  /**
   * Gestionnaire du clic sur la pilule "Citer".
   * @param {MouseEvent} e
   */
  function handleQuoteClick(e) {
    e.preventDefault();
    e.stopPropagation();

    const selection = window.getSelection();
    const rawText = selection ? selection.toString() : '';
    if (!rawText || rawText.trim().length < 2) {
      hideFloatingPill();
      return;
    }

    const synthText = synthesizeQuote(rawText);
    if (synthText) {
      insertQuoteIntoChatInput(synthText);
    }

    // Effacer la sélection native du navigateur
    if (selection.removeAllRanges) {
      selection.removeAllRanges();
    }
    hideFloatingPill();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 5. Écouteurs de Sélection & Cycle de Vie
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Vérifie la sélection de texte active de manière temporisée (debounced).
   */
  function checkSelection() {
    if (selectionCheckTimeout) {
      clearTimeout(selectionCheckTimeout);
    }
    selectionCheckTimeout = setTimeout(function () {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        hideFloatingPill();
        return;
      }

      const selectedText = selection.toString().trim();
      if (selectedText.length < 3) {
        hideFloatingPill();
        return;
      }

      const range = selection.getRangeAt(0);
      // Valider que le début et la fin de sélection sont situés dans une réponse IA
      if (!isInsideAiMessage(range.startContainer) || !isInsideAiMessage(range.endContainer)) {
        hideFloatingPill();
        return;
      }

      showFloatingPill(range);
    }, 60);
  }

  /**
   * Masque la pilule si l'utilisateur clique en dehors.
   * @param {MouseEvent} e
   */
  function handleDocumentMouseDown(e) {
    if (quotePill && quotePill.contains(e.target)) {
      return;
    }
    hideFloatingPill();
  }

  /**
   * Initialise le module ChatQuote.
   */
  function initChatQuote() {
    if (isListening) return;

    document.addEventListener('mouseup', checkSelection, true);
    document.addEventListener('keyup', checkSelection, true);
    document.addEventListener('mousedown', handleDocumentMouseDown, true);

    isListening = true;
    console.log('[MM] Module ChatQuote (Quote-to-Prompt) initialisé');
  }

  /**
   * Nettoie et désactive le module ChatQuote.
   */
  function cleanupChatQuote() {
    if (!isListening) return;

    document.removeEventListener('mouseup', checkSelection, true);
    document.removeEventListener('keyup', checkSelection, true);
    document.removeEventListener('mousedown', handleDocumentMouseDown, true);

    if (selectionCheckTimeout) {
      clearTimeout(selectionCheckTimeout);
      selectionCheckTimeout = null;
    }

    hideFloatingPill();
    if (quotePill && quotePill.parentNode) {
      quotePill.parentNode.removeChild(quotePill);
    }
    quotePill = null;
    isListening = false;

    console.log('[MM] Module ChatQuote nettoyé');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Exposition dans le namespace global MM
  // ═══════════════════════════════════════════════════════════════════════

  window.MM.initChatQuote = initChatQuote;
  window.MM.cleanupChatQuote = cleanupChatQuote;
  window.MM.synthesizeQuote = synthesizeQuote; // Exposé pour vérification et tests
})();
