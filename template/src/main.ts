import { marked } from 'marked';
import { loadAll } from './data';
import { COLORS, ICONS, TripMap, showBanner } from './map';
import { Replay } from './replay';
import type { Kind, Photo, Poi } from './types';
import { poisForDay } from './pois';
import { T, setLang, fmtNum, fmtClock, longDate, shortDate, fullDate } from './i18n';
import './style.css';

const km = (m: number) => `${fmtNum(m / 1000, { maximumFractionDigits: m < 20000 ? 1 : 0 })} km`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

async function main() {
  const { trip, content, photos, pois, days } = await loadAll();
  setLang(trip.lang ?? 'de', trip.timezone);
  if (trip.accent) document.documentElement.style.setProperty('--accent', trip.accent);
  document.title = trip.title;
  const story = document.getElementById('story')!;
  const lb = document.getElementById('lightbox')!;

  // ---- Lightbox mit Blättern innerhalb eines Tages
  let lbList: Photo[] = [], lbIdx = 0;
  const renderLb = () => {
    const p = lbList[lbIdx];
    const media = p.video ? `<video src="${p.video}" poster="${p.src}" controls autoplay playsinline></video>` : `<img src="${p.src}" alt="">${p.videoOmitted ? `<p class="lb-note">${T.videoOmitted}</p>` : ''}`;
    lb.innerHTML = `<figure>${media}<figcaption><span>${esc(p.caption || '')}</span><time>${fmtClock(Date.parse(p.taken))}${T.clockSuffix}</time></figcaption></figure>
      <button class="lb-nav prev" aria-label="${T.prev}">‹</button><button class="lb-nav next" aria-label="${T.next}">›</button><button class="lb-close" aria-label="${T.close}">✕</button><span class="lb-count">${lbIdx + 1} / ${lbList.length}</span>`;
    lb.hidden = false;
  };
  const openPhoto = (p: Photo) => {
    lbList = photos.filter((x) => x.day === p.day);
    lbIdx = Math.max(0, lbList.findIndex((x) => x.id === p.id));
    renderLb();
  };
  const step = (d: number) => { lbIdx = (lbIdx + d + lbList.length) % lbList.length; renderLb(); };
  lb.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('.prev')) return step(-1);
    if (t.closest('.next')) return step(1);
    if (t.closest('a')) return;
    if ((t.tagName !== 'IMG' && t.tagName !== 'VIDEO' && !t.closest('.poi-sheet')) || t.closest('.lb-close')) lb.hidden = true;
  });
  let tx = 0;
  lb.addEventListener('touchstart', (e) => (tx = e.touches[0].clientX), { passive: true });
  lb.addEventListener('touchend', (e) => { const dx = e.changedTouches[0].clientX - tx; if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1); });
  addEventListener('keydown', (e) => { if (lb.hidden) return; if (e.key === 'Escape') lb.hidden = true; if (e.key === 'ArrowRight') step(1); if (e.key === 'ArrowLeft') step(-1); });

  const openPoi = (p: Poi) => {
    lb.innerHTML = `<article class="poi-sheet">${p.image ? `<img src="${p.image}" alt="">` : ''}<div><p class="eyebrow">${T.underway}</p><h3>${esc(p.title)}</h3><p>${esc(p.text)}</p>${p.credit ? `<small>${T.photoCredit} <a href="${p.credit.url}" target="_blank" rel="noopener">${esc(p.credit.artist)}</a>, ${esc(p.credit.license)} · ${T.commons}</small>` : ''}</div></article><button class="lb-close" aria-label="${T.close}">✕</button>`;
    lb.hidden = false;
  };
  const tripMap = new TripMap(document.getElementById('map')!, days, photos, openPhoto);
  tripMap.onPoi = openPoi;
  tripMap.poisForDay = (n) => poisForDay(days.get(n)!, pois).map((h) => h.poi);
  const replay = new Replay(tripMap, document.getElementById('replay')!, openPhoto);
  replay.pois = pois;

  // ---- Gesamtstatistik
  const allSegs = [...days.values()].flatMap((d) => d.segments);
  const sum = (kinds: Kind[]) => allSegs.filter((s) => kinds.includes(s.kind)).reduce((a, s) => a + s.distanceM, 0);
  // Kennzahlen im Hero: eine Kachel je Fortbewegungsart aus trip.json → vehicles (Standard: alles, was vorkommt)
  const GROUPS: Record<string, Kind[]> = { camper: ['camper'], car: ['car'], ebike: ['ebike', 'bike'], bike: ['ebike', 'bike'], walk: ['walk', 'hike'], hike: ['walk', 'hike'], ferry: ['ferry'], bus: ['bus'], train: ['train'] };
  const seen = new Set(allSegs.map((s) => s.kind));
  const vehicles = (trip.vehicles ?? [...seen]).filter((k, i, a) => GROUPS[k] && a.findIndex((x) => GROUPS[x][0] === GROUPS[k][0]) === i).slice(0, 3);
  const ascent = allSegs.filter((s) => ['ebike', 'bike', 'walk', 'hike'].includes(s.kind)).reduce((a, s) => a + s.ascentM, 0);
  const daysDone = [...days.values()].filter((d) => d.segments.length).length;

  story.insertAdjacentHTML('beforeend', `
    <section class="hero" data-day="0">
      <div class="hero-text">
        <p class="eyebrow">${longDate(trip.start)} – ${fullDate(trip.end)}</p>
        <h1>${esc(trip.title)}</h1>
        <p class="lede">${esc(trip.subtitle)}</p>
        <dl class="stats">
          <div><dt>${T.stats.days}</dt><dd>${daysDone}</dd></div>
          ${vehicles.map((k) => `<div><dt>${T.kinds[k]}</dt><dd>${km(sum(GROUPS[k]))}</dd></div>`).join('')}
          <div><dt>${T.stats.ascent}</dt><dd>${fmtNum(ascent)} m</dd></div>
          <div><dt>${T.stats.photos}</dt><dd>${photos.length}</dd></div>
        </dl>
        <p class="scroll-hint">${T.scrollHint}</p>
      </div>
    </section>
    <nav class="daynav" aria-label="${T.daysNav}">${trip.days.map((d) => `<a href="#tag-${d.n}" data-nav="${d.n}"><b>${String(d.n).padStart(2, '0')}</b><span>${shortDate(d.date)}</span></a>`).join('')}</nav>`);

  // ---- Tage
  for (const day of trip.days) {
    const d = days.get(day.n)!;
    const c = content.days[String(day.n)];
    const dayPhotos = photos.filter((p) => p.day === day.n);
    const kinds = Object.entries(d.stats.byKindM).filter(([, m]) => m! > 0) as [Kind, number][];
    const hm = d.segments.filter((s) => ['ebike', 'bike', 'walk', 'hike'].includes(s.kind)).reduce((a, s) => a + s.ascentM, 0);
    const chips = [...kinds.map(([k, m]) => `<span class="chip" style="--c:${COLORS[k]}">${ICONS[k]} ${km(m)}</span>`), hm ? `<span class="chip">↑ ${fmtNum(hm)} m</span>` : ''].join('');
    const segs = d.segments.map((s, i) => `<li data-seg="${i}"><time>${fmtClock(s.times[0])}</time><i style="--c:${COLORS[s.kind]}">${ICONS[s.kind]}</i><span>${esc(s.label ?? T.kinds[s.kind])}</span><b>${km(s.distanceM)}</b></li>`).join('');
    const dayPois = poisForDay(d, pois).map((h) => h.poi);
    const poiCards = dayPois.map((p) => `<button class="poi-card" data-poi="${p.id}">${p.image ? `<img src="${p.image}" alt="" loading="lazy">` : ''}<span><b>${esc(p.title)}</b>${esc(p.text.split(/(?<=[.!?])\s/)[0])}</span></button>`).join('');
    const prose = c ? marked.parse(c.markdown.trim()) : `<p class="muted">${T.noEntry}</p>`;
    story.insertAdjacentHTML('beforeend', `
      <section class="day" id="tag-${day.n}" data-day="${day.n}">
        <div class="spacer"></div>
        <article class="card">
          <header>
            <p class="eyebrow">${T.day} ${String(day.n).padStart(2, '0')} · ${longDate(day.date)}</p>
            <h2>${esc(day.title)}</h2>
            <div class="chips">${chips}</div>
            ${d.segments.length ? `<button class="btn play" data-play="${day.n}"><span class="play-icon">▶</span> ${T.play}</button>` : ''}
          </header>
          ${d.segments.length ? `<ol class="segs">${segs}</ol>` : ''}
          <div class="prose">${prose}</div>
          ${poiCards ? `<p class="eyebrow">${T.underway}</p><div class="pois">${poiCards}</div>` : ''}
          ${dayPhotos.length ? `<div class="gallery">${dayPhotos.map((p) => `<button class="shot${p.video ? ' is-video' : ''}" data-photo="${p.id}"><img src="${p.thumb}" alt="" loading="lazy"><time>${fmtClock(Date.parse(p.taken))}</time></button>`).join('')}</div>` : ''}
          ${day.video ? `<figure class="video"><video src="${day.video.src}" controls playsinline preload="metadata"></video><figcaption>${esc(day.video.label)}</figcaption></figure>` : ''}
        </article>
      </section>`);
  }
  story.insertAdjacentHTML('beforeend', `<footer class="outro"><p>${trip.finished ? '' : T.toBeContinued}</p><p class="muted">${T.credits}</p></footer>`);

  // ---- Interaktion
  story.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const pid = t.closest<HTMLElement>('[data-photo]')?.dataset.photo;
    if (pid) { const p = photos.find((x) => x.id === pid); if (p) openPhoto(p); return; }
    const poiId = t.closest<HTMLElement>('[data-poi]')?.dataset.poi;
    if (poiId) { const p = pois.find((x) => x.id === poiId); if (p) openPoi(p); return; }
    const play = t.closest<HTMLElement>('[data-play]')?.dataset.play;
    if (play) { const d = days.get(Number(play))!; replay.play(d, photos.filter((p) => p.day === d.n)); return; }
    const segEl = t.closest<HTMLElement>('[data-seg]');
    if (segEl) {
      const n = Number(segEl.closest<HTMLElement>('.day')!.dataset.day);
      segEl.parentElement!.querySelectorAll('li').forEach((li) => li.classList.toggle('is-active', li === segEl));
      tripMap.focusSegment(days.get(n)!.segments[Number(segEl.dataset.seg)]);
    }
  });

  // Scrollytelling: der Abschnitt in der Bildschirmmitte steuert die Karte
  let current = -1;
  const show = (n: number) => {
    if (n === current) return;
    current = n;
    document.querySelectorAll<HTMLElement>('[data-nav]').forEach((a) => a.classList.toggle('is-active', Number(a.dataset.nav) === n));
    document.querySelector('[data-nav].is-active')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    tripMap.showDay(n);
  };
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) show(Number((e.target as HTMLElement).closest<HTMLElement>('[data-day]')!.dataset.day));
  }, { rootMargin: '-35% 0px -35% 0px' });
  document.querySelectorAll('.hero, .card').forEach((s) => io.observe(s));
  replay.onClose = () => { const n = current; current = -1; show(n); };
  if (location.hash) setTimeout(() => document.querySelector(location.hash)?.scrollIntoView({ behavior: 'instant' as ScrollBehavior }), 400);

  const setPadding = () => {
    const mobile = innerWidth < 900;
    tripMap.padding = mobile ? { top: 70, bottom: innerHeight * 0.42, left: 20, right: 20 } : { top: 80, bottom: 80, left: Math.min(560, innerWidth * 0.46), right: 40 };
  };
  setPadding();
  addEventListener('resize', setPadding);
}

addEventListener('error', (e) => showBanner(`${T.error}: ${e.message}`));
addEventListener('unhandledrejection', (e) => showBanner(`${T.error}: ${(e as PromiseRejectionEvent).reason?.message ?? e}`));

main().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre class="error">${e}</pre>`);
});
