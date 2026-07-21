// tools/test-table.js
const fs = require('fs');
const path = require('path');
const JSDOM = require('jsdom').JSDOM;

// Set up global window/document for Turndown
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.DOMParser = dom.window.DOMParser;
global.XMLSerializer = dom.window.XMLSerializer;

// Load libraries
const turndownPath = path.join(__dirname, '..', 'lib', 'turndown.js');
const gfmPath = path.join(__dirname, '..', 'lib', 'turndown-plugin-gfm.js');

// Evaluate and assign to global
const turndownContent = fs.readFileSync(turndownPath, 'utf8');
const gfmContent = fs.readFileSync(gfmPath, 'utf8');

global.TurndownServiceClass = eval(turndownContent + '\nTurndownService;');
global.turndownPluginGfmObj = eval(gfmContent + '\nturndownPluginGfm;');

const service = new global.TurndownServiceClass({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  fence: '```',
  emDelimiter: '*',
  strongDelimiter: '**',
  linkStyle: 'inlined',
  hr: '---'
});

service.use(global.turndownPluginGfmObj.gfm);

// A table HTML without thead and tbody
const htmlString = `
<table>
  <tr><th>Propriété</th><th>Claude</th><th>Gemini</th></tr>
  <tr><td>Date</td><td>28 mai</td><td>19 mai</td></tr>
  <tr><td>Taille</td><td>1M</td><td>1M</td></tr>
</table>
`;

const md = service.turndown(htmlString);
console.log('Result markdown:');
console.log(JSON.stringify(md));
console.log(md);
