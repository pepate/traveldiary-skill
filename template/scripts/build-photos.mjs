// raw/photos/**/*.{jpg,jpeg,heic,png} + raw/video/PXL_*.mp4 → public/photos/<id>.webp (+ _thumb), public/video/<id>.mp4 und public/data/photos.json
// Videos: Poster aus Sekunde 1, Zeit aus dem Dateinamen (PXL_YYYYMMDD_HHMMSS = UTC), Position aus GPX/Timeline per Zeit.
// - liest Aufnahmezeit + GPS aus EXIF
// - Fotos ohne GPS bekommen eine Position aus dem GPX-Track, falls die Zeit in einen Track fällt
// - Zuordnung zum Reisetag über das Datum (Zeitzone aus trip.json)
import fs from 'node:fs';
import path from 'node:path';
import exifr from 'exifr';
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import { ROOT, OUT, readJSON, writeJSON, trip } from './lib.mjs';

const SRC = path.join(ROOT, 'raw', 'photos');
const VSRC = path.join(ROOT, 'raw', 'video');
const DEST = path.join(ROOT, 'public', 'photos');
const VDEST = path.join(ROOT, 'public', 'video');
const exts = new Set(['.jpg', '.jpeg', '.png', '.heic', '.webp']);
const t = trip();
const dayByDate = Object.fromEntries(t.days.map((d) => [d.date, d.n]));
const localDate = (ms) => new Intl.DateTimeFormat('sv-SE', { timeZone: t.timezone }).format(new Date(ms));

// Tracks laden für Positions-Interpolation
const tracks = [];
const tdir = path.join(OUT, 'tracks');
if (fs.existsSync(tdir)) for (const f of fs.readdirSync(tdir)) {
  const g = readJSON(path.join(tdir, f));
  if (g.properties.times?.length) tracks.push(g);
}
// Tages-Segmente (build-timeline.mjs) ebenfalls als Positionsquelle
const ddir = path.join(OUT, 'days');
if (fs.existsSync(ddir)) for (const f of fs.readdirSync(ddir)) for (const s of readJSON(path.join(ddir, f)).segments)
  tracks.push({ properties: { id: s.id, times: s.times, cumDist: s.cum }, geometry: { coordinates: s.coords } });
function positionFromTracks(ms) {
  for (const g of tracks) {
    const ts = g.properties.times;
    if (ms < ts[0] || ms > ts.at(-1)) continue;
    let i = ts.findIndex((x) => x >= ms);
    const c = g.geometry.coordinates[Math.max(0, i)];
    return { lon: c[0], lat: c[1], track: g.properties.id, cumDist: g.properties.cumDist[Math.max(0, i)] };
  }
  return null;
}
// Ohne Track: Aufenthalt (Stopp aus der Timeline), in dessen Zeitraum die Aufnahme fällt
const stops = [];
if (fs.existsSync(ddir)) for (const f of fs.readdirSync(ddir)) for (const st of readJSON(path.join(ddir, f)).stops) stops.push(st);
function positionFromStops(ms) {
  const st = stops.find((s) => ms >= Date.parse(s.start) && ms <= Date.parse(s.end));
  return st ? { lat: st.lat, lon: st.lon } : null;
}
// Ohne Track: Position des zeitlich nächsten Fotos mit GPS (max. 20 min Abstand)
function positionFromPhotos(ms, list) {
  let best = null;
  for (const p of list) { if (p.lat == null) continue; const d = Math.abs(Date.parse(p.taken) - ms); if (d < 20 * 60000 && (!best || d < best.d)) best = { d, lat: p.lat, lon: p.lon }; }
  return best;
}

const walk = (d) => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(d, e.name)) : exts.has(path.extname(e.name).toLowerCase()) ? [path.join(d, e.name)] : []) : [];

const videoFiles = fs.existsSync(VSRC) ? fs.readdirSync(VSRC).filter((f) => /^PXL_\d{8}_\d{6}.*\.mp4$/i.test(f)).map((f) => path.join(VSRC, f)) : [];
const exclude = new Set(fs.existsSync(path.join(ROOT, 'data', 'exclude.json')) ? readJSON(path.join(ROOT, 'data', 'exclude.json')).ids : []);
const files = [...walk(SRC), ...videoFiles].filter((f) => !exclude.has(path.basename(f, path.extname(f)).replace(/[^\w-]+/g, '_')));
fs.mkdirSync(DEST, { recursive: true });
fs.mkdirSync(VDEST, { recursive: true });
const photos = [];
for (const file of files) {
  const id = path.basename(file, path.extname(file)).replace(/[^\w-]+/g, '_');
  const isVideo = /\.mp4$/i.test(file);
  let meta = {};
  if (!isVideo) {
    try { meta = (await exifr.parse(file, { pick: ['DateTimeOriginal', 'CreateDate'] })) ?? {}; } catch {}
    try { Object.assign(meta, (await exifr.gps(file)) ?? {}); } catch {}
  }
  const fn = id.match(/^PXL_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
  const taken = meta.DateTimeOriginal ?? meta.CreateDate ?? (fn ? `${fn[1]}-${fn[2]}-${fn[3]}T${fn[4]}:${fn[5]}:${fn[6]}Z` : fs.statSync(file).mtime);
  const ms = new Date(taken).getTime();
  let videoSrc = null, source4Sharp = file;
  if (isVideo) {
    // 720p/H.264 fürs Web (aus .cache übernehmen, falls schon konvertiert), Poster aus Sekunde 1
    const out = path.join(VDEST, `${id}.mp4`), cached = path.join(ROOT, '.cache', `${id}.mp4`), poster = path.join(ROOT, '.cache', `${id}_poster.jpg`);
    try {
      if (!fs.existsSync(out)) {
        if (fs.existsSync(cached)) fs.copyFileSync(cached, out);
        else execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vf', 'scale=-2:720,fps=30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '29', '-maxrate', '1800k', '-bufsize', '3600k', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '80k', out]);
      }
      if (!fs.existsSync(poster)) execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '1', '-i', file, '-frames:v', '1', '-q:v', '3', poster]);
    } catch (e) { console.warn(`  ${path.basename(file)}: ffmpeg fehlgeschlagen (${e.message})`); continue; }
    videoSrc = `video/${id}.mp4`; source4Sharp = poster;
  }
  let lat = meta.latitude, lon = meta.longitude, source = lat != null ? 'exif' : null, onTrack = null;
  const tp = positionFromTracks(ms);
  if (tp) onTrack = { track: tp.track, cumDist: tp.cumDist };
  if (lat == null && tp) { lat = tp.lat; lon = tp.lon; source = 'track'; }
  if (lat == null) { const sp = positionFromStops(ms); if (sp) { lat = sp.lat; lon = sp.lon; source = 'stop'; } }
  if (lat == null) { const np = positionFromPhotos(ms, photos); if (np) { lat = np.lat; lon = np.lon; source = 'photo'; } }

  const out = path.join(DEST, `${id}.webp`), thumb = path.join(DEST, `${id}_thumb.webp`);
  try {
    if (!fs.existsSync(out)) await sharp(source4Sharp).rotate().resize({ width: 1800, withoutEnlargement: true }).webp({ quality: 80 }).toFile(out);
    if (!fs.existsSync(thumb)) await sharp(source4Sharp).rotate().resize({ width: 360, height: 360, fit: 'cover' }).webp({ quality: 70 }).toFile(thumb);
  } catch (e) { console.warn(`  ${path.basename(file)}: Konvertierung fehlgeschlagen (${e.message})`); continue; }

  const date = localDate(ms);
  photos.push({ id, src: `photos/${id}.webp`, thumb: `photos/${id}_thumb.webp`, original: path.relative(SRC, file),
    taken: new Date(ms).toISOString(), date, day: dayByDate[date] ?? null, lat: lat ?? null, lon: lon ?? null, posSource: source, onTrack, caption: '', video: videoSrc });
}
photos.sort((a, b) => a.taken.localeCompare(b.taken));
for (const p of photos) if (p.lat == null) { const np = positionFromPhotos(Date.parse(p.taken), photos); if (np) { p.lat = np.lat; p.lon = np.lon; p.posSource = 'photo'; } }

// Bildunterschriften aus data/captions.json übernehmen (wird von Hand / von Claude gepflegt)
const capFile = path.join(ROOT, 'data', 'captions.json');
if (fs.existsSync(capFile)) { const caps = readJSON(capFile); for (const p of photos) p.caption = caps[p.id] ?? caps[p.original] ?? ''; }

writeJSON(path.join(OUT, 'photos.json'), photos);
console.log(`photos: ${photos.length} (davon mit Position: ${photos.filter((p) => p.lat != null).length})`);
