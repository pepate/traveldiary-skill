// Bootsrouten auf Flüssen/Kanälen: OSM-Wasserwege (Overpass, gecacht in data/waterways.json) als Graph,
// Seen ohne Fahrrinne werden über Verbindungen zwischen offenen Flussenden überbrückt.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJSON, writeJSON, haversine, trip } from './lib.mjs';

const FILE = path.join(ROOT, 'data', 'waterways.json');
// Schiffbar: trip.json → timeline.waterways { rivers: [...], canals: [...] } (Namen wie in OSM, ohne Angabe: alle Flüsse/Kanäle)
// plus kurze unbenannte Schleusenkanäle. Bei Netzen mit vielen Kanälen Namen angeben – lange Nebenkanäle führen sonst in die Irre.
// Beispiel Shannon: { "rivers": ["Shannon", "Boyle"], "canals": ["Jamestown Canal", "Boyle Canal", "Victoria Lock", "Cloondara Canal"] }
const cfg = trip().timeline?.waterways ?? {};
const names = (list) => (list?.length ? new Set(list.map((x) => x.toLowerCase())) : null);
const RIVERS = names(cfg.rivers), CANALS = names(cfg.canals), SHORT_CANAL_M = 1500;
const JUMP_M = 30000, JUMP_FACTOR = 1.1, ENTRY_FACTOR = 3, SNAP_M = 2500, VIA_M = 300;
const lengthOf = (c) => { let s = 0; for (let i = 1; i < c.length; i++) s += haversine(c[i - 1], c[i]); return s; };
const navigable = (w) => {
  const name = w.tags.name ?? '', coords = w.geometry.map((g) => [g.lon, g.lat]);
  if (w.tags.waterway === 'river') return !RIVERS || RIVERS.has(name.toLowerCase());
  return !CANALS || CANALS.has(name.toLowerCase()) || (!name && lengthOf(coords) <= SHORT_CANAL_M);
};

export async function loadWaterways(bbox) {
  if (!fs.existsSync(FILE)) {
    const [s, w, n, e] = bbox.map((x) => +x.toFixed(3));
    const q = `[out:json][timeout:120];way["waterway"~"^(river|canal)$"](${s},${w},${n},${e});out geom;`;
    const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: new URLSearchParams({ data: q }), headers: { 'User-Agent': 'traveldiary/1.0' } });
    if (!r.ok) throw new Error(`Overpass ${r.status}`);
    const j = await r.json();
    writeJSON(FILE, j.elements.filter(navigable)
      .map((x) => ({ name: x.tags.name ?? x.tags.waterway, coords: x.geometry.map((g) => [+g.lon.toFixed(6), +g.lat.toFixed(6)]) })));
  }
  return buildGraph(readJSON(FILE));
}

function buildGraph(ways) {
  const nodes = [], index = new Map(), adj = [];
  const id = (c) => { const k = `${c[0]},${c[1]}`; if (!index.has(k)) { index.set(k, nodes.length); nodes.push(c); adj.push([]); } return index.get(k); };
  const link = (a, b, w) => { adj[a].push([b, w]); adj[b].push([a, w]); };
  for (const way of ways) for (let i = 1; i < way.coords.length; i++) {
    const a = id(way.coords[i - 1]), b = id(way.coords[i]);
    link(a, b, haversine(nodes[a], nodes[b]));
  }
  // Seen überbrücken: getrennte Flussstücke über die kürzeste Verbindung offener Enden koppeln (Kruskal),
  // nie innerhalb eines Stücks – sonst würden Flussschleifen über Land abgekürzt
  const root = nodes.map((_, i) => i);
  const find = (i) => (root[i] === i ? i : (root[i] = find(root[i])));
  adj.forEach((e, i) => e.forEach(([j]) => { root[find(i)] = find(j); }));
  const ends = adj.map((e, i) => (e.length === 1 ? i : -1)).filter((i) => i >= 0), pairs = [];
  for (let x = 0; x < ends.length; x++) for (let y = x + 1; y < ends.length; y++) {
    const d = haversine(nodes[ends[x]], nodes[ends[y]]);
    if (d < JUMP_M && find(ends[x]) !== find(ends[y])) pairs.push([d, ends[x], ends[y]]);
  }
  for (const [d, a, b] of pairs.sort((p, q) => p[0] - q[0])) if (find(a) !== find(b)) { root[find(a)] = find(b); link(a, b, d * JUMP_FACTOR); }
  return { nodes, adj };
}

function nearest(g, c, max) {
  let best = -1, bd = max;
  for (let i = 0; i < g.nodes.length; i++) { const d = haversine(c, g.nodes[i]); if (d < bd) { bd = d; best = i; } }
  return best;
}

function dijkstra(g, from, to) {
  const dist = new Float64Array(g.nodes.length).fill(Infinity), prev = new Int32Array(g.nodes.length).fill(-1);
  const heap = [[0, from]]; dist[from] = 0;
  const push = (it) => { heap.push(it); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [d, u] = pop();
    if (u === to) break;
    if (d > dist[u]) continue;
    for (const [v, w] of g.adj[u]) if (d + w < dist[v]) { dist[v] = d + w; prev[v] = u; push([d + w, v]); }
  }
  if (dist[to] === Infinity) return null;
  const path = []; for (let u = to; u !== -1; u = prev[u]) path.push(g.nodes[u]);
  return path.reverse();
}

// Start/Ziel als eigener Knoten mit Kanten zu allen Flusspunkten im Umkreis – die Suche wählt den günstigsten Einstieg
// (ein Hafen im See liegt oft näher an einem falschen Flussarm)
function addVirtual(g, c) {
  const v = g.nodes.length;
  g.nodes.push(c); g.adj.push([]);
  for (let i = 0; i < v; i++) { const d = haversine(c, g.nodes[i]); if (d < SNAP_M) { g.adj[v].push([i, d * ENTRY_FACTOR]); g.adj[i].push([v, d * ENTRY_FACTOR]); } }
  return v;
}
function removeVirtual(g) {
  const v = g.nodes.length - 1;
  for (const [i] of g.adj[v]) g.adj[i] = g.adj[i].filter(([j]) => j !== v);
  g.nodes.pop(); g.adj.pop();
}

// Wegpunkte (Start, Fotopositionen, Ziel) → Route über den Wasserweg-Graphen; null, wenn Start/Ziel nicht am Wasser liegen
export function routeOnWater(g, pts) {
  // Zwischenpunkte nur direkt am Fluss (Punkte im See oder an Land würden Umwege erzwingen)
  const vias = pts.slice(1, -1).map((c) => nearest(g, c, VIA_M)).filter((n) => n >= 0);
  const s = addVirtual(g, pts[0]), e = addVirtual(g, pts.at(-1));
  try {
    if (!g.adj[s].length || !g.adj[e].length) return null;
    const seq = [s, ...vias, e].filter((n, i, a) => n !== a[i - 1]);
    const out = [];
    for (let i = 1; i < seq.length; i++) {
      const part = dijkstra(g, seq[i - 1], seq[i]);
      if (!part) return null;
      out.push(...(out.length ? part.slice(1) : part));
    }
    return out.length > 1 ? out : null;
  } finally { removeVirtual(g); removeVirtual(g); }
}
