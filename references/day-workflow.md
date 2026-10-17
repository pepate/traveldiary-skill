# Day workflow – turning raw material into a finished day

This is the order that has proven itself over a two-week trip. Each step names the command and the file it touches.
Run everything from the project folder.

## 0. Inventory

```bash
find raw/photos raw/video -newer public/data/photos.json -type f | sort     # new photos/videos (all, if no build yet)
ls raw/gpx raw/timeline
grep -n "^## " content/tagebuch.md | tail -5                                # diary days present
```

Diary source: if the user keeps it in a Claude Doc and a Docs connector is available, export the doc
(`export`, format `markdown`) and replace `content/tagebuch.md` with it. Otherwise the setup app writes the
file, or the user edits it. Day headings must look like `## Tag 3 – Mittwoch, 7. Oktober 2026 – Title`
(or `## Day 3 – …`). A trailing block `**Für die Webseite:**` / `**Notes for the site:**` is a worklist and is
stripped from the page – read it, it tells you which routes, pictures and highlights the user expects.

## 1. Structure (data/trip.json)

- One `days[]` entry per diary day: `{ "n": 3, "date": "2026-10-07", "title": "…", "tracks": [] }`.
- GPX: rename to `raw/gpx/YYYY-MM-DD_slug.gpx`, add `{ "file": "YYYY-MM-DD_slug", "kind": "ebike|bike|walk|hike", "name": "…" }` to that day's `tracks`.
  Komoot exports carry `<name>` and `<time>` – use the first `<time>` to find the day.
- Flyover video from Komoot: rename to `raw/video/YYYY-MM-DD_slug_komoot.mp4`, copy to `public/video/`, add `"video": { "src": "video/…mp4", "label": "…" }` to the day.
- Own phone videos (`PXL_*.mp4`) stay in `raw/video/`; `build-photos.mjs` converts them and treats them like photos.
- No Google Timeline? Describe drives as `legs`: `{ "from": "placeA", "to": "placeB", "kind": "camper", "start": "09:30", "end": "12:00", "label": "A → B" }`
  with both ids in `places`. The route comes from OSRM.

## 2. Timeline labels

```bash
npm run data:timeline
```

The console prints every detected activity with local start time, kind and length, e.g.
`2026-10-09T10:31 ferry 0.9 km`. For each one add a label in `trip.json → timeline.labels` keyed by that
start time. Fix kinds in `timeline.kinds` (Google reports steep e-bike climbs as `SKIING`, a ride in a friend's
car as `IN_PASSENGER_VEHICLE` → set `car`). Segments shorter than 600 m are ignored; same-kind segments with a
pause under 20 min are merged (the label of the first start wins). Timeline entries after the trip
(default: end day 23:59, or `timeline.ignoreAfter`) are skipped.

Houseboat / boat (`boat`, Google `SAILING`): the timeline often has only start and end on the water, so photos
with EXIF GPS serve as extra waypoints for `boat` and `ferry` (needs `public/data/photos.json` from an earlier
`npm run data`). Boat routes follow OSM rivers/canals (`scripts/waterway.mjs`, Overpass, cached in
`data/waterways.json`); lakes without a fairway are bridged between river ends. In networks with many canals
list the navigable ones in `timeline.waterways` (OSM names) – long side canals otherwise attract the route.
After changing `waterways`, delete `data/waterways.json` and `data/timeline/*_boat.json`, then
`npm run data:timeline`. If start/end are not near water, the boat falls back to raw points.

Stops: visits of 10 min or more become stops. A stop within 400 m of an entry in `places` gets that name,
otherwise "Pause"/"Stop". Add campsites, friends' houses, ferry piers, summits to `places` – with names you
are happy to show (no house numbers).

Known weak spots: minute-by-minute GPS in forests produces zigzag; the script tries OSRM routing with 25, 10 and
4 waypoints (bike also with the foot profile, for paths closed to road routing) and keeps the candidate
closest to the raw length. If a line is still wrong, a GPX of that activity fixes it (GPX wins).

## 3. Build everything

```bash
npm run data        # content → tracks → timeline → pois → photos
```

Routing (routing.openstreetmap.de), elevation (Terrarium tiles) and Commons are public and rate limited.
Results are cached in `data/timeline/` (checked in) and `.cache/`. Do not run the scripts in a loop; one
run per change is enough. A failed elevation fetch leaves `↑0 m` on that segment – delete its cache file in
`data/timeline/` and rerun.

## 4. Captions – look at every photo

Build contact sheets of the new photos with index, day and time, larger tiles for landscape shots:

```bash
python -I - <<'EOF'
import json
from PIL import Image, ImageDraw
p=json.load(open('public/data/photos.json',encoding='utf-8'))
new=[(i,x) for i,x in enumerate(p) if not x['caption']]
cols,size=5,300
for s in range(0,len(new),cols*4):
    chunk=new[s:s+cols*4]; rows=(len(chunk)+cols-1)//cols
    sheet=Image.new('RGB',(cols*size,rows*size),'black'); d=ImageDraw.Draw(sheet)
    for k,(i,x) in enumerate(chunk):
        im=Image.open('public/photos/'+x['id']+'.webp'); im.thumbnail((size,size)); sheet.paste(im,((k%cols)*size,(k//cols)*size))
        d.rectangle([(k%cols)*size,(k//cols)*size,(k%cols)*size+160,(k//cols)*size+26],fill='black')
        d.text(((k%cols)*size+6,(k//cols)*size+4),f"{i} T{x['day']} {x['taken'][11:16]}Z {'VID' if x.get('video') else ''}",fill='white')
    sheet.save(f'.cache/contact_{s//(cols*4)}.jpg',quality=85)
for i,x in new: print(i,x['id'],x['day'],x['taken'][11:16],round(x['lat'],4),round(x['lon'],4))
EOF
```

Read the sheets (Read tool on the JPGs). Write `data/captions.json` entries (`"<photo-id>": "one short sentence"`),
then rerun `node scripts/build-photos.mjs`. Rules that make captions good:

- Say what is in the picture and where, in the diary's language; one sentence, no "Foto von".
- Use the printed position to name towns, lakes, passes and mountains. Prominent, unmistakable shapes
  (a pyramid peak over a known town, a castle on a rock) may be named; otherwise name the range/group.
- Photos of food, people and vehicles get a warm, concrete caption ("Risotto des Chefs in der Villa Emma").
- Blurred, accidental or duplicate shots go into `data/exclude.json` (`{ "ids": [ … ] }`).
- Day boundaries use the trip time zone; photo times in JSON are UTC.

## 5. Points of interest

For places the user passed that deserve a word – a famous tunnel, a lake, a castle, a town – add to
`data/pois.json`:

```json
{ "id": "gotthard", "title": "Gotthard-Strassentunnel", "lat": 46.6672, "lon": 8.587, "radiusM": 2500, "day": 4,
  "text": "2–3 factual sentences with a number or two.", "commons": "Gotthard road tunnel Göschenen" }
```

`day` limits the POI to that day (omit for places passed several times). `radiusM` is the distance from the
route at which it triggers (2500 m for motorway drives, 500–800 m for bike/foot). `npm run data:pois`
searches Commons and downloads the first bitmap hit with licence and author into `data/pois-images.json`.
Make a quick contact sheet of `public/pois/*.jpg` and look: engravings, maps or wrong subjects happen –
then search Commons for candidates and pin an exact `"file": "File:…"` in `pois.json`, delete the image and rerun.

## 6. Verify

`npm run dev`, open `http://localhost:5173/#tag-N` in phone size. Check: lines drawn, stop labels sensible,
photo pins at plausible places, captions readable, "Play this day" runs through with photos and POIs.
Console errors show as a red banner at the bottom of the page.

## 7. Hand-off

Update the project's `CLAUDE.md` (status, open issues) and `README.md`, commit, deploy (see `hosting.md`).
