---
name: traveldiary
description: Builds and maintains an interactive travel diary website (dark satellite map with 3D terrain, animated day-by-day "replay" of routes, photos and videos pinned where they were taken, points of interest with Wikimedia images, mobile-first) from a trip's raw material - diary text, photos/videos, GPX tracks and optionally a Google Timeline export. Use this whenever someone wants a trip website, travel blog with a map, road-trip / camper / bike-tour / hiking diary, "photos on a map with the route", a Komoot-style flyover of their days, or wants to add a new day of material (new photos, GPX, timeline, diary text) to such a project - even if they just say "there are new pictures and tracks". Three modes - init (scaffold a new project with a local setup web app for drag-and-drop input), day (process new material into the site), deploy (single HTML file, web space via SSH, or Synology nginx).
---

# Travel Diary

Turns a trip's raw material into a scrollytelling website: one card per day over a fixed satellite map,
movement segments (camper, car, bike, on foot, ferry) drawn on the map, photos and videos pinned at their
position, info points ("Unterwegs" / "Along the way") with Wikimedia Commons images, and a **replay** per day
that flies the route in 3D with stats, elevation profile and the photos popping up where they were taken.

The template in `template/` is a Vite + TypeScript + MapLibre project (no framework, no API keys).
The user never has to touch code: a local setup web app collects language, trip data, day texts and
files by drag & drop; you do the rest with the build scripts.

## Which mode?

| User says | Mode | Go to |
|---|---|---|
| "new travel diary", "set up a trip site", no project yet | **init** | §1 |
| "new photos / GPX / timeline / diary text", "add day N", project exists | **day** | §2 |
| "deploy", "publish", "make the single file", "put it online" | **deploy** | §3 |

A project is a traveldiary project when it has `data/trip.json` and `scripts/build-timeline.mjs`.

## 1. init – scaffold a new project

1. Ask (or take from the message) only two things: the **target folder** and whether the user prefers to
   answer the setup questions **in the browser app** (default, friendlier) or in chat. Everything else the app asks.
2. Run the scaffold: `node <skill-dir>/scripts/init.mjs <target-folder>`. It copies `template/`, runs
   `npm install`, and prints the next command.
3. Start the setup app: `npm run setup` inside the project (port 5180) and tell the user to open
   http://localhost:5180. Use `preview_start` with that URL if a browser pane is available. The app walks them
   through: language (de/en) → title, subtitle, dates, time zone, vehicles, output type, accent colour →
   one entry per day (date, title, diary text in Markdown) → drop zones for photos, videos, GPX, Google Timeline.
   It writes `data/trip.json`, `content/tagebuch.md` and the `raw/` folders. They can reopen it any time.
4. When they come back ("done", "fertig", or they just paste material), continue with **day**.

If the user answers in chat instead, write `data/trip.json` yourself (schema in `references/data-formats.md`)
and the diary into `content/tagebuch.md` (`## Tag N – <weekday, date> – <title>` / `## Day N – …`).

## 2. day – process new material

Read `references/day-workflow.md` before the first run in a session; it has the exact order, the
conventions and the pitfalls. Short version:

1. **Inventory** what is new under `raw/` (`find raw -newer public/data/photos.json`), and whether the diary
   has new days. If a Claude Docs connector and a doc link are available, export the doc as Markdown into
   `content/tagebuch.md`; otherwise the setup app / the user maintains that file.
2. **Structure** in `data/trip.json`: one `days[]` entry per day (`n`, `date`, `title`, `tracks[]` for GPX,
   `video` for a flyover clip, `legs[]` when there is no timeline). Rename GPX files to `YYYY-MM-DD_slug.gpx`.
3. **Timeline labels**: run `npm run data:timeline`, read the console list of segments and give each one a
   human label in `trip.json → timeline.labels` (key = local start time `YYYY-MM-DDTHH:MM`). Fix misdetected
   kinds in `timeline.kinds` (SKIING on an e-bike → `ebike`, a friend's car → `car`). Add stop places to
   `places` so stops get names instead of "Pause".
4. **Build**: `npm run data` (content → tracks → timeline → pois → photos). Public routing/elevation/Commons
   servers are rate-limited; the scripts pause and cache, never loop them.
5. **Look at the photos**: build contact sheets of the new photos (script in the reference), read them, and
   write one short sentence per photo into `data/captions.json`. Name places and mountains when the photo's
   position (printed next to each photo) makes them identifiable; say "Ortler group" rather than guessing a
   peak. Put blurred or accidental shots into `data/exclude.json`.
6. **Points of interest**: for notable places the user passed without a good photo of their own (a tunnel,
   a famous lake, a castle), add entries to `data/pois.json` with 2–3 factual sentences and a Commons search
   term; `npm run data:pois` fetches a freely licensed image with attribution. Check the picked images on a
   contact sheet and pin a better `file` if the first hit is poor (engravings, maps).
7. **Verify** with `npm run dev`: open the new day, check lines, pins, captions, and play the replay once.
8. **Deploy** (§3) and, if the project is a git repo, commit.

Keep `CLAUDE.md` in the project current (it is the hand-off document for the next session).

## 3. deploy

`trip.json → output` says what the user chose; details and the exact commands are in `references/hosting.md`.

- **single**: `npm run build:single` → one HTML file next to the project with data, photos and videos
  embedded (large own videos are left out with a note). Note for the user: on some phones a file opened
  from the file system blocks the map's web worker; hosting is more reliable.
- **web**: `npm run deploy:web` → build, generate `.htaccess` + `.htpasswd` (Basic Auth) and upload
  changed files over SSH (tar pipe, incremental via hash manifest). Needs `.env.web` (host, user, dir, logins).
- **nas**: `npm run deploy` → tar pipe to a Synology nginx container; config in `nas/default.conf`.

## Things worth knowing

- Photos need EXIF time + GPS (phones provide both). Videos get their time from the filename
  (`PXL_YYYYMMDD_HHMMSS`) and their position from the timeline, GPX, a stop, or the nearest photo.
- GPX beats the timeline: timeline activities overlapping a GPX track are dropped.
- Without a Google Timeline, drives are routed between named places via `days[].legs`.
- Elevation profiles over motorway tunnels show the terrain above; that is why elevation gain is only
  counted for bike/foot.
- All UI text is in `src/i18n.ts` (de, en); adding a language is one more dictionary.
