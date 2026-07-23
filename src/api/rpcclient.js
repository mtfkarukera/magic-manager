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
   * Construit le body f.req pour N requêtes RPC empilées dans un seul POST batchexecute.
   * Chaque requête reçoit un index numérique séquentiel comme identifiant interne.
   *
   * @param {Array<{rpcId: string, params: any}>} requests - Liste des requêtes à empiler.
   * @returns {Array} Structure triple-imbriquée multi-RPC.
   */
  function encodeBatchRpcRequests(requests) {
    return [requests.map(function (req, index) {
      return [req.rpcId, JSON.stringify(req.params), null, 'generic'];
    })];
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

        // Cas de succès ou d'erreur applicative wrb.fr : ["wrb.fr", rpcId, resultData, ..., ..., errorArray]
        if (item[0] === 'wrb.fr' && item[1] === rpcId) {
          const resultData = item[2];
          // Si resultData est null et qu'il y a un tableau d'erreur (ex: item[5] = [9] ou [3])
          if (resultData === null && Array.isArray(item[5]) && item[5].length > 0) {
            const errCode = item[5][0];
            throw new RpcError(rpcId, `ERR_CODE_${errCode}`, `Le serveur Google a rejeté la requête pour ${rpcId} (code d'erreur applicatif: ${errCode}).`);
          }

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

  let cachedCsrfToken = null;

  /**
   * Récupère de façon résiliente le jeton CSRF (SNlM0e) depuis le DOM HTML.
   */
  function getCsrfToken() {
    if (cachedCsrfToken) {
      return cachedCsrfToken;
    }
    // Recherche alternative dans toutes les balises script
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const content = script.textContent || '';
      const match = content.match(/"SNlM0e"\s*:\s*"([^"]+)"/);
      if (match && match[1]) {
        cachedCsrfToken = match[1];
        return cachedCsrfToken;
      }
    }
    return null;
  }

  /**
   * Effectue un fetch réseau avec timeout (AbortController) et retries exponentiels sur
   * les erreurs réseau ou les codes de statut HTTP transitoires (429, 500, 502, 503, 504).
   */
  async function fetchWithRetryAndTimeout(url, options = {}, maxRetries = 3, initialDelay = 1000) {
    let retries = 0;
    while (true) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // Timeout de 30s

      try {
        const fetchOptions = {
          ...options,
          signal: controller.signal
        };

        const response = await fetch(url, fetchOptions);
        clearTimeout(timeoutId);

        if (response.ok) {
          return response;
        }

        const transientStatuses = [429, 500, 502, 503, 504];
        if (transientStatuses.includes(response.status) && retries < maxRetries) {
          retries++;
          let delay = initialDelay * Math.pow(2, retries - 1);

          if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After');
            if (retryAfter) {
              const seconds = parseInt(retryAfter, 10);
              if (!isNaN(seconds)) {
                delay = seconds * 1000;
              }
            }
          }

          console.warn(`[MM] Erreur HTTP ${response.status} sur ${url}. Tentative ${retries}/${maxRetries} après ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        return response;

      } catch (err) {
        clearTimeout(timeoutId);
        
        if (err.name === 'AbortError') {
          console.error(`[MM] Requête expirée (timeout 30s) sur ${url}.`);
        }

        if (retries < maxRetries) {
          retries++;
          const delay = initialDelay * Math.pow(2, retries - 1);
          console.warn(`[MM] Erreur réseau (${err.message}) sur ${url}. Tentative ${retries}/${maxRetries} après ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw err;
      }
    }
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

    const response = await fetchWithRetryAndTimeout(endpoint, {
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

  /**
   * Envoie N requêtes dans un seul POST batchexecute.
   * Le query param `rpcids` doit lister tous les IDs RPC séparés par des virgules.
   *
   * @param {Array<{rpcId: string, params: any}>} requests - Requêtes RPC à exécuter.
   * @param {string} notebookId - ID du carnet courant.
   * @returns {Promise<{succeeded: number, failed: number, errors: Array}>}
   */
  async function sendBatchMultiple(requests, notebookId) {
    if (!requests || requests.length === 0) {
      return { succeeded: 0, failed: 0, errors: [] };
    }

    const csrfToken = getCsrfToken();
    if (!csrfToken) {
      throw new Error('[MM] Impossible de récupérer le jeton CSRF.');
    }

    const authuser = getAuthuserIndex();
    const batchRequest = encodeBatchRpcRequests(requests);
    const body = buildRequestBody(batchRequest, csrfToken);

    // Collecter les IDs RPC uniques pour le query param rpcids
    const uniqueRpcIds = [...new Set(requests.map(r => r.rpcId))];
    const sourcePath = notebookId ? `/notebook/${notebookId}` : '/';
    const queryParams = new URLSearchParams({
      rpcids: uniqueRpcIds.join(','),
      'source-path': sourcePath,
      hl: 'fr',
      rt: 'c'
    }).toString();

    const endpoint = `https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute?${queryParams}&authuser=${authuser}`;

    console.log(`[MM] Envoi batch de ${requests.length} requêtes RPC (${uniqueRpcIds.join(', ')})`);

    const response = await fetchWithRetryAndTimeout(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      credentials: 'include',
      body: body
    });

    if (!response.ok) {
      throw new RpcError('BATCH', `HTTP_${response.status}`, `Batch échoué avec HTTP ${response.status}`);
    }

    const responseText = await response.text();
    const chunks = parseChunkedResponse(stripAntiXssi(responseText));

    // Analyser les résultats individuels
    let succeeded = 0;
    let failed = 0;
    const errors = [];

    for (const req of requests) {
      try {
        extractRpcResult(chunks, req.rpcId);
        succeeded++;
      } catch (err) {
        failed++;
        errors.push({ rpcId: req.rpcId, error: err.message });
      }
    }

    console.log(`[MM] Batch terminé : ${succeeded} réussies, ${failed} échouées`);
    return { succeeded, failed, errors };
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
   * Supprime une note via RPC AH0mwd (DELETE_NOTE).
   * @param {string} noteId - ID de la note.
   * @param {string} notebookId - ID du carnet.
   */
  async function deleteNote(noteId, notebookId) {
    const rpcId = 'AH0mwd';
    const params = [notebookId, null, [noteId]];
    console.log(`[MM] Appel RPC deleteNote (note: ${noteId})`);
    await sendBatchExecute(rpcId, params, notebookId);
    return true;
  }

  /**
   * Supprime un artéfact via RPC V5N4be (DELETE_ARTIFACT).
   * @param {string} artifactId - ID de l'artéfact.
   * @param {string} notebookId - ID du carnet.
   */
  async function deleteArtifact(artifactId, notebookId) {
    const rpcId = 'V5N4be';
    const params = [artifactId];
    console.log(`[MM] Appel RPC deleteArtifact (artifact: ${artifactId})`);
    await sendBatchExecute(rpcId, params, notebookId);
    return true;
  }

  /**
   * Récupère la liste des notes avec leurs IDs via RPC cFji9.
   */
  async function getNotesAndMindMaps(notebookId) {
    if (!notebookId) {
      throw new Error('[MM] getNotesAndMindMaps : notebookId manquant.');
    }
    const rpcId = 'cFji9';
    const params = [notebookId];
    console.log(`[MM] Appel RPC getNotesAndMindMaps (notebook: ${notebookId})`);
    return await sendBatchExecute(rpcId, params, notebookId);
  }

  /**
   * Récupère la liste des artéfacts avec leurs IDs via RPC gArtLc.
   */
  async function getArtifactsList(notebookId) {
    if (!notebookId) {
      throw new Error('[MM] getArtifactsList : notebookId manquant.');
    }
    const rpcId = 'gArtLc';
    const params = [[2], notebookId, 'NOT artifact.status = "ARTIFACT_STATUS_SUGGESTED"'];
    console.log(`[MM] Appel RPC getArtifactsList (notebook: ${notebookId})`);
    return await sendBatchExecute(rpcId, params, notebookId);
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
   * Liste tous les carnets de l'utilisateur.
   * RPC : wXbhsf | source-path : "/" (contexte global)
   * @returns {Promise<Array<{id: string, title: string, sourceCount: number, isShared: boolean, modifiedAt: number|null}>>}
   */
  async function listNotebooks() {
    const rpcId = 'wXbhsf';
    const params = [null, 1, null, [2]];
    console.log('[MM] Appel RPC listNotebooks (wXbhsf)');
    const result = await sendBatchExecute(rpcId, params, null);
    if (!Array.isArray(result) || !Array.isArray(result[0])) return [];
    return result[0]
      .filter(data => Array.isArray(data) && typeof data[2] === 'string')
      .map(data => ({
        id: data[2],
        title: (data[0] || '').replace(/^thought\n/, ''),
        sourceCount: Array.isArray(data[1]) ? data[1].length : 0,
        isShared: !!(data[5] && data[5][1]),
        modifiedAt: data[5] && data[5][5] ? data[5][5][0] * 1000 : null
      }));
  }

  /**
   * Ajoute une source URL dans un carnet.
   * RPC : izAoDd | source-path : "/notebook/<targetNotebookId>"
   */
  async function addUrlSource(targetNotebookId, url) {
    if (!targetNotebookId || !url) {
      throw new Error('[MM] addUrlSource : targetNotebookId ou url manquant.');
    }
    const rpcId = 'izAoDd';
    const params = [
      [[null, null, [url], null, null, null, null, null, null, null, 1]],
      targetNotebookId,
      [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]]]
    ];
    console.log(`[MM] Appel RPC addUrlSource (notebook: ${targetNotebookId}, url: ${url})`);
    const result = await sendBatchExecute(rpcId, params, targetNotebookId);
    console.log('[MM] RPC addUrlSource exécuté avec succès.');
    return result;
  }

  /**
   * Ajoute une source YouTube dans un carnet.
   * RPC : izAoDd | source-path : "/notebook/<targetNotebookId>"
   */
  async function addYoutubeSource(targetNotebookId, url) {
    if (!targetNotebookId || !url) {
      throw new Error('[MM] addYoutubeSource : targetNotebookId ou url manquant.');
    }
    const rpcId = 'izAoDd';
    const params = [
      [[null, null, null, null, null, null, null, [url], null, null, 1]],
      targetNotebookId,
      [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]]]
    ];
    console.log(`[MM] Appel RPC addYoutubeSource (notebook: ${targetNotebookId})`);
    const result = await sendBatchExecute(rpcId, params, targetNotebookId);
    console.log('[MM] RPC addYoutubeSource exécuté avec succès.');
    return result;
  }

  /**
   * Résout le type MIME Drive exact d'après le type (kind) et les métadonnées.
   */
  function resolveDriveMimeType(kind, rawMime) {
    if (typeof rawMime === 'string' && rawMime.length > 5) {
      return rawMime;
    }
    switch (kind) {
      case 1:  // GOOGLE_DOCS
        return 'application/vnd.google-apps.document';
      case 2:  // GOOGLE_SLIDES
        return 'application/vnd.google-apps.presentation';
      case 14: // GOOGLE_SPREADSHEET
        return 'application/vnd.google-apps.spreadsheet';
      case 3:  // PDF
        return 'application/pdf';
      default:
        return 'application/vnd.google-apps.document';
    }
  }

  /**
   * Ajoute une source Google Drive (izAoDd).
   */
  async function addDriveSource(targetNotebookId, fileId, mimeType, title) {
    if (!targetNotebookId || !fileId) {
      throw new Error('[MM] addDriveSource : targetNotebookId ou fileId manquant.');
    }
    const rpcId = 'izAoDd';
    const finalMime = mimeType || 'application/vnd.google-apps.document';
    const sourceData = [
      [fileId, finalMime, 1, title || ''],
      null, null, null, null, null, null, null, null, null, 1
    ];
    const params = [
      [sourceData],
      targetNotebookId,
      [2],
      [1, null, null, null, null, null, null, null, null, null, [1]]
    ];
    console.log(`[MM] Appel RPC addDriveSource (notebook: ${targetNotebookId}, drive: ${fileId}, mime: ${finalMime})`);
    const result = await sendBatchExecute(rpcId, params, targetNotebookId);
    console.log('[MM] RPC addDriveSource exécuté avec succès.');
    return result;
  }

  /**
   * Crée un nouveau carnet avec le titre spécifié (RPC CCqFvf).
   * @param {string} title - Titre du carnet à créer
   * @returns {Promise<{id: string, title: string, sourceCount: number}>}
   */
  async function createNotebook(title) {
    if (!title || !title.trim()) {
      throw new Error('[MM] createNotebook : le titre est requis.');
    }
    const rpcId = 'CCqFvf';
    const params = [
      title.trim(),
      null,
      null,
      [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]]]
    ];
    console.log(`[MM] Appel RPC createNotebook (titre: ${title})`);
    const result = await sendBatchExecute(rpcId, params, null);
    // En accord avec notebooklm-py-ref : result[0] = titre, result[2] = UUID de carnet
    const notebookId = (Array.isArray(result) && typeof result[2] === 'string' && result[2].length > 0)
      ? result[2]
      : (Array.isArray(result) && typeof result[0] === 'string' && result[0].length > 20 ? result[0] : null);
    if (!notebookId || typeof notebookId !== 'string') {
      throw new Error('Impossible de créer le carnet (réponse inattendue du serveur).');
    }
    console.log(`[MM] Carnet créé avec succès (titre: "${title.trim()}", UUID: ${notebookId})`);
    return { id: notebookId, title: title.trim(), sourceCount: 0 };
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
    const startResponse = await fetchWithRetryAndTimeout(uploadStartUrl, {
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
    const finalizeResponse = await fetchWithRetryAndTimeout(uploadUrl, {
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
  /**
   * Extrait le HTML brut depuis result[4][1].
   * Retourne null si le HTML n'est pas disponible ou invalide.
   */
  function extractHtmlFromResult(result) {
    if (!Array.isArray(result) || result.length <= 4) return null;
    const block = result[4];
    if (!Array.isArray(block) || block.length <= 1) return null;
    const candidate = block[1];
    return (typeof candidate === 'string' && candidate.length > 0)
      ? candidate
      : null;
  }

  /**
   * Extrait le texte brut depuis result[3][0].
   * Parcourt récursivement le tableau imbriqué de blocs texte.
   */
  function extractTextFromResult(result) {
    if (!Array.isArray(result) || result.length <= 3) return null;
    if (!Array.isArray(result[3]) || result[3].length === 0) return null;

    const textBlocks = result[3][0];
    if (!Array.isArray(textBlocks)) return null;

    const texts = [];
    function recurse(node) {
      if (typeof node === 'string' && node.length > 0) {
        texts.push(node);
      } else if (Array.isArray(node)) {
        for (const child of node) {
          recurse(child);
        }
      }
    }
    recurse(textBlocks);
    return texts.length > 0 ? texts.join('\n') : null;
  }

  /**
   * Extrait le contenu d'une réponse GET_SOURCE selon le format demandé.
   * Avec fallback explicite si le HTML est absent en mode 'html'.
   */
  function extractContentFromResult(result, format) {
    if (!Array.isArray(result)) return null;

    if (format === 'html') {
      // 1. Tenter l'extraction HTML
      const html = extractHtmlFromResult(result);
      if (html) {
        // Convertir via turndown.js
        if (typeof window.MM?.convertHtmlToMarkdown === 'function') {
          return window.MM.convertHtmlToMarkdown(html);
        }
        console.warn('[MM] convertHtmlToMarkdown non disponible, retour HTML brut');
        return html;
      }
      // 2. Fallback explicite vers le texte brut
      console.warn('[MM] Pas de HTML disponible pour cette source (YouTube, audio...), fallback texte brut.');
      return extractTextFromResult(result);
    }

    // Mode texte brut
    return extractTextFromResult(result) || extractHtmlFromResult(result);
  }

  /**
   * Récupère le contenu d'une source via son ID et notebookId (RPC hizoJc).
   * Supporte deux formats : 'html' (Markdown enrichi via turndown) ou 'text' (texte brut).
   */
  async function getSourceContent(sourceId, notebookId, { format = 'html' } = {}) {
    if (!sourceId || !notebookId) {
      throw new Error('[MM] getSourceContent : sourceId ou notebookId manquant.');
    }
    const rpcId = 'hizoJc';
    const selector = format === 'html' ? [3] : [2];
    const params = [[sourceId], selector, selector];
    console.log(`[MM] Appel RPC getSourceContent (notebook: ${notebookId}, source: ${sourceId}, format: ${format})`);
    const result = await sendBatchExecute(rpcId, params, notebookId);

    const content = extractContentFromResult(result, format);
    if (!content) {
      console.error(`[MM] getSourceContent : contenu introuvable dans la réponse pour ${sourceId}`);
      throw new Error(`Contenu introuvable pour la source ${sourceId}`);
    }

    console.log(`[MM] Contenu récupéré pour ${sourceId} : ${content.length} caractères`);
    return content;
  }

  /**
   * Récupère le HTML brut d'une source (sans conversion Markdown).
   * Utilisé par le pipeline PDF structuré (walker DOM jsPDF).
   */
  async function getSourceContentHtml(sourceId, notebookId) {
    if (!sourceId || !notebookId) {
      throw new Error('[MM] getSourceContentHtml : sourceId ou notebookId manquant.');
    }
    const rpcId = 'hizoJc';
    const params = [[sourceId], [3], [3]];
    console.log(`[MM] Appel RPC getSourceContentHtml (notebook: ${notebookId}, source: ${sourceId})`);
    const result = await sendBatchExecute(rpcId, params, notebookId);
    return extractHtmlFromResult(result);
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

    // Stratégie de détection robuste : la liste de sources est le premier
    // sous-tableau dont les éléments sont eux-mêmes des tableaux contenant
    // un string en position [0] ou [0][0] (le sourceId UUID).
    var sourcesList = result[0];

    // Tester si result[0] contient directement des source-entries
    // en vérifiant si le premier élément array a un string UUID en position [0]
    var firstArr = sourcesList.find(function (e) { return Array.isArray(e); });
    if (firstArr) {
      var probe = firstArr[0];
      if (Array.isArray(probe)) {
        // probe est un sous-tableau : c'est peut-être la vraie liste de sources
        // OU c'est un sourceId wrappé [uuid]
        if (Array.isArray(probe[0])) {
          // probe[0] est aussi un tableau → firstArr est un conteneur de sources
          console.log('[MM] getNotebookSources : niveau supplémentaire détecté (result[0][idx][0] est Array)');
          sourcesList = firstArr;
        } else if (typeof probe[0] === 'string' && probe[0].length > 10) {
          // probe = [uuid, title, ...] → firstArr EST la liste de sources (enveloppée dans result[0])
          console.log('[MM] getNotebookSources : sources dans result[0][0]');
          sourcesList = firstArr;
        }
      }
    }

    console.log('[MM] getNotebookSources : ' + sourcesList.filter(function (s) { return Array.isArray(s); }).length + ' sources dans sourcesList');

    // Chaque source : [sourceId, title, ..., typeCode(slot[16])]
    // Le sourceId peut être un string direct OU un tableau [uuid]
    return sourcesList
      .filter(src => Array.isArray(src))
      .map((src, index) => {
        var rawId = src[0];
        var id = "";

        // 1. Extraction de l'UUID de source NotebookLM
        if (typeof rawId === 'string') {
          id = rawId;
        } else if (Array.isArray(rawId)) {
          if (typeof rawId[0] === 'string') {
            id = rawId[0];
          } else if (rawId[0] === null && Array.isArray(rawId[2]) && typeof rawId[2][0] === 'string') {
            id = rawId[2][0];
          }
        }
        
        // 2. Extraction du type (kind)
        var kind = undefined;
        if (src[2] && Array.isArray(src[2]) && src[2].length > 4) {
          kind = src[2][4];
        } else if (src[16] !== undefined) {
          kind = src[16];
        }

        const url = (src[2] && src[2][7] && src[2][7][0]) || null;
        const youtubeUrl = (src[2] && src[2][5] && src[2][5][0]) || null;

        // Helper de validation d'un ID Google Drive (20+ chars, non-UUID v4)
        const isValidDriveId = (str) => {
          if (typeof str !== 'string' || str.length < 20) return false;
          // Rejeter les UUID v4 (36 chars avec 4 tirets)
          if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)) return false;
          return /^[A-Za-z0-9_-]{20,}$/.test(str);
        };

        // Helper de déballage récursif des structures imbriquées d'API Google (ex: src[2][0] = [[["id", ...]]])
        const findDriveIdInSlot = (slot) => {
          if (typeof slot === 'string' && isValidDriveId(slot)) {
            return slot;
          }
          if (Array.isArray(slot)) {
            for (let i = 0; i < slot.length; i++) {
              const found = findDriveIdInSlot(slot[i]);
              if (found) return found;
            }
          }
          return null;
        };

        // 3. Extraction certifiée du driveFileId en 4 niveaux
        var driveFileId = null;

        // Niveau 1 : Via le descripteur metadata[9] (fichiers Drive téléversés)
        if (src[2] && src[2][9]) {
          driveFileId = findDriveIdInSlot(src[2][9]);
        }

        // Niveau 2 : Emplacement metadata[0] (src[2][0]) — Google Docs natifs (sources_add_drive.yaml:105)
        if (!driveFileId && src[2] && src[2][0]) {
          driveFileId = findDriveIdInSlot(src[2][0]);
        }

        // Niveau 3 : Extraction Regex dans l'URL canonique src[2][7][0]
        if (!driveFileId && url) {
          const match = url.match(/(?:file\/)?d\/([A-Za-z0-9_-]{20,})/);
          if (match && isValidDriveId(match[1])) {
            driveFileId = match[1];
          }
        }

        // Niveau 4 : Extraction Regex dans l'URL secondaire src[2][5][0]
        if (!driveFileId && youtubeUrl) {
          const matchYt = youtubeUrl.match(/(?:file\/)?d\/([A-Za-z0-9_-]{20,})/);
          if (matchYt && isValidDriveId(matchYt[1])) {
            driveFileId = matchYt[1];
          }
        }

        return {
          id: id,
          title: src[1],
          kind: kind,
          url: url,
          driveFileId: driveFileId,
          driveMimeType: resolveDriveMimeType(kind, (src[2] && src[2][9] && src[2][9][2]) || (src[2] && src[2][19])),
          topLevelMime: (src[2] && src[2][19]) || null
        };
      })
      .filter(s => typeof s.id === 'string' && s.id.length > 5);
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
    deleteNote: deleteNote,
    deleteArtifact: deleteArtifact,
    sendBatchMultiple: sendBatchMultiple,
    getNotesAndMindMaps: getNotesAndMindMaps,
    getArtifactsList: getArtifactsList,
    sendBatchExecute: sendBatchExecute,
    _sendBatchExecute: sendBatchExecute,
    addTextSource: addTextSource,
    addUrlSource: addUrlSource,
    addYoutubeSource: addYoutubeSource,
    addDriveSource: addDriveSource,
    listNotebooks: listNotebooks,
    createNotebook: createNotebook,
    uploadBlob: uploadBlob,
    getSourceContent: getSourceContent,
    getSourceContentHtml: getSourceContentHtml,
    getNotebookSources: getNotebookSources,
    createNoteRpc: createNoteRpc
  };

  // Exposition des classes d'erreurs pour diagnostics
  window.MM.RpcError = RpcError;
  window.MM.RpcApiChangedError = RpcApiChangedError;

  // Capture immédiate du jeton CSRF au chargement précoce du script
  try {
    getCsrfToken();
  } catch (e) {
    console.debug('[MM] Capture précoce du CSRF reportée :', e);
  }
})();
