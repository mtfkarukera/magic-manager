// rpcclient.js — Client RPC pour l'API NotebookLM (stub)
// Auteur : MTF Karukera | Licence : MPL-2.0
//
// Ce module encapsulera les appels à l'API RPC de NotebookLM
// (batchexecute, resumable upload) pour les fonctionnalités
// qui nécessitent une interaction avec le backend Google :
// - Suppression de source (F4)
// - Création de note dans le Studio (F6)
// - Upload de source fusionnée (F2)
//
// ⚠️ Ce module sera implémenté au Sprint 3.
// Note : ce fichier n'est PAS chargé en content script pour l'instant.
// Il sera intégré dans le manifest quand il sera implémenté.

'use strict';

(function () {
  /**
   * Supprime une source d'un carnet NotebookLM via l'API RPC.
   * @param {string} sourceId   - Identifiant de la source.
   * @param {string} notebookId - Identifiant du carnet.
   * @returns {Promise<void>}
   */
  function deleteSource(sourceId, notebookId) {
    return Promise.reject(new Error('[MM] rpcclient.deleteSource() : non implémenté — Sprint 3'));
  }

  /**
   * Crée une note dans le Studio NotebookLM via l'API RPC.
   * @param {string} content    - Contenu de la note.
   * @param {string} notebookId - Identifiant du carnet.
   * @returns {Promise<void>}
   */
  function createNote(content, notebookId) {
    return Promise.reject(new Error('[MM] rpcclient.createNote() : non implémenté — Sprint 4'));
  }

  /**
   * Upload une source fusionnée via resumable upload.
   * @param {Blob}   blob       - Contenu du fichier.
   * @param {string} filename   - Nom du fichier.
   * @param {string} notebookId - Identifiant du carnet.
   * @returns {Promise<void>}
   */
  function uploadMergedSource(blob, filename, notebookId) {
    return Promise.reject(new Error('[MM] rpcclient.uploadMergedSource() : non implémenté — Sprint 4'));
  }

  // Exposition dans le namespace global MM
  window.MM.rpc = {
    deleteSource: deleteSource,
    createNote: createNote,
    uploadMergedSource: uploadMergedSource
  };
})();
