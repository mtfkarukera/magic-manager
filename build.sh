#!/usr/bin/env bash
# build.sh — Build l'extension et produit un .xpi dans dist/
# Auteur : MTF Karukera | Licence : MPL-2.0
set -e

# Vérifier la constante DEBUG (Règle Globale 12 - Garde-fou)
if grep -rqE "const\s+DEBUG\s*=\s*true|DEBUG\s*=\s*true" src/; then
  echo "❌ ERREUR DE BUILD : Une constante de débogage (DEBUG = true) est active dans src/ !"
  exit 1
fi

VERSION=$(node -p "require('./manifest.json').version")
NAME="magic_manager_for_gemini_notebook"
DIST="dist"


echo "🔨 Building ${NAME}-${VERSION}.xpi …"

# Build via web-ext (lit web-ext-config.cjs → artifactsDir: dist)
npx web-ext build --source-dir . --overwrite-dest

# Renommer le .zip en .xpi
ZIP="${DIST}/${NAME}-${VERSION}.zip"
XPI="${DIST}/${NAME}-${VERSION}.xpi"

if [ -f "$ZIP" ]; then
  mv "$ZIP" "$XPI"
  echo "✅ ${XPI} prêt ($(du -h "$XPI" | cut -f1))"
else
  echo "❌ Fichier ZIP introuvable : $ZIP"
  exit 1
fi
