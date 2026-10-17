// raw/gpx/*.gpx → public/data/tracks/<name>.geojson  +  public/data/tracks.json (Statistik)
// Dateinamen-Konvention: YYYY-MM-DD_<slug>.gpx  (Datum = Reisetag)
import fs from 'node:fs';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { gpx } from '@tmcw/togeojson';
import { ROOT, OUT, writeJSON, haversine } from './lib.mjs';

const dir = path.join(ROOT, 'raw', 'gpx');
const index = {};
for (const file of (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((f) => f.toLowerCase().endsWith('.gpx'))) {
  const id = path.basename(file, path.extname(file));
  const doc = new DOMParser().parseFromString(fs.readFileSync(path.join(dir, file), 'utf8'), 'text/xml');
  const fc = gpx(doc);
  const line = fc.features.find((f) => f.geometry?.type === 'LineString' || f.geometry?.type === 'MultiLineString');
  if (!line) { console.warn(`  ${file}: keine Linie gefunden`); continue; }
  const coords = line.geometry.type === 'LineString' ? line.geometry.coordinates : line.geometry.coordinates.flat();
  const times = (line.properties.coordinateProperties?.times ?? []).flat().map((t) => Date.parse(t));

  // Statistik (Höhe geglättet, um GPS-Rauschen zu dämpfen)
  let dist = 0, moving = 0, up = 0, down = 0;
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    const d = haversine(coords[i - 1], coords[i]);
    dist += d; cum.push(dist);
    const dt = (times[i] - times[i - 1]) / 1000;
    if (dt > 0 && dt < 120 && d / dt > 0.5) moving += dt;
  }
  const ele = coords.map((c) => c[2] ?? 0);
  const w = 5;
  const sm = ele.map((_, i) => { const s = ele.slice(Math.max(0, i - w), i + w + 1); return s.reduce((a, b) => a + b, 0) / s.length; });
  for (let i = 1; i < sm.length; i++) { const d = sm[i] - sm[i - 1]; d > 0 ? (up += d) : (down -= d); }

  const out = {
    type: 'Feature',
    properties: {
      id, name: line.properties.name ?? id,
      // pro Punkt: Zeit (ms) und kumulierte Distanz (m) → für Animation & Foto-Matching
      times, cumDist: cum.map((x) => Math.round(x)),
    },
    geometry: { type: 'LineString', coordinates: coords.map(([x, y, z]) => [+x.toFixed(6), +y.toFixed(6), z != null ? Math.round(z) : 0]) },
  };
  writeJSON(path.join(OUT, 'tracks', `${id}.geojson`), out);
  index[id] = {
    name: out.properties.name,
    date: id.slice(0, 10),
    distanceKm: +(dist / 1000).toFixed(2),
    ascentM: Math.round(up), descentM: Math.round(down),
    minEle: Math.round(Math.min(...ele)), maxEle: Math.round(Math.max(...ele)),
    start: times[0] ? new Date(times[0]).toISOString() : null,
    end: times.at(-1) ? new Date(times.at(-1)).toISOString() : null,
    movingMin: Math.round(moving / 60),
    points: coords.length,
  };
  console.log(`  ${id}: ${index[id].distanceKm} km, ↑${index[id].ascentM} m`);
}
writeJSON(path.join(OUT, 'tracks.json'), index);
console.log(`tracks: ${Object.keys(index).length}`);

