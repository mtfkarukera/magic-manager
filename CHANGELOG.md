# Changelog

Toutes les modifications notables de ce projet sont documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/) et ce projet respecte le [Versionnage Sémantique](https://semver.org/lang/fr/).

## [0.2.0] — 2026-07-07

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
  - Intégration d'un bouton corbeille dans le `.panel-header` du panneau de lecture de source, placé à gauche du bouton de fermeture/réduction.
  - Déclenchement automatique et direct du dialogue de confirmation natif de Google pour une suppression sécurisée et sans modale redondante.

## [0.1.0] — 2026-07-06

### Ajouté
- 🏗️ **Squelette de l'architecture** : Content script avec orchestrateur résilient par MutationObserver.
- 🌍 **Internationalisation (i18n)** : Support complet de 7 langues (EN, FR, ES, DE, PT, JA, VI) avec script de validation.
- ⚙️ **Panneau de configuration** : Bouton fixe ⚙️ et popover Material Design 3 pour activer/désactiver les features.
