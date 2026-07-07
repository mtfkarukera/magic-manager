// rpcclient.js — Client RPC pour l'API NotebookLM (batchexecute)
// Auteur : MTF Karukera | Licence : MPL-2.0
//
// Gère la communication RPC en arrière-plan avec l'API Google batchexecute.
// Ce module s'exécute dans le content script sous l'origine notebooklm.google.com.
// Il utilise les cookies de session implicites du navigateur et extrait le token CSRF.

'use strict';

(function () {
  // Namespace global
  window.MM = window.MM || {};

  // ═══════════════════════════════════════════════════════════════════════
  // Classes d'erreurs normalisées pour la résilience
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Levée quand la structure d'une réponse RPC ne correspond plus au schéma connu
   * (signe probable d'un changement d'API de la part de Google).
   */
  class RpcApiChangedError extends Error {
    constructor(rpcId) {
      super(`L'API NotebookLM a été modifiée (RPC: ${rpcId}). Mise à jour requise.`);
      this.name = 'RpcApiChangedError';
      this.rpcId = rpcId;
    }
  }

  /**
   * Levée pour toute autre erreur de communication RPC (réponse vide, HTTP 4xx/5xx).
   */
  class RpcError extends Error {
    constructor(rpcId, code, detail) {
      super(`Erreur RPC ${rpcId} [${code}] : ${detail}`);
      this.name = 'RpcError';
      this.rpcId = rpcId;
      this.code = code;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 1. ENCODEUR (batchexecute payload format)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Construit la structure de requête triple-imbriquée pour Google.
   */
  function encodeRpcRequest(rpcId, params) {
    const paramsJson = JSON.stringify(params);
    const inner = [rpcId, paramsJson, null, 'generic'];
    return [[inner]];
  }

  /**
   * Construit le corps de la requête HTTP f.req encodé.
   */
  function buildRequestBody(rpcRequest, csrfToken) {
    const fReq = JSON.stringify(rpcRequest);
    const parts = [`f.req=${encodeURIComponent(fReq)}`];
    if (csrfToken) {
      parts.push(`at=${encodeURIComponent(csrfToken)}`);
    }
    return parts.join('&') + '&';
  }

  /**
   * Construit les paramètres de recherche de l'URL batchexecute.
   */
  function buildQueryParams(rpcId) {
    return new URLSearchParams({
      rpcids: rpcId,
      'source-path': '/',
      hl: 'fr',
      rt: 'c' // Mode réponse chunked
    }).toString();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2. DÉCODEUR (chunked response parser)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Enlève le préfixe de protection anti-XSSI de Google.
   */
  function stripAntiXssi(response) {
    return response.replace(/^\)\]}'[\r\n]+/, '');
  }

  /**
   * Parseur chunked résilient basé sur la longueur (byte-count).
   */
  function parseChunkedResponse(response) {
    if (!response || !response.trim()) return [];

    const chunks = [];
    const lines = response.trim().split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i].trim();

      if (!line) {
        i++;
        continue;
      }

      // Si la ligne est un en-tête de taille de chunk (nombre)
      if (/^\d+$/.test(line)) {
        i++; // Avancer vers le payload JSON du chunk
        if (i < lines.length) {
          try {
            const chunk = JSON.parse(lines[i]);
            chunks.push(chunk);
          } catch (e) {
            console.warn('[MM] Erreur lors du parsing d\'un chunk JSON :', e.message);
          }
        }
        i++;
      } else {
        // Fallback : essayer de parser la ligne directement
        try {
          const chunk = JSON.parse(line);
          chunks.push(chunk);
        } catch (e) {
          // Ignorer les lignes non-JSON
        }
        i++;
      }
    }
    return chunks;
  }

  /**
   * Extrait le payload utile pour un RPC ID précis depuis les chunks.
   */
  function extractRpcResult(chunks, rpcId) {
    for (const chunk of chunks) {
      if (!Array.isArray(chunk)) continue;

      const items = (chunk.length > 0 && Array.isArray(chunk[0])) ? chunk : [chunk];

      for (const item of items) {
        if (!Array.isArray(item) || item.length < 3) continue;

        // Cas d'erreur renvoyé par Google
        if (item[0] === 'er' && item[1] === rpcId) {
          throw new Error(`Erreur renvoyée par le serveur Google pour ${rpcId} (code: ${item[2]})`);
        }

        // Cas de succès : ["wrb.fr", rpcId, "json_string", ...]
        if (item[0] === 'wrb.fr' && item[1] === rpcId) {
          const resultData = item[2];
          if (typeof resultData === 'string') {
            try {
              return JSON.parse(resultData);
            } catch (e) {
              return resultData;
            }
          }
          return resultData;
        }
      }
    }
    return null;
  }

  /**
   * Valide la structure globale et extrait le résultat utile.
   */
  function validateAndExtractRpcResponse(rawResponse, rpcId) {
    if (!rawResponse || typeof rawResponse !== 'string') {
      throw new RpcError(rpcId, 'EMPTY_RESPONSE', 'La réponse batchexecute est vide ou mal formée.');
    }

    const chunks = parseChunkedResponse(stripAntiXssi(rawResponse));
    const result = extractRpcResult(chunks, rpcId);

    if (result === null || result === undefined) {
      const preview = rawResponse.slice(0, 500);
      console.error(`[MM] Structure inattendue pour le RPC ${rpcId}. Aperçu de la réponse :`, preview);
      throw new RpcApiChangedError(rpcId);
    }

    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3. SECURE AUTH & TRANSPORT (content script context)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Récupère de façon résiliente le jeton CSRF (SNlM0e) depuis le DOM HTML.
   */
  function getCsrfToken() {
    const html = document.documentElement.innerHTML;
    let match = html.match(/"SNlM0e"\s*:\s*"([^"]+)"/);
    if (match && match[1]) {
      return match[1];
    }
    // Recherche alternative dans toutes les balises script
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const content = script.textContent || '';
      match = content.match(/"SNlM0e"\s*:\s*"([^"]+)"/);
      if (match && match[1]) {
        return match[1];
      }
    }
    return null;
  }

  /**
   * Extrait l'index du compte Google actif (authuser) depuis les query params courants.
   */
  function getAuthuserIndex() {
    const params = new URLSearchParams(window.location.search);
    const authuser = params.get('authuser');
    return authuser ? parseInt(authuser, 10) : 0;
  }

  /**
   * Envoie une requête batchexecute et renvoie le payload extrait.
   */
  async function sendBatchExecute(rpcId, jsonArgs) {
    const csrfToken = getCsrfToken();
    if (!csrfToken) {
      throw new Error('[MM] Impossible de récupérer le jeton CSRF SNlM0e. L\'utilisateur n\'est peut-être pas authentifié.');
    }

    const authuser = getAuthuserIndex();
    const rpcRequest = encodeRpcRequest(rpcId, jsonArgs);
    const body = buildRequestBody(rpcRequest, csrfToken);
    const queryString = buildQueryParams(rpcId);
    const endpoint = `https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute?${queryString}&authuser=${authuser}`;

    console.log(`[MM] Envoi de la requête RPC ${rpcId} (authuser: ${authuser})`);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8'
      },
      credentials: 'include', // Utiliser implicitement les cookies de session existants
      body: body
    });

    if (!response.ok) {
      throw new RpcError(rpcId, `HTTP_${response.status}`, `La requête réseau a échoué avec le statut ${response.status}`);
    }

    const responseText = await response.text();
    return validateAndExtractRpcResponse(responseText, rpcId);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 4. FONCTION MÉTIER (Suppression de source)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Supprime une source de NotebookLM via l'API RPC.
   *
   * @param {string} sourceId   - Identifiant de la source à supprimer.
   * @param {string} notebookId - Identifiant du notebook.
   * @returns {Promise<boolean>} Resolves to true on success.
   */
  async function deleteSource(sourceId, notebookId) {
    if (!sourceId || !notebookId) {
      throw new Error('[MM] deleteSource : Identifiants de source ou de notebook manquants.');
    }

    const rpcId = 'tGMBJ';
    // Params attendus pour tGMBJ : [notebookId, sourceId]
    const params = [notebookId, sourceId];

    console.log(`[MM] Appel RPC deleteSource (notebook: ${notebookId}, source: ${sourceId})`);
    await sendBatchExecute(rpcId, params);
    console.log(`[MM] RPC deleteSource exécuté avec succès pour ${sourceId}`);
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // EXPOSITION PUBLIQUE
  // ═══════════════════════════════════════════════════════════════════════

  window.MM.rpc = {
    deleteSource: deleteSource
  };

  // Exposition des classes d'erreurs pour diagnostics
  window.MM.RpcError = RpcError;
  window.MM.RpcApiChangedError = RpcApiChangedError;
})();
