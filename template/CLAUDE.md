# Travel diary project (built with the `traveldiary` skill)

Interactive travel diary: dark satellite map with 3D terrain, one card per day, movement segments (camper, car,
bike, on foot, ferry), photos/videos pinned where they were taken, points of interest with Wikimedia images,
and a per-day replay. Mobile-first. If the `traveldiary` skill is available, use it – it holds the day workflow
(`references/day-workflow.md`), data formats and hosting steps.

## Commands

```bash
npm run setup         # local setup app (language, trip, days, drag & drop) → http://localhost:5180
npm run data          # content → tracks → timeline → pois → photos  (needs internet for new segments/POIs)
npm run dev           # http://localhost:5173
npm run build:single  # one HTML file to share
npm run deploy:web    # web space via SSH + Basic Auth (.env.web)
npm run deploy        # Synology nginx (deploy.sh)
```

## Files

| Purpose | Path |
|---|---|
| Trip structure, places, timeline labels/kinds, days | `data/trip.json` |
| Diary text (one `## Tag N – …` / `## Day N – …` section per day) | `content/tagebuch.md` |
| Photo captions / excluded photos | `data/captions.json`, `data/exclude.json` |
| Points of interest + image attribution | `data/pois.json`, `data/pois-images.json` |
| Raw inputs (not in git) | `raw/photos`, `raw/video`, `raw/gpx`, `raw/timeline/Zeitachse.json` |
| Routing/elevation cache per segment (in git) | `data/timeline/*.json` |
| Generated site data (never edit) | `public/data/**`, `public/photos/**`, `public/pois/**` |
| UI texts | `src/i18n.ts` |

## Conventions

- Raw files are originals: read only. Generated files come from the scripts.
- Public routing/elevation/Commons servers are rate limited: one `npm run data` per change, no loops.
- Keep the "Status" section below current – it is the hand-off for the next session.

## Status

- (fill in: trip, days built, open issues)
