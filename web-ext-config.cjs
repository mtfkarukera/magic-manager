// web-ext-config.cjs — Configuration web-ext pour Magic Manager
// Auteur : MTF Karukera | Licence : MPL-2.0

const fs   = require('fs');
const path = require('path');

let ignoreFiles = [];
try {
  const ignorePath = path.join(__dirname, '.web-ext-ignore');
  if (fs.existsSync(ignorePath)) {
    const ignoreContent = fs.readFileSync(ignorePath, 'utf8');
    ignoreFiles = ignoreContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
  }
} catch (e) {
  console.error('[MM] Erreur de lecture de .web-ext-ignore :', e);
}

module.exports = {
  artifactsDir: 'dist',
  ignoreFiles: ignoreFiles
};
