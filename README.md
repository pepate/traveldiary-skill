# traveldiary – Claude Code skill

Builds and maintains an interactive travel diary website (satellite map, 3D replay per day, photos/videos on the
map, points of interest) from diary text, photos, GPX tracks and an optional Google Timeline export.
Mobile-first, no framework, no API keys.

## Features

- **Dark satellite map with 3D terrain** (MapLibre, free tile sources) and one story card per day
- **Movement segments** per kind – camper, car, e-bike/bike, on foot/hike, ferry, bus, train, houseboat –
  from GPX tracks, a Google Timeline export (routed onto roads/paths via OSRM) or named `legs`
- **Replay per day**: the camera flies the route in 3D with live stats, elevation profile, clock and photos
  popping up where they were taken
- **Photos and videos on the map** at their EXIF position (videos via filename time + timeline/GPX), lightbox
- **Points of interest** ("Along the way") with Wikimedia Commons images and attribution
- **Local setup app** (`npm run setup`): language, trip data, day texts and drag & drop of photos/GPX/timeline
- **Hosting**: single self-contained HTML file, web space via SSH with Basic Auth, or Synology nginx
- UI in German and English (`src/i18n.ts`)

### New in this version

- **Houseboat (`boat`)**: Google `SAILING` maps to `boat`; routes follow OSM rivers and canals
  (`template/scripts/waterway.mjs`, Overpass, cached), lakes without a fairway are bridged between river ends.
  Optional whitelist of navigable waterways in `trip.json → timeline.waterways { rivers, canals }`.
- Photo EXIF positions serve as extra waypoints for boat and ferry segments.
- `timeline.ignoreAfter` skips timeline entries after the trip (default: end day 23:59).
- **Desktop layout (≥ 900 px)**: map left 50 %, story right 50 % with a large photo grid; replay cards on the right.
- **Grouped photos in the replay** (desktop): photos taken within 15 min (max. 6) share one card.

## Install

```bash
git clone git@github.com:pepate/traveldiary-skill.git ~/traveldiary-skill
# Claude Code looks for skills in ~/.claude/skills/<name>
ln -s ~/traveldiary-skill ~/.claude/skills/traveldiary          # macOS/Linux
mklink /J %USERPROFILE%\.claude\skills\traveldiary %USERPROFILE%\traveldiary-skill    # Windows (cmd)
```

## Usage

In Claude Code: `/traveldiary`, or just describe what you want.

| Mode | Example prompt | What happens |
|---|---|---|
| **init** | "new travel diary in ~/trips/norway" | scaffolds a project from `template/` and starts the local setup app |
| **day** | "new photos and GPX for day 4" | processes new material: tracks, timeline labels, captions, POIs, build |
| **deploy** | "deploy" | single HTML file, web space via SSH, or Synology nginx |

Inside a generated project:

```bash
npm run setup         # local setup app → http://localhost:5180
npm run data          # content → tracks → timeline → pois → photos
npm run dev           # http://localhost:5173
npm run build:single  # one HTML file to share
```

## Layout

- `SKILL.md` – the skill (modes init / day / deploy)
- `template/` – the project template (Vite + TypeScript + MapLibre, build scripts, setup app, deploy scripts)
- `references/` – day workflow, hosting, data formats
- `scripts/init.mjs` – scaffolds a project from the template
- `evals/` – test prompts and sample data

## Requirements

- Node 20+
- ffmpeg on PATH (for videos)
- Python 3 with Pillow (contact sheets for photo review)
- Internet for new segments/POIs (public routing, elevation, Overpass and Commons servers – rate limited, results are cached)
