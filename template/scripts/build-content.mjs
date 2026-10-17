// content/tagebuch.md → public/data/content.json  ({ intro, days: { [n]: { heading, markdown } } })
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, OUT, writeJSON } from './lib.mjs';

const mdFile = path.join(ROOT, 'content', 'tagebuch.md');
const md = fs.existsSync(mdFile) ? fs.readFileSync(mdFile, 'utf8') : '';
const parts = md.split(/^## /m);
const days = {};
let intro = '';
for (const part of parts.slice(1)) {
  const [heading, ...rest] = part.split('\n');
  const m = heading.match(/^(?:Tag|Day)\s+(\d+)/i);
  // Arbeitsnotizen am Ende eines Tages (z. B. „**Für die Webseite:**“ / „**Notes for the site:**“) nicht anzeigen
  if (m) days[m[1]] = { heading: heading.trim(), markdown: rest.join('\n').replace(/\*\*(Für die Webseite|Notes for the site|TODO):\*\*[\s\S]*$/i, '').trim() };
  else if (/Stationen/i.test(heading)) intro = rest.join('\n').trim();
}
writeJSON(path.join(OUT, 'content.json'), { intro, days });
console.log(`content: ${Object.keys(days).length} Tage`);

// trip.json für das Frontend bereitstellen
fs.copyFileSync(path.join(ROOT, 'data', 'trip.json'), path.join(OUT, 'trip.json'));
