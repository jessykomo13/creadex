// Construit dist/app.js (Hub + éditeur), dist/player.js (lecteur des jeux exportés) et sw.js
import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import fs from 'node:fs';

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

const files = [
  'index.html',
  'style.css',
  'manifest.webmanifest',
  'dist/app.js',
  'dist/player.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];
const hash = createHash('sha256');
for (const f of files) hash.update(fs.readFileSync(f));
const version = hash.digest('hex').slice(0, 12);
const sw = fs
  .readFileSync('sw.template.js', 'utf8')
  .replace('__VERSION__', version)
  .replace('__ASSETS__', JSON.stringify(['./', ...files]));
fs.writeFileSync('sw.js', sw);

for (const f of ['dist/app.js', 'dist/player.js']) console.log(`${f}  ${(fs.statSync(f).size / 1024).toFixed(0)} Ko`);
console.log('sw.js  version ' + version);
