// Construit dist/app.js (Hub + éditeur), dist/player.js (lecteur des jeux exportés) et sw.js
import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { CHANGELOG } from './src/version.js';

const common = {
  bundle: true,
  minify: true,
  sourcemap: false,
  target: ['safari15', 'chrome100', 'firefox100'],
  legalComments: 'none',
  charset: 'utf8',
  logLevel: 'warning',
};

await esbuild.build({ ...common, entryPoints: ['src/main.js'], format: 'esm', outfile: 'dist/app.js' });
await esbuild.build({ ...common, entryPoints: ['src/player-main.js'], format: 'iife', outfile: 'dist/player.js' });

const player = fs.readFileSync('dist/player.js', 'utf8');
if (/<\/script/i.test(player)) console.warn('⚠️  dist/player.js contient "</script" (échappé à l\'export)');

const assets = [
  'style.css',
  'manifest.webmanifest',
  'dist/app.js',
  'dist/player.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'assets/heros.glb',
];
const sha = (parts) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest('hex').slice(0, 12);
};
const assetHash = sha(assets.map((f) => fs.readFileSync(f)));

// index.html : liens versionnés pour ne jamais recevoir d'anciens fichiers du cache du navigateur
const html = fs
  .readFileSync('index.html', 'utf8')
  .replace(/src="dist\/app\.js[^"]*"/, `src="dist/app.js?v=${assetHash}"`)
  .replace(/href="style\.css[^"]*"/, `href="style.css?v=${assetHash}"`);
fs.writeFileSync('index.html', html);

const version = sha([assetHash, html]);
const latest = CHANGELOG[0];
const sw = fs
  .readFileSync('sw.template.js', 'utf8')
  .replace('__VERSION__', version)
  .replace('__LABEL__', latest.version)
  .replace('__NOTES__', JSON.stringify(latest.notes))
  .replace('__CHANGELOG__', JSON.stringify(CHANGELOG))
  .replace('__ASSETS__', JSON.stringify(['./', 'index.html', ...assets]));
fs.writeFileSync('sw.js', sw);

for (const f of ['dist/app.js', 'dist/player.js']) console.log(`${f}  ${(fs.statSync(f).size / 1024).toFixed(0)} Ko`);
console.log(`sw.js  version ${version}  (${latest.version})`);
