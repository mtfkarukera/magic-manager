# 🧩 Magic Manager for Gemini Notebook

![GitHub release](https://img.shields.io/badge/release-v0.12.2-green)
![GitHub license](https://img.shields.io/github/license/mtfkarukera/magic-manager?color=blue)

**Magic Manager** est une extension Firefox qui enrichit l'interface de **Google Gemini Notebook** (anciennement NotebookLM) sur [notebooklm.google.com](https://notebooklm.google.com/) avec des fonctionnalités avancées de productivité.

## ✨ Fonctionnalités

- 🔍 **Recherche globale & Doublons** — Recherchez parmi toutes vos sources (avec bouton de réinitialisation croix ×) et filtrez les doublons potentiels (similarité de titre + checksum du contenu).
- 🏷️ **Badges visuels de sources** — Identifiez instantanément la nature de vos sources (🔄 Google Drive, 🌐 Lien Web/YouTube, ▢ Upload Local) directement dans la liste des sources.
- 🔗 **Fusion intelligente** — Fusionnez plusieurs sources en un seul document.
- 📤 **Exports & Fusions Riche vs Simple** — Choisissez entre les modes "Riche" (mise en forme structurée complète, tableaux et images incluses) ou "Simple" (texte brut 100% garanti non-tronqué par les limites réseau de Google pour les documents très lourds). Disponible en Markdown et PDF pour les exports individuels, par lot et les fusions.
- 🗑️ **Suppression en ligne & par lot** — Supprimez des sources individuellement ou par lot, ainsi que les notes et artéfacts du Studio, directement depuis l'interface. La sélection est sécurisée par une empreinte de liste : si la liste subit des modifications (renommage, ajout, suppression, réordonnancement), la sélection est automatiquement réinitialisée avec une alerte utilisateur pour éviter toute erreur.
- 🔎 **Recherche & Filtres Studio** — Recherchez et filtrez les notes et artéfacts du Studio par texte et par type (résumés audio, quiz, cartes mentales, infographies, etc.) avec une pilule de recherche rétractable.
- 🎨 **Coloration syntaxique** — Mise en valeur du code dans les réponses du chat avec coloration syntaxique.
- 💬 **Export du chat** — Sauvegardez vos conversations avec l'IA sous forme de notes.
- ⌨️ **Raccourcis clavier** — Accélérez votre navigation avec des raccourcis dédiés (`Cmd/Ctrl+Shift+F` pour la recherche sources, `Cmd/Ctrl+Shift+E` pour le chat, `Cmd/Ctrl+Shift+L` pour la recherche Studio).

## ⚡ Performance & Sobriété énergétique

Magic Manager est optimisé pour être le plus léger possible et préserver vos ressources système :
- **0% CPU au repos** : L'observation des modifications de l'interface par MutationObserver est centralisée, debouncée à 250ms, et filtrée pour éviter tout calcul inutile lorsque la page est stable.
- **Requêtes directes via l'API interne (RPC)** : Pas de simulations de clics de souris ou de manipulations visuelles lentes. L'extension communique directement en tâche de fond avec l'API officielle sécurisée de Gemini Notebook pour toutes ses actions lourdes (suppression, fusion, etc.).
- **Zéro script persistant** : L'extension s'exécute uniquement sous forme de scripts de contenu injectés à la demande. Aucun script d'arrière-plan permanent ne consomme votre mémoire vive (RAM) inutilement.

## 📦 Installation

### Depuis le store AMO (recommandé)

1. Rendez-vous sur la page de l'extension sur [addons.mozilla.org](https://addons.mozilla.org/).
2. Cliquez sur « Ajouter à Firefox ».
3. Ouvrez [Gemini Notebook](https://notebooklm.google.com/) et profitez des nouvelles fonctionnalités.

### Depuis les sources

1. Clonez ce dépôt :
   ```bash
   git clone https://github.com/mtfkarukera/magic-manager.git
   cd magic-manager
   ```
2. Ouvrez Firefox et allez dans `about:debugging#/runtime/this-firefox`.
3. Cliquez sur « Charger un module complémentaire temporaire ».
4. Sélectionnez le fichier `manifest.json` à la racine du projet.

## 🌍 Langues supportées

| Langue | Code |
|---|---|
| 🇬🇧 Anglais | `en` |
| 🇫🇷 Français | `fr` |
| 🇪🇸 Espagnol | `es` |
| 🇩🇪 Allemand | `de` |
| 🇧🇷 Portugais (Brésil) | `pt` |
| 🇯🇵 Japonais | `ja` |
| 🇻🇳 Vietnamien | `vi` |

## 🤝 Crédits

Ce projet s'appuie grandement sur l'analyse et l'ingénierie inverse de l'API interne de Gemini Notebook (anciennement NotebookLM) réalisées par le projet open-source [notebooklm-py](https://github.com/teng-lin/notebooklm-py). Un grand merci à ses contributeurs pour leur travail remarquable de documentation et d'exploration !

## 📄 Licence

Ce projet est distribué sous la licence [MPL-2.0](./LICENSE).

## 🤝 Contribution

Les contributions sont les bienvenues ! N'hésitez pas à ouvrir une *issue* ou à soumettre une *pull request*.

---

*Développé par **MTF Karukera**. Découvre toutes les solutions logicielles et outils de productivité de la suite **magic-softs** sur [magic-clipper.mtfk.fr](https://magic-clipper.mtfk.fr/).*
