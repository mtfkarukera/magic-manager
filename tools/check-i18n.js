/**
 * check-i18n.js — Vérification de couverture des traductions
 * Projet : Magic Manager for NotebookLM
 * Auteur : MTF Karukera
 *
 * Compare les clés de la locale de référence (EN) avec chaque locale cible
 * et signale les clés manquantes, les messages vides et les placeholders orphelins.
 *
 * Usage : node tools/check-i18n.js
 */

const fs = require('fs');
const path = require('path');

// Répertoire des locales
const LOCALES_DIR = path.join(__dirname, '..', '_locales');
// Locale de référence
const REFERENCE_LOCALE = 'en';
// Locales cibles à vérifier
const TARGET_LOCALES = ['fr', 'de', 'es', 'pt', 'ja', 'vi'];

/**
 * Charge et parse le fichier messages.json d'une locale donnée.
 * @param {string} locale — Code de la locale (ex: 'en', 'fr')
 * @returns {Object|null} — Objet des messages ou null si erreur
 */
function loadMessages(locale) {
    const filePath = path.join(LOCALES_DIR, locale, 'messages.json');
    if (!fs.existsSync(filePath)) {
        return null;
    }
    try {
        const data = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(data);
    } catch (err) {
        console.error(`[MM] ❌ Erreur de parsing pour la locale '${locale}' : ${err.message}`);
        return null;
    }
}

/**
 * Détecte la présence d'un placeholder {mot} dans un message
 * (différent du pattern $PLACEHOLDER$ de WebExtension).
 * @param {string} message — Le message à analyser
 * @returns {boolean}
 */
function hasBracePlaceholder(message) {
    return /\{[a-zA-Z_][a-zA-Z0-9_]*\}/.test(message);
}

/**
 * Point d'entrée : vérifie toutes les locales.
 */
function checkI18n() {
    console.log(`\n[MM] === Vérification des clés i18n ===\n`);

    // ── Chargement de la locale de référence ──────────────────────────────────
    const refData = loadMessages(REFERENCE_LOCALE);
    if (!refData) {
        console.error(`[MM] ❌ Fichier de référence manquant ou invalide : _locales/${REFERENCE_LOCALE}/messages.json`);
        process.exit(1);
    }

    const refKeys = Object.keys(refData);
    const totalKeys = refKeys.length;
    console.log(`[MM] Locale de référence '${REFERENCE_LOCALE}' : ${totalKeys} clés trouvées.\n`);

    let hasErrors = false;

    // ── 1. Vérifications sur le fichier de référence (EN) ─────────────────────

    console.log(`[MM] --- Vérifications sur la locale de référence '${REFERENCE_LOCALE}' ---`);

    // Détection des clés avec message vide
    const emptyMessageKeys = refKeys.filter(key => refData[key].message === '');
    if (emptyMessageKeys.length > 0) {
        emptyMessageKeys.forEach(key => {
            console.error(`[MM] ❌ [${REFERENCE_LOCALE}] Clé avec message vide : '${key}'`);
        });
        hasErrors = true;
    } else {
        console.log(`[MM] ✅ [${REFERENCE_LOCALE}] Aucune clé avec message vide.`);
    }

    // Détection des placeholders {xxx} sans section "placeholders"
    const missingPlaceholderSectionKeys = refKeys.filter(key => {
        const entry = refData[key];
        return hasBracePlaceholder(entry.message) && !entry.placeholders;
    });
    if (missingPlaceholderSectionKeys.length > 0) {
        missingPlaceholderSectionKeys.forEach(key => {
            console.warn(`[MM] ⚠️  [${REFERENCE_LOCALE}] Clé avec {placeholder} dans le message mais sans section "placeholders" : '${key}'`);
        });
        // Avertissements seulement — pas d'erreur bloquante
    } else {
        console.log(`[MM] ✅ [${REFERENCE_LOCALE}] Toutes les clés avec {placeholder} ont une section "placeholders".`);
    }

    console.log('');

    // ── 2. Vérifications sur les locales cibles ────────────────────────────────

    for (const locale of TARGET_LOCALES) {
        const localeData = loadMessages(locale);
        if (!localeData) {
            console.error(`[MM] ❌ [${locale}] Fichier manquant ou invalide.`);
            hasErrors = true;
            continue;
        }

        // Clés manquantes par rapport à la référence
        const missingKeys = refKeys.filter(key => !localeData.hasOwnProperty(key));
        const count = totalKeys - missingKeys.length;
        const percentage = totalKeys === 0 ? 100 : ((count / totalKeys) * 100).toFixed(1);

        if (missingKeys.length > 0) {
            console.log(`[MM] ❌ [${locale}] ${count}/${totalKeys} clés (${percentage}%)`);
            console.log(`[MM]    Clés manquantes (${missingKeys.length}) :`);
            missingKeys.forEach(key => console.log(`[MM]      - ${key}`));
            hasErrors = true;
        } else {
            console.log(`[MM] ✅ [${locale}] ${count}/${totalKeys} clés (100%)`);
        }

        // Détection des messages vides dans la locale cible
        const localeEmptyKeys = Object.keys(localeData).filter(key => localeData[key].message === '');
        if (localeEmptyKeys.length > 0) {
            localeEmptyKeys.forEach(key => {
                console.error(`[MM] ❌ [${locale}] Clé avec message vide : '${key}'`);
            });
            hasErrors = true;
        }
    }

    // ── Résultat final ─────────────────────────────────────────────────────────

    console.log(`\n[MM] ==================================\n`);
    if (hasErrors) {
        console.error(`[MM] ÉCHEC : Au moins une locale est incomplète.\n`);
        process.exit(1);
    } else {
        console.log(`[MM] SUCCÈS : Toutes les locales sont à jour.\n`);
        process.exit(0);
    }
}

checkI18n();
