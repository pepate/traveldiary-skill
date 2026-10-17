export type LngLat = [number, number] | [number, number, number];
export type Kind = 'camper' | 'car' | 'ebike' | 'bike' | 'walk' | 'hike' | 'ferry' | 'bus' | 'train';

export interface Place { name: string; lat: number; lon: number; note?: string }

export interface TrackRef { file: string; kind: Kind; name?: string }

export interface Day {
  n: number;
  date: string;
  title: string;
  tracks: TrackRef[];
  legs?: { from: string; to: string; kind?: Kind; start?: string; end?: string; label?: string }[];
  video?: { src: string; label: string };
}

export interface Trip {
  title: string;
  subtitle: string;
  lang?: string;          // de | en (Oberflächensprache)
  vehicles?: Kind[];      // Kacheln im Hero, z. B. ["camper", "ebike", "walk"]
  finished?: boolean;     // true → kein „Fortsetzung folgt“
  accent?: string;        // Akzentfarbe, z. B. #ff8a3d
  output?: 'single' | 'web' | 'nas';
  start: string;
  end: string;
  timezone: string;
  places: Record<string, Place>;
  days: Day[];
}

export interface Content {
  intro: string;
  days: Record<string, { heading: string; markdown: string }>;
}

/** Ein Bewegungsabschnitt (aus Google-Timeline oder GPX), siehe scripts/build-timeline.mjs */
export interface Segment {
  id: string;
  kind: Kind;
  label: string | null;
  source: string;
  start: string;
  end: string;
  coords: [number, number, number][];
  cum: number[];      // kumulierte Distanz in m je Punkt
  times: number[];    // Unix-ms je Punkt
  distanceM: number;
  movingMin: number;
  ascentM: number;
  descentM: number;
}

export interface Stop {
  start: string;
  end: string;
  lon: number;
  lat: number;
  label: string;
  place: string | null;
  minutes: number;
}

export interface DayData {
  n: number;
  date: string;
  title: string;
  stats: { byKindM: Partial<Record<Kind, number>>; ascentM: number; movingMin: number };
  segments: Segment[];
  stops: Stop[];
}

export interface Photo {
  id: string;
  src: string;
  thumb: string;
  taken: string;
  date: string;
  day: number | null;
  lat: number | null;
  lon: number | null;
  caption: string;
  video?: string | null;
  videoOmitted?: boolean;
}

export interface Poi {
  id: string;
  title: string;
  lat: number;
  lon: number;
  radiusM: number;
  text: string;
  day?: number;
  image: string | null;
  credit: { file: string; artist: string; license: string; url: string } | null;
}
