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
  function buildQueryParams(rpcId, notebookId) {
    const params = {
      rpcids: rpcId,
      'source-path': notebookId ? `/notebook/${notebookId}` : '/',
      hl: 'fr',
      rt: 'c' // Mode réponse chunked
    };
    return new URLSearchParams(params).toString();
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
  async function sendBatchExecute(rpcId, jsonArgs, notebookId) {
    const csrfToken = getCsrfToken();
    if (!csrfToken) {
      throw new Error('[MM] Impossible de récupérer le jeton CSRF SNlM0e. L\'utilisateur n\'est peut-être pas authentifié.');
    }

    const authuser = getAuthuserIndex();
    const rpcRequest = encodeRpcRequest(rpcId, jsonArgs);
    const body = buildRequestBody(rpcRequest, csrfToken);
    const queryString = buildQueryParams(rpcId, notebookId);
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
    // Params attendus pour tGMBJ : [[[sourceId]]] (triple-nested)
    const params = [[[sourceId]]];

    console.log(`[MM] Appel RPC deleteSource (notebook: ${notebookId}, source: ${sourceId})`);
    await sendBatchExecute(rpcId, params, notebookId);
    console.log(`[MM] RPC deleteSource exécuté avec succès pour ${sourceId}`);
    return true;
  }

  /**
   * Extraie la première string d'une structure imbriquée de tableaux.
   */
  function extractFirstString(data) {
    if (typeof data === 'string') return data;
    if (Array.isArray(data) && data.length > 0) {
      return extractFirstString(data[0]);
    }
    return null;
  }

  /**
   * Ajoute une source de texte brute (Markdown) au notebook.
   */
  async function addTextSource(notebookId, title, content) {
    if (!notebookId || !title || content === undefined) {
      throw new Error('[MM] addTextSource : notebookId, title ou content manquant.');
    }
    const rpcId = 'izAoDd';
    // Format teng-lin golden test : 11 éléments dans le bloc template, type 2 (texte collé)
    const params = [
      [[null, [title, content], null, 2, null, null, null, null, null, null, 1]],
      notebookId,
      [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]]]
    ];
    console.log(`[MM] Appel RPC addTextSource (notebook: ${notebookId}, titre: ${title})`);
    await sendBatchExecute(rpcId, params, notebookId);
    console.log(`[MM] RPC addTextSource exécuté avec succès.`);
    return true;
  }

  /**
   * Upload un fichier binaire (Blob) via resumable upload 3 étapes.
   */
  async function uploadBlob(notebookId, blob, filename) {
    if (!notebookId || !blob || !filename) {
      throw new Error('[MM] uploadBlob : notebookId, blob ou filename manquant.');
    }
    const authuser = getAuthuserIndex();

    // Étape 1 : Enregistrer la source (RPC o4cbdc)
    const registerRpcId = 'o4cbdc';
    const registerParams = [
      [[filename]],
      notebookId,
      [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]]]
    ];
    console.log(`[MM] Étape 1 : Enregistrement de la source fichier ${filename} via RPC o4cbdc`);
    const registerResult = await sendBatchExecute(registerRpcId, registerParams, notebookId);

    const sourceId = extractFirstString(registerResult);
    if (!sourceId) {
      throw new Error('[MM] Impossible de récupérer le SOURCE_ID depuis la réponse d\'enregistrement.');
    }
    console.log(`[MM] Source enregistrée avec ID : ${sourceId}`);

    // Étape 2 : Démarrer la session d'upload (POST resumable)
    const uploadStartUrl = `https://notebooklm.google.com/upload/_/?authuser=${authuser}`;
    const startBody = JSON.stringify({
      PROJECT_ID: notebookId,
      SOURCE_NAME: filename,
      SOURCE_ID: sourceId
    });

    console.log(`[MM] Étape 2 : Initialisation de la session d'upload resumable`);
    const startResponse = await fetch(uploadStartUrl, {
      method: 'POST',
      headers: {
        'Accept': '*/*',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'x-goog-authuser': String(authuser),
        'x-goog-upload-command': 'start',
        'x-goog-upload-header-content-length': String(blob.size),
        'x-goog-upload-protocol': 'resumable'
      },
      body: startBody
    });

    if (!startResponse.ok) {
      throw new Error(`[MM] Impossible d'initialiser la session d'upload (HTTP ${startResponse.status})`);
    }

    const uploadUrl = startResponse.headers.get('x-goog-upload-url');
    if (!uploadUrl) {
      throw new Error('[MM] En-tête x-goog-upload-url manquant dans la réponse d\'initialisation.');
    }

    // Étape 3 : Envoyer le contenu binaire (POST finalize)
    console.log(`[MM] Étape 3 : Envoi du Blob binaire (${blob.size} octets)`);
    const finalizeResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Accept': '*/*',
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
        'x-goog-authuser': String(authuser),
        'x-goog-upload-command': 'upload, finalize',
        'x-goog-upload-offset': '0'
      },
      body: blob
    });

    if (!finalizeResponse.ok) {
      throw new Error(`[MM] Échec de l'envoi final du Blob (HTTP ${finalizeResponse.status})`);
    }

    console.log(`[MM] Fichier ${filename} uploadé avec succès.`);
    return true;
  }

  /**
   * Extrait le texte d'une réponse GET_SOURCE (hizoJc).
   * Structure de la réponse Google :
   *   result[0] : descripteur (titre, métadonnées avec les URLs d'origine et de Drive)
   *   result[3] : bloc de texte brut. Le contenu texte est à result[3][0].
   *   result[4] : bloc HTML. L'HTML brut est à result[4][1].
   *
   * ⚠️ Ne jamais parcourir récursivement l'ensemble de la réponse sans cibler
   * les index, car cela capture en premier les URLs de Drive Viewer du descripteur.
   */
  function extractTextFromGetSourceResult(result) {
    if (!Array.isArray(result)) return null;

    // 1. Tenter en priorité de récupérer le HTML brut (result[4][1]) et le convertir en Markdown
    if (result.length > 4 && Array.isArray(result[4]) && result[4].length > 1) {
      const htmlCandidate = result[4][1];
      if (typeof htmlCandidate === 'string' && htmlCandidate.length > 0) {
        try {
          const markdown = window.MM.htmlToMarkdown(htmlCandidate);
          if (markdown && markdown.trim().length > 0) {
            console.log('[MM] Texte extrait et structuré avec succès depuis le HTML (RPC hizoJc).');
            return markdown;
          }
        } catch (htmlErr) {
          console.error('[MM] Échec de la conversion HTML vers Markdown :', htmlErr);
        }
      }
    }

    // 2. Repli (Fallback) : Extraction ciblée dans le bloc de texte brut (result[3][0])
    if (result.length > 3 && Array.isArray(result[3]) && result[3].length > 0) {
      const textBlocks = result[3][0];
      if (Array.isArray(textBlocks)) {
        const texts = [];
        
        function walkText(node) {
          if (typeof node === 'string' && node.length > 0) {
            texts.push(node);
          } else if (Array.isArray(node)) {
            for (const child of node) {
              walkText(child);
            }
          }
        }
        
        walkText(textBlocks);
        if (texts.length > 0) {
          console.log('[MM] Texte brut extrait depuis le fallback text (RPC hizoJc).');
          return texts.join('\n');
        }
      }
    }

    return null;
  }

  /**
   * Récupère le texte complet d'une source via son ID et notebookId (RPC hizoJc).
   */
  async function getSourceContent(sourceId, notebookId) {
    if (!sourceId || !notebookId) {
      throw new Error('[MM] getSourceContent : sourceId ou notebookId manquant.');
    }
    const rpcId = 'hizoJc';
    const params = [[sourceId], [2], [2]];
    console.log(`[MM] Appel RPC getSourceContent (notebook: ${notebookId}, source: ${sourceId})`);
    const result = await sendBatchExecute(rpcId, params, notebookId);

    const text = extractTextFromGetSourceResult(result);
    if (!text) {
      console.error(`[MM] getSourceContent : texte introuvable dans la réponse pour ${sourceId}`);
      throw new Error(`Texte introuvable pour la source ${sourceId}`);
    }

    console.log(`[MM] Texte récupéré pour ${sourceId} : ${text.length} caractères`);
    return text;
  }

  /**
   * Récupère toutes les sources d'un carnet avec leurs IDs et titres (RPC rLM1Ne).
   */
  async function getNotebookSources(notebookId) {
    if (!notebookId) {
      throw new Error('[MM] getNotebookSources : notebookId manquant.');
    }
    const rpcId = 'rLM1Ne';
    const params = [
      notebookId,
      null,
      [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]]],
      null,
      0
    ];
    console.log(`[MM] Appel RPC getNotebookSources (notebook: ${notebookId})`);
    // Pas de source_path pour GET_NOTEBOOK
    const result = await sendBatchExecute(rpcId, params, null);
    if (!Array.isArray(result) || !Array.isArray(result[0])) {
      return [];
    }
    // Chaque source : [sourceId, title, ..., typeCode(slot[16])]
    return result[0].map(src => ({
      id: src[0],
      title: src[1],
      kind: src[16]
    }));
  }

  /**
   * Crée une note utilisateur en 2 étapes via RPC :
   * 1. Kickoff via CREATE_NOTE (CYK0Xb) avec contenu vide pour obtenir le noteId.
   * 2. Mutation via UPDATE_NOTE (cYAfTb) pour définir le titre et le contenu final.
   */
  async function createNoteRpc(notebookId, title, content) {
    if (!notebookId || !title || content === undefined) {
      throw new Error('[MM] createNoteRpc : notebookId, title ou content manquant.');
    }

    // Étape 1 : Création de la note (CYK0Xb)
    const createRpcId = 'CYK0Xb';
    const createParams = [
      notebookId,
      "",
      [1],
      null,
      title
    ];

    console.log(`[MM] Étape 1 : Création de la note "${title}" via RPC CYK0Xb`);
    const createResult = await sendBatchExecute(createRpcId, createParams, notebookId);
    
    // Le noteId se trouve à l'index [0] ou [0][0] du résultat
    const noteId = extractFirstString(createResult);
    if (!noteId) {
      throw new Error('[MM] Impossible de récupérer le noteId de la note créée.');
    }
    console.log(`[MM] Note créée avec ID : ${noteId}`);

    // Étape 2 : Remplissage et mutation de la note (cYAfTb)
    const updateRpcId = 'cYAfTb';
    const updateParams = [
      notebookId,
      noteId,
      [
        [[content, title, [], 0]]
      ]
    ];

    console.log(`[MM] Étape 2 : Finalisation de la note ${noteId} via RPC cYAfTb`);
    await sendBatchExecute(updateRpcId, updateParams, notebookId);
    console.log(`[MM] Note ${noteId} finalisée avec succès.`);
    return noteId;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // EXPOSITION PUBLIQUE
  // ═══════════════════════════════════════════════════════════════════════

  window.MM.rpc = {
    deleteSource: deleteSource,
    addTextSource: addTextSource,
    uploadBlob: uploadBlob,
    getSourceContent: getSourceContent,
    getNotebookSources: getNotebookSources,
    createNoteRpc: createNoteRpc
  };

  // Exposition des classes d'erreurs pour diagnostics
  window.MM.RpcError = RpcError;
  window.MM.RpcApiChangedError = RpcApiChangedError;
})();
