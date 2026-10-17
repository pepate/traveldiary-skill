# Travel Diary

Interactive travel diary website: satellite map with 3D terrain, your route day by day, photos and videos
where they were taken, points of interest, and a "play this day" replay. Built from diary text, photos,
GPX tracks and (optionally) a Google Timeline export.

```bash
npm install
npm run setup     # collect language, trip data, days and files in the browser (http://localhost:5180)
npm run data      # process everything into public/
npm run dev       # preview (http://localhost:5173)
```

Then ask Claude Code for `/traveldiary day` to label routes, write captions, add points of interest and deploy.
Details: `CLAUDE.md`.
