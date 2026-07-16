# 🧩 Magic Manager for NotebookLM

![GitHub release (latest by date)](https://img.shields.io/github/v/release/mtfkarukera/magic-manager?color=green)
![GitHub license](https://img.shields.io/github/license/mtfkarukera/magic-manager?color=blue)

**Magic Manager** est une extension Firefox qui enrichit l'interface de [Google NotebookLM](https://notebooklm.google.com/) avec des fonctionnalités avancées de productivité.

## ✨ Fonctionnalités

- 🔍 **Recherche globale** — Recherchez instantanément parmi toutes vos sources dans un notebook.
- 🔗 **Fusion intelligente** — Fusionnez plusieurs sources en un seul document Markdown ou PDF.
- 📤 **Exports simplifiés** — Exportez vos sources aux formats Markdown, PDF ou ZIP en un clic.
- 🗑️ **Suppression en ligne** — Supprimez des sources directement depuis le panneau latéral.
- 🎨 **Coloration syntaxique** — Mise en valeur du code dans les réponses du chat avec coloration syntaxique.
- 💬 **Export du chat** — Sauvegardez vos conversations avec l'IA sous forme de notes.

## 📦 Installation

### Depuis le store AMO (recommandé)

1. Rendez-vous sur la page de l'extension sur [addons.mozilla.org](https://addons.mozilla.org/).
2. Cliquez sur « Ajouter à Firefox ».
3. Ouvrez [NotebookLM](https://notebooklm.google.com/) et profitez des nouvelles fonctionnalités.

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

Ce projet s'appuie grandement sur l'analyse et l'ingénierie inverse de l'API interne de NotebookLM réalisées par le projet open-source [notebooklm-py](https://github.com/teng-lin/notebooklm-py). Un grand merci à ses contributeurs pour leur travail remarquable de documentation et d'exploration !

## 📄 Licence

Ce projet est distribué sous la licence [MPL-2.0](./LICENSE).

## 🤝 Contribution

Les contributions sont les bienvenues ! N'hésitez pas à ouvrir une *issue* ou à soumettre une *pull request*.

---

*Développé par **MTF Karukera**. Découvre toutes les solutions logicielles et outils de productivité de la suite **magic-softs** sur [magic-clipper.mtfk.fr](https://magic-clipper.mtfk.fr/).*
