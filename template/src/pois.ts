import type { DayData, Poi, Segment } from './types';

const R = 6371000, rad = Math.PI / 180;
export const haversine = ([x1, y1]: number[], [x2, y2]: number[]) => {
  const a = Math.sin(((y2 - y1) * rad) / 2) ** 2 + Math.cos(y1 * rad) * Math.cos(y2 * rad) * Math.sin(((x2 - x1) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

export interface PoiHit { poi: Poi; seg: Segment; index: number; distM: number }

/** Welche POIs liegen an den Segmenten eines Tages? Ergebnis: je POI der nächste Punkt (Segment + Index). */
export function poisForDay(day: DayData, pois: Poi[]): PoiHit[] {
  const hits: PoiHit[] = [];
  for (const poi of pois) {
    if (poi.day != null && poi.day !== day.n) continue;
    let best: PoiHit | null = null;
    for (const seg of day.segments) {
      const step = Math.max(1, Math.floor(seg.coords.length / 400));
      for (let i = 0; i < seg.coords.length; i += step) {
        const d = haversine(seg.coords[i], [poi.lon, poi.lat]);
        if (d <= poi.radiusM && (!best || d < best.distM)) best = { poi, seg, index: i, distM: d };
      }
    }
    if (best) hits.push(best);
  }
  return hits;
}
