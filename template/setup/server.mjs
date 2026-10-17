// Begleit-App zum Einsammeln der Reisedaten: läuft lokal, ohne Abhängigkeiten.
//   npm run setup   →  http://localhost:5180
// Der Browser schickt Dateien roh per PUT (kein Multipart nötig); der Server legt sie in raw/… ab,
// schreibt data/trip.json und content/tagebuch.md. Danach übernimmt Claude Code (/traveldiary day).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 5180);
const DIRS = { photos: 'raw/photos', video: 'raw/video', gpx: 'raw/gpx', timeline: 'raw/timeline' };
const safeName = (n) => path.basename(n).replace(/[^\w.\-() ]+/g, '_');
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => res(Buffer.concat(c))); });

function state() {
  const tripFile = path.join(ROOT, 'data', 'trip.json');
  const trip = fs.existsSync(tripFile) ? JSON.parse(fs.readFileSync(tripFile, 'utf8')) : null;
  const count = (d) => fs.existsSync(path.join(ROOT, d)) ? fs.readdirSync(path.join(ROOT, d)).filter((f) => !f.startsWith('.') && f !== 'README.md').length : 0;
  const diary = fs.existsSync(path.join(ROOT, 'content', 'tagebuch.md')) ? fs.readFileSync(path.join(ROOT, 'content', 'tagebuch.md'), 'utf8') : '';
  return { trip, files: Object.fromEntries(Object.entries(DIRS).map(([k, d]) => [k, count(d)])), diary, builtDays: count('public/data/days') };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(ROOT, 'setup', 'index.html')));
    }
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, state());

    // Reise-Stammdaten → data/trip.json (bestehende Orte/Labels/Tage bleiben erhalten)
    if (req.method === 'POST' && url.pathname === '/api/trip') {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      const file = path.join(ROOT, 'data', 'trip.json');
      const cur = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { places: {}, timeline: { ignoreBefore: '', kinds: {}, labels: {} }, days: [] };
      const trip = { ...cur, ...body, places: cur.places ?? {}, timeline: { ...(cur.timeline ?? {}), ignoreBefore: body.start ? `${body.start}T00:00` : cur.timeline?.ignoreBefore }, days: cur.days ?? [] };
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(trip, null, 2) + '\n');
      return json(res, 200, { ok: true });
    }

    // Tag anlegen/aktualisieren → trip.json → days + Tagebuchtext → content/tagebuch.md
    if (req.method === 'POST' && url.pathname === '/api/day') {
      const { date, title, text } = JSON.parse((await readBody(req)).toString('utf8'));
      const file = path.join(ROOT, 'data', 'trip.json');
      const trip = JSON.parse(fs.readFileSync(file, 'utf8'));
      let day = trip.days.find((d) => d.date === date);
      if (!day) { day = { n: 0, date, title, tracks: [] }; trip.days.push(day); }
      day.title = title;
      trip.days.sort((a, b) => a.date.localeCompare(b.date)).forEach((d, i) => (d.n = i + 1));
      fs.writeFileSync(file, JSON.stringify(trip, null, 2) + '\n');
      writeDiary(trip, day.n, date, title, text);
      return json(res, 200, { ok: true, n: day.n });
    }

    // Datei-Upload: PUT /api/upload?kind=photos&name=IMG_1.jpg  (Body = Dateiinhalt)
    if (req.method === 'PUT' && url.pathname === '/api/upload') {
      const kind = url.searchParams.get('kind'), name = safeName(url.searchParams.get('name') ?? '');
      if (!DIRS[kind] || !name) return json(res, 400, { error: 'kind/name fehlt' });
      const dir = path.join(ROOT, DIRS[kind]);
      fs.mkdirSync(dir, { recursive: true });
      const target = kind === 'timeline' ? path.join(dir, 'Zeitachse.json') : path.join(dir, name);
      fs.writeFileSync(target, await readBody(req));
      return json(res, 200, { ok: true, saved: path.relative(ROOT, target) });
    }
    json(res, 404, { error: 'not found' });
  } catch (e) { json(res, 500, { error: e.message }); }
});

// Tagebuch: pro Tag ein Abschnitt „## Tag N – <Datum> – <Titel>“ (bzw. „## Day N – …“), Text darunter ersetzen
function writeDiary(trip, n, date, title, text) {
  const file = path.join(ROOT, 'content', 'tagebuch.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lang = trip.lang ?? 'de', word = lang === 'en' ? 'Day' : 'Tag';
  const d = new Date(date + 'T12:00:00').toLocaleDateString(lang === 'en' ? 'en-GB' : 'de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const heading = `## ${word} ${n} – ${d} – ${title}`;
  let md = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : `# ${trip.title ?? 'Travel Diary'}\n\n`;
  const re = new RegExp(`^## (Tag|Day) ${n} [^\\n]*\\n[\\s\\S]*?(?=^## (Tag|Day) |(?![\\s\\S]))`, 'm');
  const block = `${heading}\n\n${(text ?? '').trim()}\n\n`;
  md = re.test(md) ? md.replace(re, block) : md.trimEnd() + '\n\n' + block;
  fs.writeFileSync(file, md);
}

server.listen(PORT, () => console.log(`Travel-Diary-Setup: http://localhost:${PORT}  (Strg+C zum Beenden)`));
