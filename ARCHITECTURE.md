# Architecture — Magic Manager for Gemini Notebook

## Vue d'ensemble

Magic Manager est une extension Firefox (Manifest V3) de type **content-script-only**. Elle ne possède ni background script, ni service worker permanent. Toute la logique s'exécute dans le contexte de la page Gemini Notebook (anciennement NotebookLM) via des content scripts injectés.

## Arborescence du projet

```
magic-manager/
├── manifest.json              # Manifeste MV3 de l'extension
├── src/
│   ├── api/
│   │   └── rpcclient.js       # Client RPC pour l'API Gemini Notebook (batchexecute)
│   ├── content/
│   │   ├── orchestrator.js    # Point d'entrée — orchestrateur des modules
│   │   ├── modules/           # Sous-modules de l'extension
│   │   │   ├── source-helpers.js # Fonctions centralisées DOM des sources
│   │   │   ├── search.js      # Module de recherche globale
│   │   │   ├── merge.js       # Module de fusion intelligente
│   │   │   ├── export.js      # Module d'exports simplifiés
│   │   │   ├── delete.js      # Module de suppression en ligne
│   │   │   ├── syntax.js      # Module de coloration syntaxique
│   │   │   └── chatexport.js  # Module d'export du chat
│   │   └── ui/                # Composants d'interface partagés
│   │       ├── dialogs.js     # Boîtes de dialogue Material Design 3
│   │       └── settings.js    # Panneau de réglages utilisateur
│   ├── popup/
│   │   ├── popup.html         # Interface de la popup de paramètres
│   │   ├── popup.js           # Logique de la popup
│   │   └── popup.css          # Styles de la popup
│   └── styles/
│       └── magic-manager.css  # Styles injectés dans la page Gemini Notebook
├── _locales/
│   ├── en/messages.json       # Locale par défaut (anglais)
│   ├── fr/messages.json       # Français
│   ├── es/messages.json       # Espagnol
│   ├── de/messages.json       # Allemand
│   ├── pt/messages.json       # Portugais brésilien
│   ├── ja/messages.json       # Japonais
│   └── vi/messages.json       # Vietnamien
├── icons/
│   ├── icon.svg               # Icône vectorielle (SVG standardisé)
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
    A["Gemini Notebook charge"] -->|"content_scripts"| B["orchestrator.js"]
    B --> C["Verification parametres"]
    B --> K2["shortcuts.js"]
    C -->|"browser.storage.local"| D["Chargement preferences"]
    D --> E["Initialisation modules actifs"]
    E --> F["search.js"]
    E --> G["merge.js"]
    E --> H["export.js"]
    E --> I["delete.js"]
    E --> J["syntax.js"]
    E --> K["chatexport.js"]
    L["Bouton parametres in-page"] -->|"browser.storage.local"| D
```

## Système i18n

L'extension utilise le système natif `browser.i18n.getMessage()` de WebExtension :
- **Locale par défaut** : `en` (définie dans `manifest.json` via `default_locale`)
- **7 locales supportées** : en, fr, es, de, pt, ja, vi
- **Clés normalisées** : camelCase, sans préfixe de module
- **Vérification** : `node tools/check-i18n.js` valide la couverture de toutes les locales cibles

## Paramétrage

Chaque fonctionnalité peut être activée/désactivée individuellement via le micro-menu de paramètres (⚙️) injecté directement dans la page en bas à gauche de la liste des sources. Les préférences sont stockées dans `browser.storage.local` avec les clés suivantes :

| Clé | Type | Défaut | Description |
|---|---|---|---|
| `feature_shortcuts` | `boolean` | `true` | Raccourcis clavier |
| `feature_search` | `boolean` | `true` | Recherche globale |
| `feature_merge` | `boolean` | `true` | Fusion intelligente |
| `feature_export` | `boolean` | `true` | Exports simplifiés |
| `feature_delete` | `boolean` | `true` | Suppression en ligne |
| `feature_syntax` | `boolean` | `true` | Coloration syntaxique |
| `feature_chatExport` | `boolean` | `true` | Export du chat |

## Couche de transport RPC

L'extension s'affranchit des simulations d'interactions DOM (fragiles et sources d'effets visuels secondaires) pour les opérations lourdes en exploitant directement l'API interne `batchexecute` de Gemini Notebook (anciennement NotebookLM) :
- **Résilience réseau (v0.5.4)** : Intégration d'un timeout de 30 secondes (via `AbortController`) et d'un retry exponentiel adaptatif (3 tentatives, gestion de `Retry-After`) sur toutes les requêtes RPC.
- **GET_SOURCE (`hizoJc`)** : Permet de récupérer le texte brut indexé d'une source à l'index `[3][0]` (ou l'HTML de rendu à `[4][1]`), sans charger le document dans le visualiseur DOM de la page.
- **CREATE_NOTE (`CYK0Xb`) / UPDATE_NOTE (`cYAfTb`)** : Création séquentielle robuste en tâche de fond pour exporter les conversations de chat en notes sans focus automatique de l'interface Google.
- **DELETE_SOURCE (`tGMBJ`) / ADD_SOURCE (`izAoDd`)** : Appels directs utilisant des structures de tableaux doublement et triplement enveloppées pour des mutations réseau résilientes.

## Composants d'interface (Modales & Dialogues)

Depuis la version 0.5.4, toutes les boîtes de dialogue et la modale de fusion utilisent l'élément HTML5 natif `<dialog>`. Cela garantit :
- Un comportement standardisé de la modale via `.showModal()`.
- Une gestion native et sécurisée du Focus Trap (le focus clavier reste piégé dans le dialogue).
- Une fermeture automatique et cohérente via la touche `Escape` (via l'événement `cancel` intercepté).
- Une conformité totale avec les critères WCAG 2.1 AA pour l'accessibilité des modales (rôles et états ARIA intégrés).
- **Protection Anti-Processus Fantôme (v0.5.9)** : Afin d'éviter qu'un traitement asynchrone (comme la fusion de sources) ne continue à s'exécuter en tâche de fond après la fermeture ou l'annulation de la modale par l'utilisateur, un témoin d'annulation (`isCancelled`) est lié à l'événement `close` du dialogue et interrompt immédiatement le traitement réseau et la création de sources.

## Cycle d'observation, Performance et Mode Mobile (Coordinateur)

Pour garantir une expérience utilisateur fluide sur la SPA Gemini Notebook sans pénaliser les performances :
- **Observer Centralisé (v0.5.9)** : Au lieu d'avoir plusieurs MutationObservers concurrents scrutant `document.body` en continu, un unique observateur global dans `panel-observer.js` centralise la surveillance du DOM. Avec un debounce de 250ms, il coordonne et distribue les injections pour la barre de recherche, l'export de chat, et la coloration syntaxique. Pour optimiser l'usage du processeur (CPU) lors du streaming de réponses IA, l'observation est restreinte à la racine de l'application `<app-root>` (avec repli sur `document.body`).
- **Observation Réactive des Checkboxes (MutationObserver d'Attributs)** : Pour éviter tout retard de décompte (race condition) et éliminer la surécoute CPU au survol ou au scroll, Magic Manager n'utilise pas de listeners click/change généraux. L'observer du panneau sources écoute les mutations d'attributs (`attributes: true` avec `attributeFilter: ['class', 'aria-checked']`) sur les checkboxes Angular Material (`mat-pseudo-checkbox`). Le recalcul du décompte ne s'effectue qu'à l'ajout/suppression de sources (`childList`) ou lors d'une mutation d'attribut sur une checkbox.
- **Verrou d'Idempotence par Compteur (v0.5.9)** : Pour éliminer toute boucle infinie d'injections réactives (cycles de mutation DOM provoquant des réinjections en cascade), les fonctions de boutons batch s'appuient sur un double verrou d'idempotence basé sur le nombre de sources cochées. Si le compte n'a pas changé et que le bouton est déjà présent dans la bonne ancre, le DOM n'est pas modifié, stoppant net les boucles de l'observateur.
- **Optimisation DOM et TreeWalker (v0.5.9)** : L'utilisation de traversées récursives du Shadow DOM a été entièrement abandonnée au profit de requêtes CSS `querySelectorAll` natives. Pour la coloration syntaxique (où la recherche dans les Shadow Roots est requise), l'algorithme récursif a été optimisé à l'aide d'un `TreeWalker` natif, évitant ainsi le scan répétitif `querySelectorAll('*')` sur l'ensemble de l'arbre et ramenant la complexité de O(N²) à O(N) sur les longs fils de discussion.
- **Gestion Stricte du Cycle de Vie (v0.5.9)** : Afin d'éviter les fuites de ressources et les injections fantômes de boutons, tous les timers d'initialisation (`setTimeout`) lancés par les modules lors de leur activation sont systématiquement référencés et annulés (`clearTimeout`) lors de leur arrêt (`cleanup`). Les styles CSS des modales de fusion ont également été migrés de l'injection dynamique JS à un chargement CSS statique via le manifeste de l'extension.
- **ResizeObserver, En-tête mobile & Clics Onglets** : Un `ResizeObserver` écoute en permanence le redimensionnement du document. Si la visibilité réelle des panneaux sources et chat (mesurée par `offsetParent`) indique un basculement de layout (passage en mode onglets), Magic Manager bascule ses injections :
  - **En-tête Mobile Collant** : Création d'une barre fixe `.mm-sticky-header` en haut de la liste de sources, regroupant à gauche la barre de recherche et à droite les boutons batch (fusion/export), empêchant leur défilement ou disparition au scroll.
  - **Gestion Réactive des Onglets** : Pour capter le basculement d'onglet mobile (géré de façon interne par Angular), l'extension écoute les clics sur les onglets (`[role="tab"]`) et planifie une réinjection complète et un recalcul de l'UI 300ms après la transition.
  - **Ancrage Individuel Résilient** : Si le header de section est masqué, les boutons individuels d'export et de suppression s'ancrent automatiquement sur le bouton natif de retour/fermeture (`button[mattooltip="Close source view"]`) du document ouvert.
- **Loi de Repli de la Barre de Recherche** : Pour éviter que la barre de recherche MM ne déborde lorsque l'utilisateur replie/minimise le panneau sources en mode bureau, l'extension mesure la largeur réelle de `section.source-panel`. Si `width < 120px`, la barre de recherche est automatiquement masquée (`display: none`). Elle réapparaît dès que le panneau est déplié.
- **Raccourcis Clavier Globaux et Captures Clavier (v0.6.3)** : Un écouteur unique d'événements `keydown` est enregistré globalement sur `document` en phase de capture (`true`) par le module `shortcuts.js`. Cela permet d'intercepter les raccourcis de productivité (`Cmd/Ctrl+Shift+F`, `Cmd/Ctrl+Shift+E`, `Option/Alt+Shift+F`) avant qu'ils ne soient consommés par NotebookLM.
- **Dédoublonnage Hybride Local et Réseau (v0.6.4)** : La recherche de doublons s'exécute au clic utilisateur en combinant deux passes indépendantes fusionnées (union) :
  1. Passe locale instantanée via le coefficient de Sørensen-Dice sur les bigrammes des titres (Dice score ≥ 0.8) pour un affichage visuel préliminaire immédiat.
  2. Passe réseau asynchrone autonome scannant toutes les sources du carnet par requêtes RPC `getSourceContent` (`hizoJc`). Le contenu est comparé par paires avec le coefficient de Jaccard sur les ensembles de mots significatifs (> 3 lettres) avec un seuil de similarité ≥ 0.6. Cette méthode élimine les faux négatifs causés par les pipelines d'importation différents (Drive, URL, PDF local) ou les titres renommés.
- **Bouton de Réinitialisation Croix (×)** : Intégration d'un bouton croix positionné en absolute dans la barre de recherche. Sa visibilité est liée dynamiquement à la présence de texte dans le champ de recherche par toggles de classe CSS.


## Conventions

- **Préfixe de log** : `[MM]` pour tous les messages console
- **Commentaires** : en français
- **Auteur** : MTF Karukera
- **Licence** : MPL-2.0
