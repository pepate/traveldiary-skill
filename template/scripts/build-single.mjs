// Baut eine einzelne HTML-Datei zum Verschicken: SINGLE=1 vite build (JS/CSS inline),
// danach werden alle JSON-Daten, Fotos, POI-Bilder und Videos als data:-URIs in window.__EMBED__ eingebettet.
// Nur Kartenkacheln, Gelände und Schriften kommen weiter aus dem Netz.
// Aufruf: npm run build:single  → <Titel>.html (neben dem Projektordner)
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import sharp from 'sharp';
import { ROOT, OUT, readJSON } from './lib.mjs';

const PUB = path.join(ROOT, 'public');
const PHOTO_W = Number(process.env.PHOTO_W ?? 1200);   // Fotos fürs Verschicken etwas kleiner
const MAX_VIDEO = Number(process.env.MAX_VIDEO ?? 8) * 1048576;   // größere eigene Videos bleiben draußen (nur Poster + Hinweis)
const MIME = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4' };

execSync('npx vite build', { stdio: 'inherit', env: { ...process.env, SINGLE: '1' } });

const embed = {};
const dataUri = async (rel, shrink = false) => {
  const file = path.join(PUB, rel), ext = path.extname(rel).toLowerCase();
  let buf = fs.readFileSync(file);
  if (shrink) buf = await sharp(buf).resize({ width: PHOTO_W, withoutEnlargement: true }).webp({ quality: 68 }).toBuffer();
  return `data:${shrink ? 'image/webp' : MIME[ext] ?? 'application/octet-stream'};base64,${buf.toString('base64')}`;
};

const trip = readJSON(path.join(OUT, 'trip.json'));
for (const d of trip.days) if (d.video?.src && fs.existsSync(path.join(PUB, d.video.src))) d.video.src = await dataUri(d.video.src);
embed['data/trip.json'] = trip;
embed['data/content.json'] = readJSON(path.join(OUT, 'content.json'));
for (const d of trip.days) { const f = path.join(OUT, 'days', `day-${d.n}.json`); if (fs.existsSync(f)) embed[`data/days/day-${d.n}.json`] = readJSON(f); }

const photos = readJSON(path.join(OUT, 'photos.json'));
for (const p of photos) {
  p.src = await dataUri(p.src, true); p.thumb = await dataUri(p.thumb);
  if (p.video && fs.existsSync(path.join(PUB, p.video))) {
    if (fs.statSync(path.join(PUB, p.video)).size <= MAX_VIDEO) p.video = await dataUri(p.video);
    else { console.log(`  Video ausgelassen (zu groß): ${p.video}`); p.video = null; p.videoOmitted = true; }
  }
}
embed['data/photos.json'] = photos;

const pois = readJSON(path.join(OUT, 'pois.json'));
for (const p of pois) if (p.image) p.image = await dataUri(p.image, true);
embed['data/pois.json'] = pois;

const htmlFile = path.join(ROOT, 'dist-single', 'index.html');
let html = fs.readFileSync(htmlFile, 'utf8');
const script = `<script>window.__EMBED__=${JSON.stringify(embed).replace(/<\/script/gi, '<\\/script')}</script>`;
// Nach der Charset-Angabe einfügen: <meta charset> muss in den ersten 1024 Bytes bleiben
const m = html.match(/<meta charset=[^>]*>/i);
if (!m) throw new Error('kein <meta charset> gefunden');
html = html.replace(m[0], `${m[0]}${script}`);
const out = path.join(ROOT, '..', `${(trip.title || 'Travel-Diary').replace(/[^\w\-]+/g, '-').replace(/^-|-$/g, '')}.html`);
fs.writeFileSync(out, html);
console.log(`→ ${out} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
