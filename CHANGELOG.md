# Changelog

Toutes les modifications notables de ce projet sont documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/) et ce projet respecte le [Versionnage Sémantique](https://semver.org/lang/fr/).

## [0.4.1] — 2026-07-08

### Corrigé
- 📑 **Compteur exact de sources** : Correction de la détection des checkboxes en ciblant les cartes de sources physiques uniques. Résout le bug d'affichage de "+18" au lieu de "8".
- 🐛 **Crash JavaScript** : Résolution du crash `TypeError: cb.className.includes is not a function` provoqué par des éléments SVG lors de la vérification de l'état coché.
- 📦 **Modale d'exportation par lot** : Remplacement de l'ancien dialogue par une modale interactive proposant les trois formats de sortie (ZIP, Markdown, PDF) avec barre de progression de l'extraction et fermeture automatique de la visionneuse.
- 🔗 **Fiabilité de fusion** : Association robuste des titres de sources aux cases à cocher en tant qu'attributs `aria-label` pour garantir la correspondance et l'extraction du contenu de chaque source.

## [0.4.0] — 2026-07-08

### Ajouté
- 📑 **Fusion intelligente des sources** (`merge.js`) :
  - Sélection multiple de sources dans la liste latérale et bouton "Fusionner" dynamique.
  - Modale de configuration moderne et premium pour saisir le titre et choisir le format (Markdown ou PDF).
  - Extracteur séquentiel DOM robuste avec boucle d'attente asynchrone et nettoyage des résidus visuels.
  - Importation automatique en tant que nouvelle source via RPC (Markdown via `addTextSource`, PDF via `uploadBlob`).
- 📌 **Export du chat IA** (`chatexport.js`) :
  - Bouton unique "Exporter toute la conversation" injecté élégamment dans la barre d'en-tête du panneau Discussion.
  - Déduplication robuste des messages en naviguant à travers le Shadow DOM.
  - Détection fiable des rôles AI et Utilisateur via les éléments de retour interactifs de l'IA.
  - Création de véritables notes dans le Studio via l'injection DOM HTML pour conserver la mise en page aérée et les sauts de ligne.

## [0.3.0] — 2026-07-07

### Ajouté
- 🔌 **Client RPC NotebookLM** (`rpcclient.js`) :
  - Client RPC batchexecute robuste pour communiquer directement avec les APIs internes de Google.
  - Décodeur résilient basé sur le format chunked officiel et la protection anti-XSSI.
  - Extraction transparente du token CSRF `SNlM0e` dans le DOM actif.
- 🗑️ **Suppression en arrière-plan intégrée** (`delete.js`) :
  - Extraction de l'ID de source résiliente (regex de recherche UUID et format `s:...`).
  - Suppression de source en un clic avec confirmation utilisateur, sans ouverture de menu de simulation.
  - Retrait dynamique et animé (fondu CSS) de la source supprimée dans la liste.
  - Fallback vers la modale native en cas d'erreur réseau ou d'expiration de session.

## [0.2.1] — 2026-07-07

### Changé / Corrigé (Hotfix AMO)
- Incrément de version de 0.2.0 à 0.2.1 en raison d'une collision de version sur le store AMO (la v0.2.0 étant déjà déclarée).

### Ajouté
- 🔍 **Recherche globale fonctionnelle** :
  - Filtrage dynamique et en direct des sources basé sur la détection sémantique des checkboxes.
  - Fixation permanente (Sticky Header) de toute la zone supérieure (bouton ajouter, recherche web, sélection globale, barre MM) pendant le scroll.
  - Design épuré, transparent et totalement intégré.
- 🎨 **Coloration syntaxique active** :
  - Détection récursive traversant les Shadow DOM pour cibler les réponses IA de Google.
  - Parseur Regex et DOM 100% CSP-compliant sans `innerHTML` (DocumentFragment).
  - Bandeau avec indication du langage et bouton de copie rapide (avec retour visuel de succès).
- 🗑️ **Bouton de suppression directe de source** :
  - Intégration d'un bouton corbeille dans le `.panel-header` du panneau de lecture de source.
  - Déclenchement du dialogue de confirmation natif de Google pour une suppression sécurisée.
- 📤 **Export de sources individuelles** :
  - Bouton d'export dans le `.panel-header` du panneau de lecture, à côté du bouton de suppression.
  - Export au format **Markdown** (`.md`) avec nom de fichier propre (sans double extension).
  - Export au format **PDF** via jsPDF, avec gestion des sauts de page et titre embarqué.
  - Correction de la résolution jsPDF dans le sandbox XPCOM Firefox (`globalThis` → `self` → `window`).
- ⚡ **Panel Observer centralisé** (`panel-observer.js`) :
  - Observation unique sur `section.source-panel` pour l'injection et le nettoyage des boutons MM.
  - Nettoyage automatique des boutons injectés à la fermeture du panneau (pas de boutons orphelins).

### Corrigé
- **Double extension de fichier** : les sources nommées `fichier.pdf` dans NotebookLM ne produisent plus `fichier.pdf.md` mais `fichier.md` (fonction `stripSourceExtension`).
- **Warning AMO** : suppression de `JSZip` (usage de `Function` constructor). Le format ZIP est désormais généré en pur JS natif (format STORE, sans compression, sans `eval`).
- **Export PDF muet** : la méthode `doc.save()` étant bloquée par Firefox en content script, passage à `doc.output('blob')` + lien `<a>` temporaire.

## [0.1.0] — 2026-07-06

### Ajouté
- 🏗️ **Squelette de l'architecture** : Content script avec orchestrateur résilient par MutationObserver.
- 🌍 **Internationalisation (i18n)** : Support complet de 7 langues (EN, FR, ES, DE, PT, JA, VI) avec script de validation.
- ⚙️ **Panneau de configuration** : Bouton fixe ⚙️ et popover Material Design 3 pour activer/désactiver les features.
