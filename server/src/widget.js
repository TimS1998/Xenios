// Daten für die Android-Widgets (GET /api/widget): Zustand, laufender und letzter Bezug, Bezüge der letzten Tage,
// Bezugszeiten, Pflege und der Verlauf der letzten 10 Minuten. Kompakt gehalten (Widgets laden das oft).
import { shotPhases, shotMetrics } from '../web/shared/shot-analysis.js';

const r1 = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 10 ** d) / 10 ** d);

// Verlauf der letzten 10 Minuten (alle 5 s ein Wert), wie die Kachel „Verlauf“
export class LiveHistory {
  constructor({ spanMs = 10 * 60e3, everyMs = 5000 } = {}) {
    this.spanMs = spanMs;
    this.everyMs = everyMs;
    this.samples = [];
  }

  add(m, now = Date.now()) {
    if (!m?.online) return;
    const last = this.samples[this.samples.length - 1];
    if (last && now - last.t < this.everyMs) return;
    this.samples.push({ t: now, bg: r1(m.temp?.group), bb: r1(m.temp?.boiler), pu: r1(m.pressure?.pump), sb: r1(m.pressure?.steam, 2) });
    while (this.samples.length && now - this.samples[0].t > this.spanMs) this.samples.shift();
  }

  list(now = Date.now()) {
    return this.samples.filter((s) => now - s.t <= this.spanMs);
  }
}

// Kurve auf höchstens n Punkte ausdünnen (Zeit, Druck, Gewicht)
function thin(curve, n = 90) {
  const c = (curve || []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]));
  if (c.length <= n) return c.map((p) => [p[0], p[1] ?? null, p[2] ?? null]);
  const step = c.length / n;
  const out = [];
  for (let i = 0; i < n; i++) { const p = c[Math.floor(i * step)]; out.push([p[0], p[1] ?? null, p[2] ?? null]); }
  const last = c[c.length - 1];
  out.push([last[0], last[1] ?? null, last[2] ?? null]);
  return out;
}

export function widgetExtras({ m, shots = [], maintenance = null, history = null, now = Date.now() }) {
  const out = {
    pump: r1(m?.pressure?.pump), pumpSet: r1(m?.pressure?.pumpSet),
    gaugeStyle: null,
  };
  // laufender Bezug (für „Espressomaschine groß“ während eines Bezugs)
  if (m?.shot?.running) {
    out.live = {
      timeS: r1((m.shot.timeMs || 0) / 1000), pressure: r1(m.pressure?.pump), weight: r1(m.scale?.weight), rate: r1(m.scale?.rate || m.flow?.rate),
      title: m.shot.script?.title ?? null, curve: thin(m.shot.curve, 60),
    };
  }
  // letzter Bezug: Bezugszeit ohne Vorbrühen wie überall
  const ls = shots[0] || m?.lastShot || null;
  if (ls) {
    const met = shotMetrics(ls);
    const ph = shotPhases(ls);
    out.lastShot = { at: Date.parse(ls.endedAt) || null, timeS: ph.brewMs ? r1(ph.brewMs / 1000) : null, yieldG: met.yieldG, ratio: met.ratio, maxPressure: ls.maxPressure ?? null, curve: thin(ls.curve, 70) };
  }
  // Bezüge pro Tag (7 Tage, ältester zuerst) und die letzten 12 Bezugszeiten
  const day = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const today = day(now);
  const names = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  out.days = Array.from({ length: 7 }, (_, i) => {
    // Kalendertag zurückrechnen (nicht 24 h): über eine Zeitumstellung hinweg trifft das sonst nicht Mitternacht
    const d = new Date(today);
    d.setDate(d.getDate() - (6 - i));
    const start = day(d.getTime());
    return { label: names[new Date(start).getDay()], count: shots.filter((s) => day(Date.parse(s.endedAt)) === start).length };
  });
  out.times = shots.filter((s) => !s.estimated).slice(0, 12).reverse().map((s) => {
    const ph = shotPhases(s);
    const t = new Date(Date.parse(s.endedAt));
    return { label: `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`, s: ph.brewMs ? r1(ph.brewMs / 1000, 0) : null };
  }).filter((x) => x.s);
  if (maintenance?.backflush) {
    const b = maintenance.backflush;
    out.care = { due: Boolean(b.due), daysSince: b.daysSince, intervalDays: b.intervalDays, lastAt: b.lastAt };
  }
  if (history) out.history = history.list(now).map((s) => [Math.round((s.t - now) / 1000), s.bg, s.bb, s.pu, s.sb]);
  return out;
}
