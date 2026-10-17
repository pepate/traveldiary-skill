// „Tag abspielen“: fliegt alle Segmente eines Tages nacheinander ab (Komoot-Stil),
// zeigt Kennzahlen, Höhenprofil, Stopps und Fotos an der Stelle, wo sie entstanden sind.
import maplibregl from 'maplibre-gl';
import { COLORS, ICONS, TripMap } from './map';
import type { DayData, Kind, Photo, Poi, Segment, Stop } from './types';
import { poisForDay } from './pois';
import { T, fmtNum, fmtClock } from './i18n';

type Event =
  | { type: 'seg'; seg: Segment; photos: Photo[]; pois: { poi: Poi; atM: number }[]; startMs: number; endMs: number }
  | { type: 'stop'; stop: Stop; photos: Photo[]; startMs: number; endMs: number };

const VIEW: Record<string, { zoom: number; pitch: number }> = {
  camper: { zoom: 10.2, pitch: 55 }, car: { zoom: 12, pitch: 55 }, ebike: { zoom: 13.6, pitch: 62 }, bike: { zoom: 13.6, pitch: 62 },
  walk: { zoom: 15.2, pitch: 60 }, hike: { zoom: 14.6, pitch: 62 }, ferry: { zoom: 13.5, pitch: 55 }, bus: { zoom: 12, pitch: 55 }, train: { zoom: 11, pitch: 55 }, boat: { zoom: 12.6, pitch: 55 },
};
const showHm = (k: Kind) => k === 'ebike' || k === 'bike' || k === 'walk' || k === 'hike';

const fmtKm = (m: number) => fmtNum(m / 1000, { minimumFractionDigits: m < 100000 ? 1 : 0, maximumFractionDigits: m < 100000 ? 1 : 0 });
const fmtDur = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? [`${h}:${String(m).padStart(2, '0')}`, T.h] : [`${m}:${String(s % 60).padStart(2, '0')}`, T.min]; };
const lerpAngle = (a: number, b: number, t: number) => { let d = ((b - a + 540) % 360) - 180; return a + d * t; };
const bearing = ([x1, y1]: number[], [x2, y2]: number[]) => {
  const φ1 = y1 * Math.PI / 180, φ2 = y2 * Math.PI / 180, Δλ = (x2 - x1) * Math.PI / 180;
  return (Math.atan2(Math.sin(Δλ) * Math.cos(φ2), Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)) * 180 / Math.PI + 360) % 360;
};

export class Replay {
  private raf = 0;
  private running = false;
  private paused = false;
  private speed = 1;
  private skip = false;
  private vehicle: maplibregl.Marker;
  private el: HTMLElement;
  private q = <T extends Element = HTMLElement>(sel: string) => this.el.querySelector<T>(sel)!;
  onClose: () => void = () => {};

  constructor(private tm: TripMap, root: HTMLElement, private openPhoto: (p: Photo) => void) {
    this.el = root;
    const v = document.createElement('div');
    v.className = 'vehicle';
    this.vehicle = new maplibregl.Marker({ element: v });
    root.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'close') this.stop();
      if (act === 'toggle') this.togglePause();
      if (act === 'next') this.skip = true;
      if (act === 'speed') { this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 4 : 1; this.q('[data-act=speed]').textContent = `${this.speed}×`; }
      if (act === 'again') this.play(this.current!, this.currentPhotos);
    });
    addEventListener('keydown', (e) => { if (!this.running) return; if (e.key === 'Escape') this.stop(); if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (this.pendingNext) this.pendingNext(); else this.togglePause(); } });
  }

  private current: DayData | null = null;
  private currentPhotos: Photo[] = [];

  pois: Poi[] = [];

  async play(day: DayData, photos: Photo[]) {
    this.stop(false);
    this.current = day; this.currentPhotos = photos;
    this.running = true; this.paused = false; this.skip = false;
    document.body.classList.add('replaying');
    this.el.hidden = false;
    this.q('.replay-end').hidden = true;
    this.q('[data-act=toggle]').textContent = '❚❚';
    await this.tm.ready;
    const m = this.tm.map;
    m.resize();
    this.tm.clearMarkers();
    this.tm.setLines('day', []);
    this.tm.setLines('live', []);
    this.tm.setTerrain(true);

    const events = this.buildEvents(day, photos);
    // Fotos und Info-Bilder des Tages vorladen, damit sie beim Abspielen sofort da sind
    const urls = [...photos.map((p) => p.src), ...events.flatMap((e) => e.type === 'seg' ? e.pois.map((q) => q.poi.image) : []).filter((u): u is string => !!u)];
    await this.preload(urls);
    if (!this.running) return;
    this.q('.replay-day').textContent = `${T.day} ${day.n} · ${day.title}`;
    const bar = this.q('.replay-progress');
    bar.innerHTML = events.filter((e): e is Extract<Event, { type: 'seg' }> => e.type === 'seg').map((e) => `<i style="flex:${Math.max(1, Math.sqrt(e.seg.distanceM / 1000))};--c:${COLORS[e.seg.kind]}"><b></b></i>`).join('');
    const bars = [...bar.querySelectorAll<HTMLElement>('b')];

    // Überblick des Tages
    const all = day.segments.flatMap((s) => s.coords);
    if (all.length) {
      m.fitBounds(this.tm.boundsOf(all), { padding: { top: 140, bottom: 160, left: 30, right: 30 }, duration: 1800, pitch: 45, bearing: 0, essential: true });
      await this.wait(2100);
    }
    const drawn: { kind: Kind; coords: [number, number, number][] }[] = [];
    let segIdx = 0, totalDist = 0, totalAsc = 0, totalMs = 0;
    for (const ev of events) {
      if (!this.running) return;
      if (ev.type === 'stop') { await this.playStop(ev); continue; }
      const seg = ev.seg, view = VIEW[seg.kind];
      this.setLabel(seg.kind, seg.label ?? T.kinds[seg.kind], seg.times[0]);
      this.drawProfile(seg);
      this.vehicle.getElement().textContent = ICONS[seg.kind];
      this.vehicle.setLngLat(seg.coords[0].slice(0, 2) as [number, number]).addTo(m);
      const b0 = bearing(seg.coords[0], seg.coords[Math.min(seg.coords.length - 1, 5)]);
      m.flyTo({ center: seg.coords[0].slice(0, 2) as [number, number], zoom: view.zoom, pitch: view.pitch, bearing: b0, duration: 1500, essential: true });
      await this.wait(1550);
      if (!this.running) return;

      const dur = this.durationFor(seg);
      const photoQueue = [...ev.photos].sort((a, b) => a.taken.localeCompare(b.taken));
      const poiQueue = [...ev.pois].sort((a, b) => a.atM - b.atM);
      const ascCum = this.ascentCum(seg);
      let p = 0, last = performance.now(), head = b0;
      await new Promise<void>((done) => {
        const frame = (now: number) => {
          if (!this.running) return done();
          const dt = now - last; last = now;
          if (!this.paused) p = Math.min(1, Math.max(0, p + (Math.max(0, dt) * this.speed) / dur));
          if (this.skip) { p = 1; this.skip = false; }
          const target = p * seg.distanceM;
          let i = 0, j = seg.cum.length - 1;
          while (i < j) { const k = (i + j) >> 1; if (seg.cum[k] < target) i = k + 1; else j = k; }
          const i0 = Math.max(0, i - 1), f = seg.cum[i] === seg.cum[i0] ? 1 : (target - seg.cum[i0]) / (seg.cum[i] - seg.cum[i0]);
          const a = seg.coords[i0], b = seg.coords[i];
          const pos: [number, number] = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
          const tMs = seg.times[i0] + (seg.times[i] - seg.times[i0]) * f;
          this.tm.setLines('live', [...drawn, { kind: seg.kind, coords: [...seg.coords.slice(0, i0 + 1), [pos[0], pos[1], 0]] }]);
          this.vehicle.setLngLat(pos);
          const look = seg.coords[Math.min(seg.coords.length - 1, i + 4)];
          if (look !== b) head = lerpAngle(head, bearing(pos, look), 0.035);
          m.jumpTo({ center: pos, bearing: head, zoom: view.zoom, pitch: view.pitch });
          this.setStats(totalDist + target, showHm(seg.kind) ? totalAsc + ascCum[i0] : null, totalMs + (tMs - seg.times[0]), tMs, p);
          bars[segIdx].style.width = `${p * 100}%`;
          // Foto erreicht?
          const ph = photoQueue[0];
          if (ph && Date.parse(ph.taken) <= tMs && !this.paused) {
            this.showPhotos(this.takeGroup(photoQueue)).then(() => {});
          }
          const pq = poiQueue[0];
          if (pq && pq.atM <= target && !this.paused) {
            poiQueue.shift();
            this.showPoi(pq.poi).then(() => {});
          }
          if (p >= 1) return done();
          this.raf = requestAnimationFrame(frame);
        };
        this.raf = requestAnimationFrame(frame);
      });
      if (!this.running) return;
      while (photoQueue.length) await this.showPhotos(this.takeGroup(photoQueue));
      for (const pq of poiQueue) await this.showPoi(pq.poi);
      drawn.push({ kind: seg.kind, coords: seg.coords });
      totalDist += seg.distanceM; totalMs += seg.times.at(-1)! - seg.times[0];
      if (showHm(seg.kind)) totalAsc += seg.ascentM;
      segIdx++;
    }
    this.finish(day, totalDist, totalAsc, totalMs);
  }

  private async playStop(ev: Extract<Event, { type: 'stop' }>) {
    const m = this.tm.map;
    this.setLabel(null, ev.stop.label, ev.startMs, `${ev.stop.minutes} min`);
    this.tm.addStopMarker(ev.stop, true);
    if (ev.stop.minutes >= 25 || ev.photos.length) {
      m.easeTo({ center: [ev.stop.lon, ev.stop.lat], zoom: Math.max(m.getZoom(), 14.5), pitch: 60, bearing: m.getBearing() + 25, duration: 2200, essential: true });
      await this.wait(ev.photos.length ? 900 : 1800);
    }
    const queue = [...ev.photos];
    while (queue.length) await this.showPhotos(this.takeGroup(queue));
  }

  // Karten (Foto/Info) laufen nacheinander und bleiben stehen, bis „Weiter“ getippt wird
  private chain: Promise<void> = Promise.resolve();
  private pendingNext: (() => void) | null = null;
  private hideTimer = 0;
  private showCard(card: HTMLElement, fill: () => void): Promise<void> {
    const run = () => new Promise<void>((res) => {
      if (!this.running) return res();
      clearTimeout(this.hideTimer);
      fill();
      card.hidden = false;
      requestAnimationFrame(() => card.classList.add('in'));
      const wasPaused = this.paused; this.paused = true;
      const btn = card.querySelector<HTMLButtonElement>('.replay-next')!;
      const done = () => {
        btn.onclick = null; this.pendingNext = null;
        card.classList.remove('in');
        this.hideTimer = window.setTimeout(() => { card.hidden = true; }, 350);
        this.paused = wasPaused;
        res();
      };
      btn.onclick = (e) => { e.stopPropagation(); done(); };
      this.pendingNext = done;
    });
    return (this.chain = this.chain.then(run, run));
  }

  // Desktop: Fotos, die kurz nacheinander entstanden sind, als Gruppe zeigen (weniger „Weiter“-Klicks); Videos und Mobil einzeln
  private takeGroup(queue: Photo[]): Photo[] {
    const group = [queue.shift()!];
    if (!matchMedia('(min-width: 900px)').matches || group[0].video) return group;
    const t0 = Date.parse(group[0].taken);
    while (group.length < 6 && queue[0] && !queue[0].video && Date.parse(queue[0].taken) - t0 <= 15 * 60000) group.push(queue.shift()!);
    return group;
  }

  private showPhotos(group: Photo[]) {
    const card = this.q<HTMLElement>('.replay-photo');
    return this.showCard(card, () => {
      const grid = card.querySelector<HTMLElement>('.rp-grid')!;
      const multi = group.length > 1;
      grid.dataset.n = String(group.length);
      grid.replaceChildren(...group.map((p) => {
        const cell = document.createElement('div');
        cell.className = 'rp-cell';
        const img = document.createElement('img');
        img.src = p.src; img.alt = p.caption || '';
        img.onclick = () => this.openPhoto(p);
        cell.append(img);
        if (multi) { const s = document.createElement('span'); s.textContent = `${p.caption || ''} ${fmtClock(Date.parse(p.taken))}`.trim(); cell.append(s); }
        return cell;
      }));
      const p = group[0];
      card.querySelector('figcaption')!.textContent = multi ? '' : `${p.caption || ''} ${fmtClock(Date.parse(p.taken))}`.trim();
      card.classList.toggle('multi', multi);
      card.classList.toggle('is-video', !!p.video);
      for (const ph of group) this.tm.addPhotoMarker(ph, true);
    });
  }

  private showPoi(p: Poi) {
    const card = this.q<HTMLElement>('.replay-info');
    return this.showCard(card, () => {
      const img = card.querySelector('img')!;
      img.src = p.image ?? '';
      img.hidden = !p.image;
      card.querySelector('h4')!.textContent = p.title;
      card.querySelector('p.text')!.textContent = p.text;
      card.querySelector('small')!.textContent = p.credit ? `${T.photoCredit} ${p.credit.artist}, ${p.credit.license} (${T.commons})` : '';
      this.tm.addPoiMarker(p, true);
    });
  }

  private finish(day: DayData, dist: number, asc: number, ms: number) {
    this.vehicle.remove();
    const end = this.q('.replay-end');
    end.querySelector('.end-stats')!.innerHTML = `<div><span>${T.replay.distance}</span><strong>${fmtKm(dist)} km</strong></div>${asc ? `<div><span>${T.replay.ascent}</span><strong>${fmtNum(asc)} m</strong></div>` : ''}<div><span>${T.replay.underwayTime}</span><strong>${fmtDur(ms).join(' ')}</strong></div>`;
    end.querySelector('h3')!.textContent = `${T.day} ${day.n} · ${day.title}`;
    end.hidden = false;
    this.tm.map.easeTo({ pitch: 45, zoom: this.tm.map.getZoom() - 1.5, bearing: this.tm.map.getBearing() + 30, duration: 4000 });
  }

  stop(close = true) {
    cancelAnimationFrame(this.raf);
    this.running = false;
    this.vehicle.remove();
    this.pendingNext?.();
    this.q<HTMLElement>('.replay-photo').hidden = true;
    this.q<HTMLElement>('.replay-info').hidden = true;
    this.q<HTMLElement>('.replay-loading').hidden = true;
    if (close) {
      this.el.hidden = true;
      document.body.classList.remove('replaying');
      this.onClose();
    }
  }

  /** Lädt Bilder parallel (max. 4 gleichzeitig) mit Fortschrittsanzeige; bricht nach 25 s ab und startet trotzdem. */
  private async preload(urls: string[]) {
    const box = this.q<HTMLElement>('.replay-loading');
    const bar = box.querySelector<HTMLElement>('b')!, txt = box.querySelector('span')!;
    const list = [...new Set(urls)];
    if (!list.length) return;
    box.hidden = false;
    let done = 0;
    const tick = () => { done++; bar.style.width = `${(done / list.length) * 100}%`; txt.textContent = `${T.replay.loading} ${done}/${list.length}`; };
    tick(); done = 0;
    const load = (u: string) => new Promise<void>((res) => { const im = new Image(); im.onload = im.onerror = () => { tick(); res(); }; im.src = u; });
    const queue = [...list];
    const worker = async () => { while (queue.length && this.running) await load(queue.shift()!); };
    await Promise.race([Promise.all(Array.from({ length: 4 }, worker)), this.wait(25000)]);
    box.hidden = true;
  }

  private togglePause() { this.paused = !this.paused; this.q('[data-act=toggle]').textContent = this.paused ? '▶' : '❚❚'; }
  private wait(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

  private durationFor(seg: Segment): number {
    const km = seg.distanceM / 1000;
    const base = { camper: 7000 + km * 35, car: 4000 + km * 150, ebike: 7000 + km * 450, bike: 7000 + km * 450, walk: 5000 + km * 900, hike: 6000 + km * 700, ferry: 4000 + km * 1000, bus: 5000 + km * 200, train: 5000 + km * 100, boat: 6000 + km * 400 }[seg.kind] ?? 6000;
    return Math.min(base, 22000);
  }

  private ascentCum(seg: Segment): number[] {
    const ele = seg.coords.map((c) => c[2]), w = 3, out = [0];
    const sm = ele.map((_, i) => { const s = ele.slice(Math.max(0, i - w), i + w + 1); return s.reduce((a, b) => a + b, 0) / s.length; });
    for (let i = 1; i < sm.length; i++) out.push(out[i - 1] + Math.max(0, sm[i] - sm[i - 1]));
    return out.map(Math.round);
  }

  private buildEvents(day: DayData, photos: Photo[]): Event[] {
    const evs: Event[] = [
      ...day.segments.map((seg) => ({ type: 'seg' as const, seg, photos: [] as Photo[], pois: [] as { poi: Poi; atM: number }[], startMs: seg.times[0], endMs: seg.times.at(-1)! })),
      ...day.stops.filter((s) => s.minutes >= 10).map((stop) => ({ type: 'stop' as const, stop, photos: [] as Photo[], startMs: Date.parse(stop.start), endMs: Date.parse(stop.end) })),
    ].sort((a, b) => a.startMs - b.startMs);
    // Stopps vor dem ersten bzw. nach dem letzten Segment nur behalten, wenn Fotos dazukommen (sonst Nacht/Zuhause)
    for (const p of photos) {
      const t = Date.parse(p.taken);
      const ev = evs.find((e) => t >= e.startMs - 60000 && t <= e.endMs + 60000) ?? evs.find((e) => e.startMs > t) ?? evs.at(-1);
      ev?.photos.push(p);
    }
    for (const h of poisForDay(day, this.pois)) {
      const ev = evs.find((e) => e.type === 'seg' && e.seg === h.seg);
      if (ev && ev.type === 'seg') ev.pois.push({ poi: h.poi, atM: h.seg.cum[h.index] });
    }
    const firstSeg = evs.findIndex((e) => e.type === 'seg'), lastSeg = evs.length - 1 - [...evs].reverse().findIndex((e) => e.type === 'seg');
    return evs.filter((e, i) => e.type === 'seg' || e.photos.length || (i > firstSeg && i < lastSeg));
  }

  private setLabel(kind: Kind | null, text: string, ms: number, extra?: string) {
    this.q('.replay-kind').textContent = kind ? ICONS[kind] : '📍';
    this.q('.replay-title').textContent = text;
    this.q('.replay-clock').textContent = extra ? `${fmtClock(ms)} · ${extra}` : fmtClock(ms);
  }

  private setStats(dist: number, asc: number | null, dur: number, clockMs: number, p: number) {
    this.q('[data-stat=dist]').textContent = fmtKm(dist);
    this.q('[data-stat=asc]').textContent = asc == null ? '–' : fmtNum(asc);
    const [tv, tu] = fmtDur(dur);
    this.q('[data-stat=time]').textContent = tv;
    this.q('[data-stat=time-unit]').textContent = tu;
    this.q('.replay-clock').textContent = fmtClock(clockMs);
    this.q<SVGRectElement>('.profile .prog').setAttribute('width', String(p * 100));
    this.q<SVGCircleElement>('.profile .dot').setAttribute('cx', String(p * 100));
    const ys = this.profileYs;
    if (ys.length) this.q<SVGCircleElement>('.profile .dot').setAttribute('cy', String(ys[Math.max(0, Math.min(ys.length - 1, Math.floor(p * (ys.length - 1))))]));
  }

  private profileYs: number[] = [];
  private drawProfile(seg: Segment) {
    const svg = this.q<SVGSVGElement>('.profile');
    const ele = seg.coords.map((c) => c[2]);
    const n = Math.min(160, ele.length), ys: number[] = [];
    const samples = Array.from({ length: n }, (_, i) => ele[Math.floor(i * (ele.length - 1) / Math.max(1, n - 1))]);
    const min = Math.min(...samples), max = Math.max(...samples), span = Math.max(30, max - min);
    for (let i = 0; i < n; i++) ys.push(+(34 - ((samples[i] - min) / span) * 30).toFixed(2));
    this.profileYs = ys;
    const pts = ys.map((y, i) => `${(i / (n - 1) * 100).toFixed(2)},${y}`).join(' ');
    svg.innerHTML = `<defs><clipPath id="pclip"><rect class="prog" x="0" y="0" width="0" height="40"/></clipPath></defs>
      <polygon points="0,40 ${pts} 100,40" fill="rgba(255,255,255,.14)"/>
      <polygon points="0,40 ${pts} 100,40" fill="${COLORS[seg.kind]}" opacity=".85" clip-path="url(#pclip)"/>
      <polyline points="${pts}" fill="none" stroke="rgba(255,255,255,.55)" stroke-width=".6" vector-effect="non-scaling-stroke"/>
      <circle class="dot" cx="0" cy="${ys[0]}" r="1.6" fill="#fff" vector-effect="non-scaling-stroke"/>`;
    this.q('.profile-min').textContent = `${Math.round(min)} m`;
    this.q('.profile-max').textContent = `${Math.round(max)} m`;
    this.q('.profile-len').textContent = `${fmtKm(seg.distanceM)} km`;
  }
}
