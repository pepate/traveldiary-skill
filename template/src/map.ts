import maplibregl, { type GeoJSONSource, type LngLatBoundsLike, type PaddingOptions } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerCode from 'maplibre-gl/dist/maplibre-gl-csp-worker.js?raw';

// Als lokale Datei geöffnet (Single-File auf dem Handy): Blob-Worker sind dort je nach Browser blockiert → Worker als data:-URL einbetten
if (location.protocol === 'file:') {
  const url = 'data:application/javascript;base64,' + btoa(unescape(encodeURIComponent(workerCode)));
  (maplibregl as any).setWorkerUrl ? (maplibregl as any).setWorkerUrl(url) : ((maplibregl as any).workerUrl = url);
}
import type { DayData, Kind, LngLat, Photo, Poi, Segment, Stop } from './types';
import { T, LANG } from './i18n';

// Satellit (Esri World Imagery) + Gelände (AWS Terrarium) – beides ohne API-Key.
const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    sat: {
      type: 'raster', tileSize: 256, maxzoom: 19,
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      attribution: 'Esri, Maxar, Earthstar Geographics',
    },
    dem: {
      type: 'raster-dem', tileSize: 256, maxzoom: 14, encoding: 'terrarium',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      attribution: 'Terrain: Mapzen/AWS',
    },
    // Ortsnamen (OpenMapTiles-Schema) von OpenFreeMap, ohne Key
    omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '© OpenMapTiles © OpenStreetMap' },
  },
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#07090c' } },
    { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-brightness-max': 0.82, 'raster-saturation': -0.2, 'raster-contrast': 0.08, 'raster-fade-duration': 300 } },
    { id: 'shade', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#000', 'hillshade-highlight-color': '#fff', 'hillshade-accent-color': '#000' } },
  ],
};

export const COLORS: Record<Kind, string> = {
  camper: '#ff8a3d', car: '#c7c9cf', ebike: '#2ee6c5', bike: '#2ee6c5',
  walk: '#c3f53c', hike: '#c3f53c', ferry: '#6aa9ff', bus: '#c7c9cf', train: '#c7c9cf',
};
export const ICONS: Record<Kind, string> = {
  camper: '🚐', car: '🚗', ebike: '🚲', bike: '🚲', walk: '🚶', hike: '🥾', ferry: '⛴️', bus: '🚌', train: '🚆',
};

type Line = { kind: Kind; coords: LngLat[] };
type FC = GeoJSON.FeatureCollection<GeoJSON.LineString, { kind: string; color: string }>;
const fc = (lines: Line[]): FC => ({
  type: 'FeatureCollection',
  features: lines.filter((l) => l.coords.length > 1).map((l) => ({
    type: 'Feature',
    properties: { kind: l.kind, color: COLORS[l.kind] ?? '#fff' },
    geometry: { type: 'LineString', coordinates: l.coords as number[][] },
  })),
});

export function showBanner(msg: string) {
  let el = document.getElementById('banner');
  if (!el) { el = document.createElement('div'); el.id = 'banner'; el.className = 'error'; el.addEventListener('click', () => el!.remove()); document.body.append(el); }
  el.textContent = msg;
}

export class TripMap {
  readonly map: maplibregl.Map;
  readonly ready: Promise<void>;
  private markers: maplibregl.Marker[] = [];
  padding: PaddingOptions = { top: 80, bottom: 80, left: 24, right: 24 };

  onPoi: (p: Poi) => void = () => {};
  poisForDay: (n: number) => Poi[] = () => [];

  constructor(container: HTMLElement, private days: Map<number, DayData>, private photos: Photo[], private onPhoto: (p: Photo) => void) {
    this.map = new maplibregl.Map({
      container, style: STYLE, center: [8.8, 47.3], zoom: 6, pitch: 0,
      attributionControl: { compact: true }, maxPitch: 70, antialias: false, fadeDuration: 150,
    });
    this.map.on('error', (e) => { console.error('MapLibre:', e.error?.message ?? e); if (/worker|WebGL|shader/i.test(String(e.error?.message))) showBanner(`${T.mapError}: ${e.error?.message}`); });
    // 'style.load' statt 'load': 'load' wartet auf alle Start-Kacheln und hängt bei langsamen Tile-Servern
    this.ready = new Promise((res) => this.map.once('style.load', () => { this.setupLayers(); res(); }));
    (window as any).__tripMap = this;
  }

  private setupLayers() {
    const m = this.map;
    const lineLayout = { 'line-cap': 'round' as const, 'line-join': 'round' as const };
    m.addSource('past', { type: 'geojson', data: fc([]) });
    m.addSource('day', { type: 'geojson', data: fc([]) });
    m.addSource('live', { type: 'geojson', data: fc([]) });
    m.addLayer({ id: 'past-line', type: 'line', source: 'past', layout: lineLayout, paint: { 'line-color': ['get', 'color'], 'line-width': 2.5, 'line-opacity': 0.4 } });
    for (const src of ['day', 'live']) {
      m.addLayer({ id: `${src}-casing`, type: 'line', source: src, layout: lineLayout, paint: { 'line-color': '#000', 'line-width': 8, 'line-opacity': 0.45, 'line-blur': 2 } });
      m.addLayer({ id: `${src}-line`, type: 'line', source: src, layout: lineLayout, filter: ['!=', ['get', 'kind'], 'ferry'], paint: { 'line-color': ['get', 'color'], 'line-width': 4 } });
      m.addLayer({ id: `${src}-ferry`, type: 'line', source: src, filter: ['==', ['get', 'kind'], 'ferry'], paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-dasharray': [1.2, 1.6] } });
    }
    // Beschriftungen über den Linien: Seen, Orte, Städte
    const halo = { 'text-color': '#f3efe8', 'text-halo-color': 'rgba(0,0,0,.85)', 'text-halo-width': 1.4 };
    m.addLayer({ id: 'lbl-water', type: 'symbol', source: 'omt', 'source-layer': 'water_name', minzoom: 7,
      filter: ['==', ['get', 'class'], 'lake'],
      layout: { 'text-field': ['coalesce', ['get', `name:${LANG}`], ['get', 'name']], 'text-font': ['Noto Sans Italic'], 'text-size': 12, 'text-letter-spacing': 0.1, 'symbol-placement': 'point' },
      paint: { ...halo, 'text-color': '#bfe3ff', 'text-opacity': 0.9 } });
    m.addLayer({ id: 'lbl-place', type: 'symbol', source: 'omt', 'source-layer': 'place',
      filter: ['all', ['in', ['get', 'class'], ['literal', ['city', 'town', 'village']]],
        ['any', ['==', ['get', 'class'], 'city'], ['all', ['==', ['get', 'class'], 'town'], ['>=', ['zoom'], 8]], ['all', ['==', ['get', 'class'], 'village'], ['>=', ['zoom'], 11]]]],
      layout: { 'text-field': ['coalesce', ['get', `name:${LANG}`], ['get', 'name']],
        'text-font': ['match', ['get', 'class'], 'city', ['literal', ['Noto Sans Bold']], ['literal', ['Noto Sans Regular']]],
        'text-size': ['match', ['get', 'class'], 'city', 14, 'town', 12, 10.5], 'text-max-width': 8, 'text-padding': 6 },
      paint: halo });
    try { (m as any).setSky?.({ 'sky-color': '#07090c', 'horizon-color': '#1c2433', 'fog-color': '#07090c', 'fog-ground-blend': 0.7, 'horizon-fog-blend': 0.6, 'sky-horizon-blend': 0.8 }); } catch {}
  }

  setTerrain(on: boolean) {
    this.map.setTerrain(on ? { source: 'dem', exaggeration: 1.25 } : null);
  }

  setLines(source: 'past' | 'day' | 'live', lines: Line[]) {
    (this.map.getSource(source) as GeoJSONSource | undefined)?.setData(fc(lines));
  }

  clearMarkers() { this.markers.forEach((mk) => mk.remove()); this.markers = []; }

  addStopMarker(s: Stop, delayed = false) {
    const el = document.createElement('div');
    el.className = 'stop-marker' + (delayed ? ' pop' : '');
    el.innerHTML = `<span class="stop-dot"></span><span class="stop-label">${s.label}</span>`;
    const mk = new maplibregl.Marker({ element: el, anchor: 'left', offset: [6, 0] }).setLngLat([s.lon, s.lat]).addTo(this.map);
    this.markers.push(mk);
    return mk;
  }

  addPhotoMarker(p: Photo, delayed = false) {
    if (p.lat == null || p.lon == null) return null;
    const el = document.createElement('button');
    el.className = 'photo-pin' + (p.video ? ' is-video' : '') + (delayed ? ' pop' : '');
    el.style.backgroundImage = `url(${p.thumb})`;
    el.setAttribute('aria-label', 'Foto öffnen');
    el.addEventListener('click', (e) => { e.stopPropagation(); this.onPhoto(p); });
    const mk = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([p.lon, p.lat]).addTo(this.map);
    this.markers.push(mk);
    return mk;
  }

  addPoiMarker(p: Poi, delayed = false) {
    const el = document.createElement('button');
    el.className = 'poi-pin' + (delayed ? ' pop' : '');
    el.innerHTML = `<span class="poi-img" style="background-image:url(${p.image ?? ''})"></span><span class="poi-label">${p.title}</span>`;
    el.addEventListener('click', (e) => { e.stopPropagation(); this.onPoi(p); });
    const mk = new maplibregl.Marker({ element: el, anchor: 'left' }).setLngLat([p.lon, p.lat]).addTo(this.map);
    this.markers.push(mk);
    return mk;
  }

  /** Scroll-Modus: Tag n anzeigen (0 = Gesamtübersicht). */
  async showDay(n: number, animate = true) {
    await this.ready;
    this.setTerrain(false);
    this.clearMarkers();
    this.setLines('live', []);
    const all = [...this.days.values()];
    const past = all.filter((d) => n === 0 || d.n < n).flatMap((d) => d.segments);
    const today = n === 0 ? [] : (this.days.get(n)?.segments ?? []);
    this.setLines('past', past.map((s) => ({ kind: s.kind, coords: s.coords })));
    this.setLines('day', today.map((s) => ({ kind: s.kind, coords: s.coords })));
    if (n > 0) {
      const d = this.days.get(n)!;
      const seen = new Set<string>();
      for (const s of d.stops) { const k = s.place ?? `${s.lon},${s.lat}`; if (s.minutes >= 25 && !seen.has(k)) { seen.add(k); this.addStopMarker(s); } }
      this.photos.filter((p) => p.day === n).forEach((p) => this.addPhotoMarker(p));
      this.poisForDay(n).forEach((p) => this.addPoiMarker(p));
    }
    const coords = n === 0 ? past.flatMap((s) => s.coords) : [...today.flatMap((s) => s.coords), ...this.photos.filter((p) => p.day === n && p.lat != null).map((p) => [p.lon!, p.lat!] as LngLat)];
    if (coords.length) this.map.fitBounds(this.boundsOf(coords), { padding: this.padding, duration: animate ? 1600 : 0, pitch: n === 0 ? 35 : 0, bearing: 0, maxZoom: 14, essential: true });
  }

  focusSegment(seg: Segment) {
    this.map.fitBounds(this.boundsOf(seg.coords), { padding: this.padding, duration: 1200, maxZoom: 15, essential: true });
  }

  boundsOf(coords: LngLat[]): LngLatBoundsLike {
    let [w, s, e, n] = [180, 90, -180, -90];
    for (const [x, y] of coords) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
    return [[w, s], [e, n]];
  }
}
