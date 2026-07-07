# Architecture — Magic Manager for NotebookLM

## Vue d'ensemble

Magic Manager est une extension Firefox (Manifest V3) de type **content-script-only**. Elle ne possède ni background script, ni service worker permanent. Toute la logique s'exécute dans le contexte de la page NotebookLM via des content scripts injectés.

## Arborescence du projet

```
magic-manager/
├── manifest.json              # Manifeste MV3 de l'extension
├── src/
│   ├── api/
│   │   └── rpcclient.js       # Client RPC pour l'API NotebookLM (batchexecute)
│   ├── content/
│   │   ├── main.js            # Point d'entrée — orchestrateur des modules
│   │   ├── search.js          # Module de recherche globale
│   │   ├── merge.js           # Module de fusion intelligente
│   │   ├── export.js          # Module d'exports simplifiés
│   │   ├── delete.js          # Module de suppression en ligne
│   │   ├── syntax.js          # Module de coloration syntaxique
│   │   └── chat-export.js     # Module d'export du chat
│   ├── popup/
│   │   ├── popup.html         # Interface de la popup de paramètres
│   │   ├── popup.js           # Logique de la popup
│   │   └── popup.css          # Styles de la popup
│   └── styles/
│       └── content.css        # Styles injectés dans la page NotebookLM
├── _locales/
│   ├── en/messages.json       # Locale par défaut (anglais)
│   ├── fr/messages.json       # Français
│   ├── es/messages.json       # Espagnol
│   ├── de/messages.json       # Allemand
│   ├── pt/messages.json       # Portugais brésilien
│   ├── ja/messages.json       # Japonais
│   └── vi/messages.json       # Vietnamien
├── icons/
│   ├── icon-48.png
│   └── icon-128.png
├── tools/
│   └── check-i18n.js          # Vérification de couverture i18n
├── README.md
├── ARCHITECTURE.md
├── CHANGELOG.md
├── AGENTS.md
├── spec.md
├── LICENSE
└── .gitignore
```

## Flux de données

```mermaid
graph TD
    A["NotebookLM chargé"] -->|"content_scripts"| B["main.js"]
    B --> C["Vérification paramètres"]
    C -->|"browser.storage.local"| D["Chargement préférences"]
    D --> E["Initialisation modules actifs"]
    E --> F["search.js"]
    E --> G["merge.js"]
    E --> H["export.js"]
    E --> I["delete.js"]
    E --> J["syntax.js"]
    E --> K["chat-export.js"]
    L["Popup"] -->|"browser.storage.local"| D
```

## Système i18n

L'extension utilise le système natif `browser.i18n.getMessage()` de WebExtension :
- **Locale par défaut** : `en` (définie dans `manifest.json` via `default_locale`)
- **7 locales supportées** : en, fr, es, de, pt, ja, vi
- **Clés normalisées** : camelCase, sans préfixe de module
- **Vérification** : `node tools/check-i18n.js` valide la couverture de toutes les locales cibles

## Paramétrage

Chaque fonctionnalité peut être activée/désactivée individuellement via la popup de l'extension. Les préférences sont stockées dans `browser.storage.local` avec les clés suivantes :

| Clé | Type | Défaut | Description |
|---|---|---|---|
| `feature_search` | `boolean` | `true` | Recherche globale |
| `feature_merge` | `boolean` | `true` | Fusion intelligente |
| `feature_export` | `boolean` | `true` | Exports simplifiés |
| `feature_delete` | `boolean` | `true` | Suppression en ligne |
| `feature_syntax` | `boolean` | `true` | Coloration syntaxique |
| `feature_chatExport` | `boolean` | `true` | Export du chat |

## Conventions

- **Préfixe de log** : `[MM]` pour tous les messages console
- **Commentaires** : en français
- **Auteur** : MTF Karukera
- **Licence** : MPL-2.0
