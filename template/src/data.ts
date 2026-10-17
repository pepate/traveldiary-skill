import type { Content, DayData, Photo, Poi, Trip } from './types';

// Single-File-Build: Daten liegen in window.__EMBED__ (siehe scripts/build-single.mjs)
const EMBED: Record<string, unknown> | undefined = (window as any).__EMBED__;

const get = async <T>(url: string, fallback?: T): Promise<T> => {
  if (EMBED) return (EMBED[url] as T) ?? (fallback as T);
  try {
    const u = new URL(url, location.href); u.username = ''; u.password = '';   // Logins aus der Adresszeile nicht übernehmen
    const r = await fetch(u);
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return (await r.json()) as T;
  } catch (e) {
    if (fallback !== undefined) return fallback;
    throw e;
  }
};

export interface TripData {
  trip: Trip;
  content: Content;
  photos: Photo[];
  pois: Poi[];
  days: Map<number, DayData>;
}

export async function loadAll(): Promise<TripData> {
  const [trip, content, photos, pois] = await Promise.all([
    get<Trip>('data/trip.json'),
    get<Content>('data/content.json', { intro: '', days: {} }),
    get<Photo[]>('data/photos.json', []),
    get<Poi[]>('data/pois.json', []),
  ]);
  const days = new Map<number, DayData>();
  await Promise.all(trip.days.map(async (d) => {
    const data = await get<DayData | null>(`data/days/day-${d.n}.json`, null);
    days.set(d.n, data ?? { n: d.n, date: d.date, title: d.title, stats: { byKindM: {}, ascentM: 0, movingMin: 0 }, segments: [], stops: [] });
  }));
  return { trip, content, photos, pois, days };
}
