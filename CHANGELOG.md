# Changelog

Toutes les modifications notables de ce projet sont documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/) et ce projet respecte le [Versionnage Sémantique](https://semver.org/lang/fr/).

## [0.5.6] — 2026-07-16

### Corrigé
- 🗑️ **Chargement des actions individuelles** : Résolution du bug d'affichage intermittent des boutons de suppression (poubelle) et d'export dans la vue de document. L'injection s'effectue désormais de manière synchrone avec l'hydratation asynchrone d'Angular en s'intégrant au dispatcher global de mutations profonds combiné à des retries locaux programmés (100ms / 300ms).

## [0.5.5] — 2026-07-16

### Ajouté
- 🤝 **Crédits dans le README** : Attribution et remerciements officiels ajoutés au projet open-source `notebooklm-py` de teng-lin pour l'ingénierie inverse de l'API.

### Sécurisé
- 🔒 **Confidentialité accrue** : Retrait définitif d'AGENTS.md du suivi de version Git et purge complète de tout son historique de commits sur le dépôt public GitHub pour éviter les fuites de consignes internes. Ajout systématique du fichier dans le `.gitignore`.

## [0.5.4] — 2026-07-16

### Corrigé
- 🔴 **Robustesse Réseau (B1 + B2)** : Intégration d'un timeout de 30 secondes et d'un retry exponentiel adaptatif (3 tentatives avec gestion de `Retry-After` sur erreur 429) dans le client RPC `rpcclient.js`.
- 🔴 **Fuite mémoire CSRF (B3)** : Optimisation de `getCsrfToken()` par mise en cache et suppression complète de l'analyse globale de `document.documentElement.innerHTML`.
- 🔴 **Accessibilité WCAG 2.3.3 (B4)** : Ajout du support de `@media (prefers-reduced-motion: reduce)` pour toutes les animations de modale et transitions.
- 🔴 **Accessibilité WCAG 2.1.2 & 4.1.2 (B5 + B6)** : Migration complète des boîtes de dialogue et du dialogue de fusion vers la balise HTML5 native `<dialog>` avec gestion native du focus trap, closing Escape automatique, rôle ARIA et attributs `aria-modal`/`aria-labelledby`.
- ⚡ **Optimisation des performances globales** : Centralisation de tous les MutationObservers sur `document.body` au sein d'un unique coordinateur dans `panel-observer.js` et remplacement du suivi des attributs de checkboxes par de la délégation d'événements de clic (CPU libéré en tâche de fond).
- ⚡ **Ciblage de la coloration** : Limitation du balayage de coloration syntaxique des codes source au seul conteneur du chat pour éliminer les analyses DOM globales.
- 🔁 **Ergonomie de fusion** : Retrait du rechargement de page automatique à la fin du processus de fusion de sources, évitant de couper la discussion de chat en cours de rédaction.

## [0.5.3] — 2026-07-16

### Corrigé
- 💬 **Restauration de l'export de discussion (chat)** : Correction d'un bug syntaxique silencieux dans `chatexport.js`. Une accolade de fermeture résiduelle `}, 300)` issue d'une précédente refactorisation du `debounce` global court-circuitait la déclaration de la fonction `tryInjectButton()`, la rendant inopérante sans lever d'erreur visible. Suppression du résidu et conversion en fonction pure (`function` declaration).
- 🔁 **Observer chatExport stabilisé** : Remplacement du `debounce` global par un timer local (`clearTimeout/setTimeout`) dans le callback du `MutationObserver` pour éviter les conflits d'état entre les cycles d'initialisation/nettoyage. Ajout de tentatives différées (500ms, 1500ms) au lancement pour absorber les délais de rendu SPA de NotebookLM.
- 🎯 **Ciblage exclusif du panneau Discussion** : `findChatPanelHeader()` utilise désormais une approche ascendante depuis le `<textarea>` du chat (garantissant le bon conteneur) combinée à une exclusion stricte de `.source-panel` et `.left-sidebar`, empêchant définitivement l'injection erronée dans le panneau des Sources.

## [0.5.2] — 2026-07-16

### Corrigé
- 🎛️ **Résilience des clés de paramètres** : Correction de l'inversion et de l'inactivité des options de configuration de l'extension. La fonction `isFeatureEnabled` dans `orchestrator.js` accepte désormais de manière transparente les clés courtes (ex: `'export'`) et longues (ex: `'feature_export'`) pour la lecture du stockage.
- 📦 **Régression de disparition des boutons d'export et fusion** : Correction de la fonction `findSelectAllRow()` dans `export.js` et `merge.js`. Elle ignore désormais les grands conteneurs de listes parents pour ne cibler que la ligne Tout Sélectionner, évitant de filtrer à tort toutes les checkboxes de sources et restaurant l'affichage immédiat des boutons d'export/fusion par lot.

## [0.5.1] — 2026-07-16

### Corrigé
- 📊 **Décompte des sources sélectionnées** : Correction de l'écart de 1 unité lors de la sélection globale ("Tout sélectionner") dans les modules de fusion (`merge.js`) et d'export (`export.js`). La checkbox globale de Google est désormais exclue sémantiquement en identifiant dynamiquement sa ligne conteneure via son contenu textuel, indifféremment de l'obfuscation de Google.
- ⚙️ **Commutateurs de paramètres fonctionnels** : Résolution du comportement "purement décoratif" du panneau de configuration. Exposition de la fonction `isFeatureEnabled` sur le namespace `window.MM` et couplage de cette dernière dans `panel-observer.js`, `search.js`, `syntax.js` et `chatexport.js`. L'activation ou désactivation de chaque commutateur prend désormais effet instantanément sans conflit et sans injection orpheline de boutons.

## [0.5.0] — 2026-07-16

### Ajouté
- 🔌 **Intégration RPC direct pour la capture** : Migration de l'extraction de texte de l'approche DOM fragile vers le RPC direct `getSourceContent` (`hizoJc`) pour la fusion et les exports par lot.
- 📌 **Création de note en arrière-plan** : Ajout de la création et de la mutation de notes utilisateurs en 2 étapes via RPC direct (`CYK0Xb` + `cYAfTb`), évitant l'ouverture de l'éditeur riche de la note à l'écran.

### Corrigé
- 📑 **Exportation de fichiers complets (Zéro vide)** : Correction de l'extraction de texte dans `rpcclient.js` en ciblant spécifiquement l'index `result[3][0]` de la réponse RPC (texte brut indexé par Google), résolvant définitivement les exports vides ou contenant uniquement des URLs Google Drive Viewer.
- 🔀 **Cycle de vie SPA et boutons persistants** : Refonte de `panel-observer.js` avec un observateur global sur `document.body` pour réattacher dynamiquement le MutationObserver sur les nouvelles instances de `section.source-panel` recréées par Angular. Les boutons d'export/fusion par lot s'affichent instantanément à l'ouverture d'un carnet de notes sans F5.
- 🔍 **Barre de recherche fixe** : Positionnement de la barre de recherche après le header statique de `sourcePanel` pour la fixer en haut du panneau et empêcher qu'elle ne disparaisse avec le défilement vertical.
- 🔄 **Actualisation de la fusion** : Rechargement automatique doux de la page 1,5s après la fin d'une fusion pour faire apparaître instantanément la source fusionnée dans le panneau de sources de l'utilisateur.

## [0.4.2] — 2026-07-15

### Corrigé
- 🔍 **Barre de recherche** : La barre disparaissait lors du défilement de la liste. Elle est maintenant injectée dans le `panel-header` (zone fixe, hors de la liste scrollable), ce qui la maintient toujours visible quelle que soit la position de défilement.
- ⚡ **Export par lot (vitesse)** : Remplacement du délai fixe de 800ms par une détection dynamique du changement de titre dans le `source-viewer`. Le temps d'export est désormais adaptatif (typiquement 80–300ms par source au lieu de 800ms).
- 🔀 **Export par lot (redirection)** : Après l'export, le `source-viewer` est maintenant fermé automatiquement pour éviter la redirection inexpliquée vers la dernière source exportée.
- 📦 **Export 1 source** : Si une seule source est cochée, l'export se fait directement en Markdown sans passer par la modale de confirmation ni générer un ZIP superflu.
- 📑 **Fusion de sources** : Correction d'une condition de course — le viewer de la source précédente était encore présent lors du chargement de la suivante, ce qui aboutissait à extraire toujours le même contenu. On attend maintenant que le titre du viewer change avant d'extraire.
- 📝 **Export conversation** : La note créée dans le Studio ne s'ouvre plus automatiquement après la sauvegarde.

## [0.4.1] — 2026-07-08

### Corrigé
- 📑 **Fusion de sources** : Correction du sélecteur du panneau de gauche (singulier vs pluriel) empêchant l'affichage du bouton de fusion.

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
