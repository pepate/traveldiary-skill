#!/usr/bin/env node
// Scaffold a new travel diary project from template/:  node init.mjs <target-dir> [--no-install]
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = path.join(SKILL, 'template');
const target = process.argv[2] ? path.resolve(process.argv[2]) : null;
const noInstall = process.argv.includes('--no-install');
if (!target) { console.error('usage: node init.mjs <target-dir> [--no-install]'); process.exit(1); }
if (fs.existsSync(path.join(target, 'data', 'trip.json'))) { console.error(`${target} already contains a travel diary project – nothing copied.`); process.exit(1); }

const SKIP = new Set(['node_modules', 'dist', 'dist-single', '.cache', 'public/data', 'public/photos', 'public/pois', 'data/timeline']);
function copy(src, dst, rel = '') {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (SKIP.has(r) || SKIP.has(e.name)) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copy(s, d, r); }
    else fs.copyFileSync(s, d);
  }
}
fs.mkdirSync(target, { recursive: true });
copy(TEMPLATE, target);
fs.mkdirSync(path.join(target, '.claude'), { recursive: true });
fs.copyFileSync(path.join(TEMPLATE, 'launch.json.example'), path.join(target, '.claude', 'launch.json'));
fs.rmSync(path.join(target, 'launch.json.example'));
console.log(`✓ project created in ${target}`);

if (!noInstall) {
  console.log('→ npm install …');
  execSync('npm install --no-fund --no-audit', { cwd: target, stdio: 'inherit' });
}
console.log(`
Next:
  cd "${target}"
  npm run setup      # opens the setup app on http://localhost:5180 (language, trip, days, drag & drop)
  npm run dev        # preview on http://localhost:5173
`);
