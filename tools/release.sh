#!/usr/bin/env bash
# tools/release.sh — Script d'automatisation infaillible de release pour Magic Manager
# Auteur : MTF Karukera | Licence : MPL-2.0
#
# Ce script exécute la séquence complète de release sans omission :
# 1. Vérification de la version dans manifest.json
# 2. Validation i18n et linter web-ext
# 3. Compilation du binaire XPI (build.sh)
# 4. Commit Git, push origin main, tagging et push tag
# 5. Publication de la Release GitHub avec binaire attaché via gh CLI

set -e

echo "🚀 [MM-RELEASE] Démarrage du processus de release automatisé..."

# 1. Extraction du numéro de version depuis manifest.json
VERSION=$(node -e "const m = require('./manifest.json'); console.log(m.version);")

if [ -z "$VERSION" ]; then
  echo "❌ [MM-RELEASE] Erreur : Impossible de lire la version dans manifest.json"
  exit 1
fi

echo "📌 [MM-RELEASE] Version ciblée : v${VERSION}"

# 2. Validation i18n
echo "🌐 [MM-RELEASE] Vérification de la synchronisation i18n..."
node tools/check-i18n.js

# 3. Validation Linter web-ext
echo "🔍 [MM-RELEASE] Exécution du linter web-ext..."
npx web-ext lint --source-dir .

# 4. Compilation du binaire .xpi
echo "🔨 [MM-RELEASE] Compilation du binaire .xpi..."
bash build.sh

XPI_PATH="dist/magic_manager_for_gemini_notebook-${VERSION}.xpi"

if [ ! -f "$XPI_PATH" ]; then
  echo "❌ [MM-RELEASE] Erreur : L'archive $XPI_PATH n'a pas été générée par build.sh"
  exit 1
fi

# 5. Commit des modifications
echo "📦 [MM-RELEASE] Indexation et commit Git..."
git add .
git commit -m "chore(release): v${VERSION} — release automatisée" || echo "⚠️ [MM-RELEASE] Aucun changement à committer."

# 6. Push sur origin main
echo "⬆️ [MM-RELEASE] Push sur origin main..."
git push origin main

# 7. Création et push du tag Git
echo "🏷️ [MM-RELEASE] Tagging v${VERSION}..."
if git rev-parse "v${VERSION}" >/dev/null 2>&1; then
  echo "⚠️ [MM-RELEASE] Le tag v${VERSION} existe déjà localement."
else
  git tag -a "v${VERSION}" -m "Release v${VERSION}"
fi

git push origin "v${VERSION}" || echo "⚠️ [MM-RELEASE] Le tag est déjà poussé."

# 8. Publication de la Release GitHub
echo "🎉 [MM-RELEASE] Création de la Release sur GitHub via gh CLI..."
if gh release view "v${VERSION}" >/dev/null 2>&1; then
  echo "⚠️ [MM-RELEASE] La Release v${VERSION} existe déjà sur GitHub. Mise à jour de l'artéfact..."
  gh release upload "v${VERSION}" "$XPI_PATH" --clobber
else
  gh release create "v${VERSION}" "$XPI_PATH" \
    --title "Release v${VERSION}" \
    --notes-file CHANGELOG.md
fi

echo "✅ [MM-RELEASE] Release v${VERSION} publiée avec succès sur GitHub !"
