#!/usr/bin/env bash
# build.sh — Build l'extension et produit un .xpi dans dist/
# Auteur : MTF Karukera | Licence : MPL-2.0
set -e

VERSION=$(node -p "require('./manifest.json').version")
NAME="magic_manager_for_notebooklm"
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
