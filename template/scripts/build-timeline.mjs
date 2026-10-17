// raw/timeline/Zeitachse.json (Google-Timeline-Export) + public/data/tracks/*.geojson
//   → public/data/days/day-<n>.json  (alle Bewegungs-Segmente und Stopps eines Tages, chronologisch)
//
// - Aktivitäten (Auto, Rad, zu Fuß, Fähre) werden aus den Rohpositionen aufgebaut und über OSRM
//   (routing.openstreetmap.de, Profile car/bike/foot) auf Straßen und Wege gelegt.
// - Höhen kommen von Open-Meteo (Elevation-API). Beides wird in data/timeline/ gecacht (einchecken!),
//   damit der Build offline läuft.
// - Komoot/Uhr-GPX (bereits von build-tracks.mjs gebaut) hat Vorrang: überlappende Timeline-Aktivitäten entfallen.
// - Steuerung über data/trip.json → "timeline": { ignoreBefore, kinds: {start: kind}, labels: {start: text} }
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT, OUT, readJSON, writeJSON, trip, haversine } from './lib.mjs';
import { loadWaterways, routeOnWater } from './waterway.mjs';

const SRC = path.join(ROOT, 'raw', 'timeline', 'Zeitachse.json');
const CACHE = path.join(ROOT, 'data', 'timeline');
const t = trip();
const cfg = t.timeline ?? {};
const KIND = {
  IN_PASSENGER_VEHICLE: 'camper', IN_VEHICLE: 'camper', CYCLING: 'ebike', ON_BICYCLE: 'ebike', SKIING: 'ebike', MOTORCYCLING: 'ebike',
  WALKING: 'walk', ON_FOOT: 'walk', RUNNING: 'walk', HIKING: 'hike', IN_FERRY: 'ferry', IN_BUS: 'bus', IN_TRAIN: 'train', SAILING: 'boat',
};
const PROFILE = { camper: ['car'], car: ['car'], ebike: ['bike', 'foot'], bike: ['bike', 'foot'], walk: ['foot'], hike: ['foot'] };
const MERGE_GAP_MIN = 20;   // gleiche Art, kurze Pause dazwischen → ein Segment
const MIN_DIST_M = 600;     // kürzere Aktivitäten ignorieren
const MIN_STOP_MIN = 10;    // kürzere Aufenthalte ignorieren

const ll = (s) => { const [a, b] = s.replace(/°/g, '').split(',').map(Number); return [b, a]; };   // "lat°, lon°" → [lon, lat]
const localKey = (iso) => iso.slice(0, 16);           // "YYYY-MM-DDTHH:MM" (Export enthält lokale Zeit mit Offset)
const dayOf = (iso) => t.days.find((d) => d.date === iso.slice(0, 10))?.n ?? null;
const dist = (coords) => { let s = 0; for (let i = 1; i < coords.length; i++) s += haversine(coords[i - 1], coords[i]); return s; };
const cumOf = (coords) => { const c = [0]; for (let i = 1; i < coords.length; i++) c.push(c[i - 1] + haversine(coords[i - 1], coords[i])); return c; };

// Ohne Google-Zeitachse: leere Rohdaten – Fahrten kommen dann aus trip.json → days[].legs (siehe unten)
const raw = fs.existsSync(SRC) ? readJSON(SRC) : { semanticSegments: [], rawSignals: [] };
if (!fs.existsSync(SRC)) console.log('  keine Zeitachse (raw/timeline/Zeitachse.json) – nur GPX und manuelle Etappen');
const ignoreBefore = cfg.ignoreBefore ?? `${t.start}T00:00`;

// Rohpositionen (für Wegpunkte)
const positions = raw.rawSignals
  .map((r) => r.position).filter((p) => p && p.timestamp >= t.start && p.accuracyMeters <= 150)
  .map((p) => ({ ms: Date.parse(p.timestamp), c: ll(p.LatLng), acc: p.accuracyMeters }))
  .sort((a, b) => a.ms - b.ms);
// Fotos mit EXIF-GPS als zusätzliche Wegpunkte für Boot/Fähre (die Timeline hat auf dem Wasser oft nur Start und Ziel)
const PHOTOS = path.join(OUT, 'photos.json');
const photoPts = fs.existsSync(PHOTOS) ? readJSON(PHOTOS).filter((p) => p.posSource === 'exif' && p.lat != null)
  .map((p) => ({ ms: Date.parse(p.taken), c: [p.lon, p.lat], acc: 20 })) : [];

// Aktivitäten und Aufenthalte
const ignoreAfter = cfg.ignoreAfter ?? `${t.end}T23:59`;
const segs = raw.semanticSegments.filter((s) => s.startTime >= ignoreBefore && s.startTime <= ignoreAfter && (s.activity || s.visit));
let acts = [], stops = [];
for (const s of segs) {
  const startMs = Date.parse(s.startTime), endMs = Date.parse(s.endTime);
  if (s.activity) {
    const a = s.activity, type = a.topCandidate?.type ?? 'UNKNOWN';
    const kind = cfg.kinds?.[localKey(s.startTime)] ?? KIND[type];
    if (!kind) { console.warn(`  ${localKey(s.startTime)}: unbekannte Aktivität ${type}`); continue; }
    if ((a.distanceMeters ?? 0) < MIN_DIST_M) continue;
    // Ausreißer entfernen: Punkte, die eine unplausible Geschwindigkeit zum letzten behaltenen Punkt bedeuten
    const vmax = { walk: 2.5, hike: 2.5, ebike: 14, bike: 14, ferry: 12, boat: 6 }[kind] ?? 50;
    const kept = [];
    const src = kind === 'boat' || kind === 'ferry' ? [...positions, ...photoPts].sort((a, b) => a.ms - b.ms) : positions;
    for (const p of src.filter((p) => p.ms >= startMs && p.ms <= endMs)) {
      const q = kept.at(-1);
      if (q && haversine(q.c, p.c) / Math.max(1, (p.ms - q.ms) / 1000) > vmax) continue;
      kept.push(p);
    }
    let pts = kept.map((p) => p.c);
    const accs = kept.map((p) => p.acc);
    const first = ll(a.start.latLng), last = ll(a.end.latLng);
    if (!pts.length || haversine(pts[0], first) > 200) { pts.unshift(first); accs.unshift(30); }
    if (haversine(pts.at(-1), last) > 200) { pts.push(last); accs.push(30); }
    acts.push({ start: s.startTime, end: s.endTime, startMs, endMs, kind, type, pts, accs, starts: [localKey(s.startTime)], rawDist: a.distanceMeters ?? dist(pts) });
  } else if (s.visit) {
    const minutes = (endMs - startMs) / 60000;
    if (minutes < MIN_STOP_MIN) continue;
    stops.push({ start: s.startTime, end: s.endTime, startMs, endMs, c: ll(s.visit.topCandidate.placeLocation.latLng) });
  }
}

// Doppelte/überlappende Aufenthalte zusammenfassen (Timeline liefert gern zwei Kandidaten für denselben Zeitraum)
stops.sort((a, b) => a.startMs - b.startMs);
stops = stops.filter((s, i) => !(i > 0 && s.startMs < stops[i - 1].endMs && haversine(s.c, stops[i - 1].c) < 300));

// Gleichartige Aktivitäten mit kurzer Pause verbinden
acts.sort((a, b) => a.startMs - b.startMs);
const merged = [];
for (const a of acts) {
  const prev = merged.at(-1);
  if (prev && prev.kind === a.kind && (a.startMs - prev.endMs) / 60000 <= MERGE_GAP_MIN) {
    prev.end = a.end; prev.endMs = a.endMs; prev.pts.push(...a.pts); prev.accs.push(...a.accs); prev.starts.push(...a.starts); prev.rawDist += a.rawDist;
  } else merged.push({ ...a });
}

// GPX-Tracks (Vorrang) einlesen
const trackIndex = fs.existsSync(path.join(OUT, 'tracks.json')) ? readJSON(path.join(OUT, 'tracks.json')) : {};
const gpxSegs = [];
for (const d of t.days) for (const tr of d.tracks ?? []) {
  const f = path.join(OUT, 'tracks', `${tr.file}.geojson`);
  if (!fs.existsSync(f)) { console.warn(`  Track fehlt: ${tr.file}`); continue; }
  const g = readJSON(f), st = trackIndex[tr.file];
  const coords = g.geometry.coordinates, times = g.properties.times;
  gpxSegs.push({
    id: tr.file, day: d.n, kind: tr.kind, label: tr.name ?? st?.name, source: 'gpx',
    start: st?.start, end: st?.end, startMs: times[0], endMs: times.at(-1),
    coords, cum: g.properties.cumDist, times,
    distanceM: Math.round(st.distanceKm * 1000), movingMin: st.movingMin, ascentM: st.ascentM, descentM: st.descentM,
  });
}
const overlapsGpx = (a) => gpxSegs.some((g) => Math.min(a.endMs, g.endMs) - Math.max(a.startMs, g.startMs) > 0.3 * (a.endMs - a.startMs));

// ---- Routing + Höhen (gecacht) ----
fs.mkdirSync(CACHE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchJSON(url) {
  for (let i = 0; ; i++) {
    const r = await fetch(url);
    if (r.status === 429 && i < 4) { await sleep(5000 * (i + 1)); continue; }
    if (!r.ok) throw new Error(`${r.status} ${url.slice(0, 80)}`);
    await sleep(1200); // Fair-Use der öffentlichen Server
    return r.json();
  }
}

function thin(pts, accs, max, minGap = 40) {
  const out = [pts[0]], oa = [accs[0]];
  for (let i = 1; i < pts.length; i++) if (haversine(out.at(-1), pts[i]) > minGap) { out.push(pts[i]); oa.push(accs[i]); }
  if (out.length <= max) return [out, oa];
  const step = (out.length - 1) / (max - 1);
  const idx = Array.from({ length: max }, (_, i) => Math.round(i * step));
  return [idx.map((i) => out[i]), idx.map((i) => oa[i])];
}
const fmt = (pts) => pts.map((p) => p.map((x) => x.toFixed(5)).join(',')).join(';');
// Routing über ausgedünnte Wegpunkte; bei unplausibler Länge mit weniger Wegpunkten erneut
async function snap(kind, pts, accs, rawDist) {
  const profiles = PROFILE[kind];
  if (!profiles) return null;
  const plausible = (c) => dist(c) < 1.5 * rawDist + 1000 && dist(c) > 0.6 * rawDist;
  // Kandidaten sammeln; erster plausibler mit 25 Wegpunkten gewinnt, sonst der mit der kleinsten Längenabweichung
  const cands = [];
  for (const profile of profiles) for (const n of [25, 10, 4]) {
    const [wp] = thin(pts, accs, n, 200);
    if (wp.length < 2) return null;
    const j = await fetchJSON(`https://routing.openstreetmap.de/routed-${profile}/route/v1/driving/${fmt(wp)}?overview=full&geometries=geojson`);
    const coords = j.routes?.[0]?.geometry?.coordinates;
    if (!coords) continue;
    const c = { coords, source: `osrm-${profile}${n}`, dev: Math.abs(dist(coords) - rawDist) };
    if (n === 25 && plausible(coords)) return c;
    cands.push(c);
    console.warn(`    ${profile}/${n} Wegpunkte: ${(dist(coords) / 1000).toFixed(1)} km vs ${(rawDist / 1000).toFixed(1)} km`);
  }
  return cands.sort((a, b) => a.dev - b.dev)[0] ?? null;
}
function resample(coords, stepM) {
  const out = [coords[0]];
  let carry = 0;
  for (let i = 1; i < coords.length; i++) {
    const [a, b] = [coords[i - 1], coords[i]], d = haversine(a, b);
    let s = stepM - carry;
    while (s <= d) { const f = s / d; out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]); s += stepM; }
    carry = d - (s - stepM);
  }
  if (haversine(out.at(-1), coords.at(-1)) > 1) out.push(coords.at(-1));
  return out;
}
// Höhen aus AWS-Terrarium-Kacheln (keyless). Kacheln werden lokal in .cache/ abgelegt.
const TILE_Z = 13, TILE_DIR = path.join(ROOT, '.cache', 'terrarium');
const tileCache = new Map();
async function tile(x, y) {
  const key = `${x}-${y}`;
  if (tileCache.has(key)) return tileCache.get(key);
  const f = path.join(TILE_DIR, `${TILE_Z}-${key}.png`);
  if (!fs.existsSync(f)) {
    fs.mkdirSync(TILE_DIR, { recursive: true });
    const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${TILE_Z}/${x}/${y}.png`);
    if (!r.ok) throw new Error(`tile ${r.status}`);
    fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  }
  const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject: true });
  const t = { data, ch: info.channels, w: info.width };
  tileCache.set(key, t);
  return t;
}
async function elevations(coords) {
  const n = 2 ** TILE_Z, out = [];
  for (const [lon, lat] of coords) {
    const xf = ((lon + 180) / 360) * n;
    const yf = ((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2) * n;
    const tx = Math.floor(xf), ty = Math.floor(yf);
    const t = await tile(tx, ty);
    const px = Math.min(t.w - 1, Math.floor((xf - tx) * t.w)), py = Math.min(t.w - 1, Math.floor((yf - ty) * t.w));
    const i = (py * t.w + px) * t.ch;
    out.push(t.data[i] * 256 + t.data[i + 1] + t.data[i + 2] / 256 - 32768);
  }
  return out;
}
function upDown(ele, w = 3) {
  const sm = ele.map((_, i) => { const s = ele.slice(Math.max(0, i - w), i + w + 1); return s.reduce((a, b) => a + b, 0) / s.length; });
  let up = 0, down = 0;
  for (let i = 1; i < sm.length; i++) { const d = sm[i] - sm[i - 1]; d > 0 ? (up += d) : (down -= d); }
  return { up: Math.round(up), down: Math.round(down) };
}

// Hausboot: Wasserwege aus OSM als Graph (nur laden, wenn es Bootsfahrten gibt)
const boats = merged.filter((a) => a.kind === 'boat');
let water = null;
if (boats.length) {
  const all = boats.flatMap((a) => a.pts), lons = all.map((c) => c[0]), lats = all.map((c) => c[1]);
  try { water = await loadWaterways([Math.min(...lats) - 0.05, Math.min(...lons) - 0.05, Math.max(...lats) + 0.05, Math.max(...lons) + 0.05]); }
  catch (e) { console.warn(`  Wasserwege nicht geladen (${e.message}) → Rohpunkte`); }
}

const result = [];
for (const a of merged) {
  if (overlapsGpx(a)) { console.log(`  ${localKey(a.start)} ${a.kind}: durch GPX ersetzt`); continue; }
  const id = `${localKey(a.start).replace(/[:T]/g, '-')}_${a.kind}`;
  const cacheFile = path.join(CACHE, `${id}.json`);
  let c = fs.existsSync(cacheFile) ? readJSON(cacheFile) : null;
  if (!c) {
    c = { coords: thin(a.pts, a.accs, 1e9, 120)[0], source: 'raw' };
    // Google unterschätzt die Distanz bei Lücken – Referenz ist das Maximum aus Google-Angabe und ausgedünnter Rohspur
    a.rawDist = Math.max(a.rawDist, dist(c.coords));
    const route = a.kind === 'boat' && water ? routeOnWater(water, thin(a.pts, a.accs, 40, 800)[0]) : null;
    if (route) c = { coords: route, source: 'waterway' };
    else try {
      const r = await snap(a.kind, a.pts, a.accs, a.rawDist);
      if (r && dist(r.coords) < 1.5 * a.rawDist + 1000 && dist(r.coords) > 0.6 * a.rawDist) c = r;
      else if (r) console.warn(`  ${id}: Route unplausibel → Rohpunkte`);
    } catch (e) { console.warn(`  ${id}: Routing fehlgeschlagen (${e.message.slice(0, 80)}) → Rohpunkte`); }
    const step = a.kind === 'camper' || a.kind === 'car' ? 250 : a.kind === 'walk' || a.kind === 'hike' ? 25 : 60;
    c.coords = resample(c.coords, step).slice(0, 1500);
    try { const ele = await elevations(c.coords); c.coords = c.coords.map((p, i) => [+p[0].toFixed(6), +p[1].toFixed(6), Math.round(ele[i])]); }
    catch (e) { console.warn(`  ${id}: Höhen fehlgeschlagen (${e.message})`); c.coords = c.coords.map((p) => [+p[0].toFixed(6), +p[1].toFixed(6), 0]); }
    writeJSON(cacheFile, c);
  }
  const cum = cumOf(c.coords).map(Math.round), total = cum.at(-1);
  const { up, down } = upDown(c.coords.map((p) => p[2]));
  result.push({
    id, day: dayOf(a.start), kind: a.kind, label: a.starts.map((k) => cfg.labels?.[k]).find(Boolean) ?? null, source: c.source,
    start: a.start, end: a.end, startMs: a.startMs, endMs: a.endMs,
    coords: c.coords, cum, times: cum.map((d) => Math.round(a.startMs + (a.endMs - a.startMs) * (total ? d / total : 0))),
    distanceM: total, movingMin: Math.round((a.endMs - a.startMs) / 60000), ascentM: up, descentM: down,
  });
  console.log(`  ${localKey(a.start)} ${a.kind.padEnd(6)} ${(total / 1000).toFixed(1).padStart(6)} km  ↑${up} m  (${c.source})`);
}

// ---- Manuelle Etappen (ohne Zeitachse): days[].legs → OSRM-Route zwischen zwei Orten ----
for (const d of t.days) for (const [i, leg] of (d.legs ?? []).entries()) {
  const A = t.places[leg.from], B = t.places[leg.to];
  if (!A || !B) { console.warn(`  Tag ${d.n}, Etappe ${i + 1}: Ort fehlt (${leg.from} / ${leg.to})`); continue; }
  const kind = leg.kind ?? 'camper';
  const startMs = Date.parse(`${d.date}T${leg.start ?? '09:00'}:00`), endMs = Date.parse(`${d.date}T${leg.end ?? '12:00'}:00`);
  const id = `${d.date}_leg${i + 1}_${kind}`, cacheFile = path.join(CACHE, `${id}.json`);
  let c = fs.existsSync(cacheFile) ? readJSON(cacheFile) : null;
  if (!c) {
    const pts = [[A.lon, A.lat], [B.lon, B.lat]];
    c = { coords: pts, source: 'straight' };
    try { const r = await snap(kind, pts, [30, 30], haversine(pts[0], pts[1]) * 1.3); if (r) c = r; } catch (e) { console.warn(`  ${id}: Routing fehlgeschlagen (${e.message.slice(0, 60)})`); }
    const step = kind === 'camper' || kind === 'car' ? 250 : 60;
    c.coords = resample(c.coords, step).slice(0, 1500);
    try { const ele = await elevations(c.coords); c.coords = c.coords.map((p, k) => [+p[0].toFixed(6), +p[1].toFixed(6), Math.round(ele[k])]); }
    catch { c.coords = c.coords.map((p) => [+p[0].toFixed(6), +p[1].toFixed(6), 0]); }
    writeJSON(cacheFile, c);
  }
  const cum = cumOf(c.coords).map(Math.round), total = cum.at(-1);
  const { up, down } = upDown(c.coords.map((p) => p[2]));
  result.push({ id, day: d.n, kind, label: leg.label ?? `${A.name} → ${B.name}`, source: c.source, start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(), startMs, endMs,
    coords: c.coords, cum, times: cum.map((x) => Math.round(startMs + (endMs - startMs) * (total ? x / total : 0))), distanceM: total, movingMin: Math.round((endMs - startMs) / 60000), ascentM: up, descentM: down });
  console.log(`  Tag ${d.n} Etappe ${i + 1}: ${(total / 1000).toFixed(1)} km (${c.source})`);
}

// ---- Pro Tag zusammenführen ----
const nearestPlace = (c) => {
  let best = null, bd = 400;
  for (const [id, p] of Object.entries(t.places)) { const d = haversine(c, [p.lon, p.lat]); if (d < bd) { bd = d; best = { id, ...p }; } }
  return best;
};
fs.mkdirSync(path.join(OUT, 'days'), { recursive: true });
for (const d of t.days) {
  const segments = [...result, ...gpxSegs].filter((s) => s.day === d.n).sort((a, b) => a.startMs - b.startMs);
  const dayStops = stops.filter((s) => s.start.slice(0, 10) === d.date).map((s) => {
    const p = nearestPlace(s.c);
    return { start: s.start, end: s.end, lon: +s.c[0].toFixed(5), lat: +s.c[1].toFixed(5), label: p?.name ?? (t.lang === 'en' ? 'Stop' : 'Pause'), place: p?.id ?? null, minutes: Math.round((s.endMs - s.startMs) / 60000) };
  });
  const byKind = {};
  for (const s of segments) byKind[s.kind] = (byKind[s.kind] ?? 0) + s.distanceM;
  writeJSON(path.join(OUT, 'days', `day-${d.n}.json`), {
    n: d.n, date: d.date, title: d.title,
    stats: { byKindM: byKind, ascentM: segments.reduce((a, s) => a + s.ascentM, 0), movingMin: segments.reduce((a, s) => a + s.movingMin, 0) },
    segments: segments.map(({ day, startMs, endMs, ...s }) => s),
    stops: dayStops,
  });
  console.log(`Tag ${d.n}: ${segments.length} Segmente, ${dayStops.length} Stopps`);
}
