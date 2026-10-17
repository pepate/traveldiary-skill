// data/pois.json → public/pois/<id>.jpg (Bild von Wikimedia Commons, frei lizenziert) + public/data/pois.json
// Pro POI: "commons" = Suchbegriff (erster Treffer) oder "file" = exakter Dateiname "File:…" (um einen Treffer festzunageln).
// Bereits geladene Bilder werden nicht neu geholt – Datei löschen, um neu zu suchen.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, OUT, readJSON, writeJSON } from './lib.mjs';

const DEST = path.join(ROOT, 'public', 'pois');
fs.mkdirSync(DEST, { recursive: true });
const pois = readJSON(path.join(ROOT, 'data', 'pois.json'));
const metaFile = path.join(ROOT, 'data', 'pois-images.json');   // Attribution (eingecheckt)
const meta = fs.existsSync(metaFile) ? readJSON(metaFile) : {};
const API = 'https://commons.wikimedia.org/w/api.php';
const headers = { 'User-Agent': 'camper-tour-2026 (private Reise-Webseite; Node fetch)' };
const strip = (s = '') => { const t = s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().replace(/^Unknown author.*/i, 'unbekannt'); const m = t.match(/(?:taken|photo) by ([^.,(]+)/i); return (m ? m[1] : t).split(/[.,(]/)[0].trim().slice(0, 40); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJSON(url) {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(url, { headers });
    const t = await r.text();
    try { return JSON.parse(t); } catch { console.warn(`    Commons: ${t.slice(0, 40)}… – warte`); await sleep(8000 * (i + 1)); }
  }
  throw new Error('Commons antwortet nicht');
}

for (const p of pois) {
  const img = path.join(DEST, `${p.id}.jpg`);
  if (fs.existsSync(img) && meta[p.id]) continue;
  try {
    const q = new URLSearchParams({ action: 'query', format: 'json', prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '1000' });
    if (p.file) q.set('titles', p.file);
    else { q.set('generator', 'search'); q.set('gsrsearch', `${p.commons} filetype:bitmap`); q.set('gsrnamespace', '6'); q.set('gsrlimit', '5'); }
    const j = await getJSON(`${API}?${q}`);
    await sleep(1500);
    const pages = Object.values(j.query?.pages ?? {}).filter((pg) => pg.imageinfo?.[0]?.thumburl).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (!pages.length) { console.warn(`  ${p.id}: kein Bild gefunden`); continue; }
    const pg = pages[0], ii = pg.imageinfo[0], em = ii.extmetadata ?? {};
    const buf = Buffer.from(await (await fetch(ii.thumburl, { headers })).arrayBuffer());
    fs.writeFileSync(img, buf);
    meta[p.id] = { file: pg.title, artist: strip(em.Artist?.value), license: em.LicenseShortName?.value ?? '', url: ii.descriptionurl };
    console.log(`  ${p.id}: ${pg.title} (${meta[p.id].license}, ${meta[p.id].artist})`);
  } catch (e) { console.warn(`  ${p.id}: ${e.message}`); }
}
writeJSON(metaFile, meta);
writeJSON(path.join(OUT, 'pois.json'), pois.map((p) => ({ ...p, image: fs.existsSync(path.join(DEST, `${p.id}.jpg`)) ? `pois/${p.id}.jpg` : null, credit: meta[p.id] ?? null })));
console.log(`pois: ${pois.length}`);
