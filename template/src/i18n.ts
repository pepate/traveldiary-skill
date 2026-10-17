// Oberflächentexte. Sprache kommt aus trip.json → "lang" (de | en). Weitere Sprachen: Block ergänzen.
import type { Kind } from './types';

type Dict = {
  locale: string;
  kinds: Record<Kind, string>;
  stats: { days: string; ascent: string; photos: string };
  scrollHint: string; daysNav: string; day: string; play: string; noEntry: string; underway: string;
  toBeContinued: string; credits: string; photoCredit: string; commons: string;
  prev: string; next: string; close: string; clockSuffix: string; videoOmitted: string;
  replay: { distance: string; ascent: string; time: string; loading: string; nextCard: string; done: string; again: string; nextDay: string; back: string; underwayTime: string; profile: string; pause: string; skip: string; speed: string };
  error: string; mapError: string; min: string; h: string;
};

const de: Dict = {
  locale: 'de-DE',
  kinds: { camper: 'Camper', car: 'Auto', ebike: 'E-Bike', bike: 'Rad', walk: 'zu Fuß', hike: 'Wanderung', ferry: 'Fähre', bus: 'Bus', train: 'Zug', boat: 'Hausboot' },
  stats: { days: 'Tage', ascent: 'Höhenmeter', photos: 'Fotos' },
  scrollHint: 'Scrollen, um die Reise Tag für Tag zu erleben ↓', daysNav: 'Tage', day: 'Tag', play: 'Tag abspielen',
  noEntry: 'Noch kein Tagebucheintrag.', underway: 'Unterwegs', toBeContinued: 'Fortsetzung folgt …',
  credits: 'Routen aus GPS-Daten und GPX · Karte: Esri World Imagery · Gelände: Mapzen · Ortsnamen: OpenFreeMap',
  photoCredit: 'Foto:', commons: 'Wikimedia Commons',
  prev: 'Vorheriges', next: 'Nächstes', close: 'Schließen', clockSuffix: ' Uhr', videoOmitted: 'Video nur in der Online-Version',
  replay: { distance: 'Distanz', ascent: 'Höhenmeter', time: 'Zeit', loading: 'Bilder werden geladen …', nextCard: 'Weiter ›', done: 'Geschafft', again: 'Nochmal', nextDay: 'Nächster Tag ›', back: 'Zurück zum Tagebuch', underwayTime: 'Unterwegs', profile: 'Höhenprofil', pause: 'Pause', skip: 'Nächster Abschnitt', speed: 'Geschwindigkeit' },
  error: 'Fehler', mapError: 'Karte', min: 'min', h: 'h',
};

const en: Dict = {
  locale: 'en-GB',
  kinds: { camper: 'Camper', car: 'Car', ebike: 'E-bike', bike: 'Bike', walk: 'On foot', hike: 'Hike', ferry: 'Ferry', bus: 'Bus', train: 'Train', boat: 'Houseboat' },
  stats: { days: 'Days', ascent: 'Elevation gain', photos: 'Photos' },
  scrollHint: 'Scroll to relive the trip day by day ↓', daysNav: 'Days', day: 'Day', play: 'Play this day',
  noEntry: 'No diary entry yet.', underway: 'Along the way', toBeContinued: 'To be continued …',
  credits: 'Routes from GPS data and GPX · Map: Esri World Imagery · Terrain: Mapzen · Place names: OpenFreeMap',
  photoCredit: 'Photo:', commons: 'Wikimedia Commons',
  prev: 'Previous', next: 'Next', close: 'Close', clockSuffix: '', videoOmitted: 'Video only in the online version',
  replay: { distance: 'Distance', ascent: 'Elevation', time: 'Time', loading: 'Loading photos …', nextCard: 'Next ›', done: 'Done', again: 'Play again', nextDay: 'Next day ›', back: 'Back to the diary', underwayTime: 'Moving', profile: 'Elevation profile', pause: 'Pause', skip: 'Next segment', speed: 'Speed' },
  error: 'Error', mapError: 'Map', min: 'min', h: 'h',
};

const DICTS: Record<string, Dict> = { de, en };

export let T: Dict = de;
export let TZ = 'Europe/Berlin';
export let LANG = 'de';

export function setLang(lang: string, timezone: string) {
  LANG = DICTS[lang] ? lang : 'en';
  T = DICTS[LANG];
  TZ = timezone || TZ;
  document.documentElement.lang = LANG;
  // Statische Texte in index.html: <span data-i18n="replay.distance">
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const v = el.dataset.i18n!.split('.').reduce<any>((o, k) => o?.[k], T);
    if (typeof v === 'string') el.textContent = v;
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => {
    const v = el.dataset.i18nAria!.split('.').reduce<any>((o, k) => o?.[k], T);
    if (typeof v === 'string') el.setAttribute('aria-label', v);
  });
}

export const fmtNum = (n: number, opts: Intl.NumberFormatOptions = {}) => n.toLocaleString(T.locale, opts);
export const fmtClock = (ms: number) => new Date(ms).toLocaleTimeString(T.locale, { hour: '2-digit', minute: '2-digit', timeZone: TZ });
export const longDate = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString(T.locale, { weekday: 'long', day: 'numeric', month: 'long' });
export const shortDate = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString(T.locale, { weekday: 'short', day: 'numeric', month: 'numeric' });
export const fullDate = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString(T.locale, { day: 'numeric', month: 'long', year: 'numeric' });
