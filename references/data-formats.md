# Data formats

## data/trip.json (hand-maintained, copied to public/data by build-content.mjs)

```json
{
  "title": "Camper-Tour 2026",
  "subtitle": "Black Forest · Switzerland · Lake Iseo",
  "lang": "de",                       // UI language: de | en (src/i18n.ts)
  "start": "2026-10-05", "end": "2026-10-18",
  "timezone": "Europe/Berlin",        // day boundaries, clock times
  "vehicles": ["camper", "ebike", "walk"],   // hero stat tiles (max 3); kinds: camper car ebike bike walk hike ferry bus train
  "output": "single",                 // single | web | nas
  "accent": "#ff8a3d",                // optional accent colour
  "finished": false,                  // true hides "to be continued"
  "places": {                         // named points: stop labels (400 m radius), legs endpoints
    "home": { "name": "Sindelfingen", "lat": 48.7273, "lon": 8.9866 }
  },
  "timeline": {                       // only with a Google Timeline export
    "ignoreBefore": "2026-10-05T14:20",          // local time; everything earlier is skipped
    "kinds":  { "2026-10-09T13:30": "ebike" },   // override detected kind, key = local start time
    "labels": { "2026-10-05T18:06": "Sindelfingen → Ohlsbach" }
  },
  "days": [
    { "n": 5, "date": "2026-10-09", "title": "Bike tour on Monte Isola",
      "tracks": [ { "file": "2026-10-09_monte-isola", "kind": "ebike", "name": "Montisola ring tour" } ],
      "video": { "src": "video/2026-10-09_monte-isola_komoot.mp4", "label": "Komoot flyover" },
      "legs":  [ { "from": "home", "to": "ohlsbach", "kind": "camper", "start": "18:00", "end": "20:00", "label": "…" } ] }
  ]
}
```

## content/tagebuch.md

```
# Title

## Tag 1 – Montag, 5. Oktober 2026 – Sindelfingen → Ohlsbach      (or: ## Day 1 – Monday, 5 October 2026 – …)

**Morning:** …                      (Markdown; paragraphs, bold lead-ins, tables work)

**Für die Webseite:** / **Notes for the site:**   ← worklist, stripped from the page
- Route …
```

`build-content.mjs` matches `## Tag N` / `## Day N`; the number N must equal `days[].n`.

## data/captions.json – `{ "<photo-id>": "caption" }`; photo-id = filename without extension, non-word chars → `_`
## data/exclude.json – `{ "ids": ["<photo-id>", …] }`
## data/pois.json – see day-workflow.md §5; `data/pois-images.json` stores file/artist/licence/url per POI

## Generated (public/data, never edit)

- `days/day-N.json`: `{ n, date, title, stats, segments: [ { id, kind, label, source, start, end, coords [[lon,lat,ele]…], cum [m], times [ms], distanceM, movingMin, ascentM, descentM } ], stops: [ { start, end, lon, lat, label, place, minutes } ] }`
- `photos.json`: `[ { id, src, thumb, taken (ISO UTC), date (local), day, lat, lon, posSource (exif|track|stop|photo), caption, video } ]`
- `pois.json`, `tracks.json`, `tracks/*.geojson`, `content.json`

## Raw inputs

| What | Where | Requirements |
|---|---|---|
| Photos | `raw/photos/*.jpg|.heic|.png` | EXIF DateTimeOriginal + GPS; HEIC may need prior conversion |
| Own videos | `raw/video/PXL_YYYYMMDD_HHMMSS*.mp4` | time from filename (UTC); ffmpeg on PATH |
| Flyover videos | `raw/video/YYYY-MM-DD_slug_komoot.mp4` → copy to `public/video/` | referenced in `days[].video` |
| GPX | `raw/gpx/YYYY-MM-DD_slug.gpx` | with `<time>` per point for photo matching |
| Google Timeline | `raw/timeline/Zeitachse.json` (Android export, also "Timeline.json") | optional; `semanticSegments` + `rawSignals` |
