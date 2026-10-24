// Analoges Rundinstrument (SVG) wie in der Xenia-App: Skala, rote Zone, Nadel, Wert in der Mitte.
import { h, fmt } from './ui.js';

const START = 135;   // Winkel in Grad (SVG: 0° = rechts, im Uhrzeigersinn)
const SWEEP = 270;

function polar(r, deg) {
  const a = (deg * Math.PI) / 180;
  return [100 + r * Math.cos(a), 100 + r * Math.sin(a)];
}

export function createGauge({ title, min, max, majorStep, minorStep, redFrom = null, digits = 1, labelEvery = majorStep }) {
  const ticks = [];
  for (let v = min; v <= max + 1e-9; v += minorStep) {
    const major = Math.abs((v - min) / majorStep - Math.round((v - min) / majorStep)) < 1e-6;
    const deg = START + ((v - min) / (max - min)) * SWEEP;
    const [x1, y1] = polar(major ? 70 : 74, deg);
    const [x2, y2] = polar(82, deg);
    const red = redFrom !== null && v >= redFrom - 1e-9;
    ticks.push(h('line', { x1, y1, x2, y2, class: `g-tick${major ? ' major' : ''}${red ? ' g-zone' : ''}` }));
    const atEnd = Math.abs(v - min) < 1e-9 || Math.abs(v - max) < 1e-9;
    if (major && !atEnd && Math.abs((v - min) / labelEvery - Math.round((v - min) / labelEvery)) < 1e-6) {
      const [lx, ly] = polar(58, deg);
      ticks.push(h('text', { x: lx, y: ly + 3, class: 'g-label' }, String(Math.round(v))));
    }
  }
  const needle = h('polygon', { class: 'g-needle', points: '100,96 100,104 168,100' });
  const value = h('text', { x: 100, y: 156, class: 'g-value' }, '–');
  const sub = h('text', { x: 100, y: 174, class: 'g-sub' }, '');
  const svg = h('svg', { viewBox: '0 0 200 200', role: 'img', 'aria-label': title },
    h('circle', { cx: 100, cy: 100, r: 92, class: 'g-face' }),
    ...ticks,
    needle,
    h('circle', { cx: 100, cy: 100, r: 7, class: 'g-hub' }),
    value,
    sub,
  );
  const el = h('div', { class: 'gauge' }, h('div', { class: 'gauge-title' }, title), svg);
  el.update = (v, subText) => {
    const n = Number(v);
    const clamped = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
    const deg = START + ((clamped - min) / (max - min)) * SWEEP;
    needle.style.setProperty('transform', `rotate(${deg}deg)`);
    value.textContent = Number.isFinite(n) ? fmt(n, digits) : '–';
    sub.textContent = subText || '';
    svg.setAttribute('aria-label', `${title}: ${value.textContent} ${subText || ''}`);
  };
  return el;
}

// Kleiner Verlauf (Druck + Gewicht) für Bezüge
export function sparkline(curve, { height = 64 } = {}) {
  const w = 300;
  if (!curve || curve.length < 2) return h('svg', { class: 'spark', viewBox: `0 0 ${w} ${height}` });
  const tMax = Math.max(...curve.map((p) => p[0] || 0), 1);
  const pMax = 12;
  const wMax = Math.max(...curve.map((p) => p[2] || 0), 1);
  const x = (t) => (t / tMax) * (w - 4) + 2;
  const yP = (p) => height - 4 - ((p || 0) / pMax) * (height - 8);
  const yW = (g) => height - 4 - ((g || 0) / wMax) * (height - 8);
  const pts = (fy, idx) => curve.map((p) => `${x(p[0] || 0).toFixed(1)},${fy(p[idx]).toFixed(1)}`).join(' ');
  return h('svg', { class: 'spark', viewBox: `0 0 ${w} ${height}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Druckverlauf' },
    h('line', { x1: 0, y1: height - 4, x2: w, y2: height - 4, class: 'axis' }),
    curve.some((p) => p[2]) ? h('polyline', { points: pts(yW, 2), class: 'w' }) : null,
    h('polyline', { points: pts(yP, 1), class: 'p' }),
  );
}

export function ring(progress, label) {
  const c = 2 * Math.PI * 40;
  const fg = h('circle', { cx: 48, cy: 48, r: 40, class: 'fg', 'stroke-dasharray': c.toFixed(1), 'stroke-dashoffset': (c * (1 - Math.min(1, progress))).toFixed(1) });
  return h('svg', { class: 'ring', viewBox: '0 0 96 96' }, h('circle', { cx: 48, cy: 48, r: 40, class: 'bg' }), fg, h('text', { x: 48, y: 48 }, label));
}

// Bezugskurve mit Achsen: Druck (bar, links) und Gewicht (g, rechts) über die Bezugszeit.
// curve: [[t_s, druck_bar, gewicht_g, ml], …]; live: Endpunkt markieren und Zeitachse mitwachsen lassen.
export function shotChart(curve, { width = 320, height = 150, live = false, minSeconds = 30 } = {}) {
  const pts = (curve || []).filter((p) => Number.isFinite(p[0]));
  const pad = { l: 26, r: 30, t: 18, b: 18 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const tEnd = pts.length ? pts[pts.length - 1][0] : 0;
  const tMax = Math.max(minSeconds, Math.ceil((tEnd + (live ? 3 : 0)) / 5) * 5);
  const wPeak = Math.max(0, ...pts.map((p) => p[2] || 0));
  const wMax = Math.max(40, Math.ceil(wPeak / 10) * 10);
  const x = (t) => pad.l + (t / tMax) * iw;
  const yP = (v) => pad.t + ih - (Math.min(12, Math.max(0, v || 0)) / 12) * ih;
  const yW = (v) => pad.t + ih - (Math.min(wMax, Math.max(0, v || 0)) / wMax) * ih;
  const grid = [];
  for (let i = 0; i <= 4; i++) {
    const gy = pad.t + (ih * i) / 4;
    grid.push(h('line', { x1: pad.l, y1: gy, x2: width - pad.r, y2: gy, class: 'grid' }));
    grid.push(h('text', { x: pad.l - 4, y: gy + 3, class: 'lbl', 'text-anchor': 'end' }, String(12 - 3 * i)));
    grid.push(h('text', { x: width - pad.r + 4, y: gy + 3, class: 'lbl' }, String(Math.round(wMax - (wMax * i) / 4))));
  }
  const step = tMax > 60 ? 20 : tMax > 30 ? 10 : 5;
  for (let t = step; t < tMax; t += step) grid.push(h('text', { x: x(t), y: height - 4, class: 'lbl', 'text-anchor': 'middle' }, `${t} s`));
  const line = (fy, idx) => pts.map((p) => `${x(p[0]).toFixed(1)},${fy(p[idx]).toFixed(1)}`).join(' ');
  const hasW = pts.some((p) => p[2] > 0);
  const last = pts[pts.length - 1];
  return h('svg', { class: 'shot-chart', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Bezugskurve: Druck und Gewicht' },
    h('text', { x: 2, y: 9, class: 'lbl' }, 'bar'), h('text', { x: width - 2, y: 9, class: 'lbl', 'text-anchor': 'end' }, 'g'),
    ...grid,
    pts.length > 1 ? h('polygon', { class: 'area', points: `${x(pts[0][0]).toFixed(1)},${yP(0)} ${line(yP, 1)} ${x(last[0]).toFixed(1)},${yP(0)}` }) : null,
    pts.length > 1 && hasW ? h('polyline', { class: 'w', points: line(yW, 2) }) : null,
    pts.length > 1 ? h('polyline', { class: 'p', points: line(yP, 1) }) : null,
    live && last ? h('circle', { class: 'head', cx: x(last[0]), cy: yP(last[1]), r: 4 }) : null,
  );
}

// Säulendiagramm. items: [{label, value, mark?, cls?}]; mark = Zielwert (Strich über der Säule).
export function barChart(items, { width = 320, height = 120, unit = '', digits = 0, showValues = true, min = 0 } = {}) {
  const pad = { l: 4, r: 4, t: showValues ? 14 : 6, b: 16 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const top = Math.max(1, ...items.map((i) => Math.max(i.value || 0, i.mark || 0))) * 1.08;
  const slot = iw / Math.max(1, items.length);
  const bw = Math.min(28, slot * 0.66);
  const y = (v) => pad.t + ih - ((Math.max(min, v || 0) - min) / (top - min)) * ih;
  // Beschriftungen ausdünnen, wenn sie sich überlappen würden (ca. 5,5 Einheiten je Zeichen bei 9px); die letzte bleibt
  const labelW = Math.max(0, ...items.map((i) => String(i.label || '').length)) * 5.5 + 4;
  const every = Math.max(1, Math.ceil(labelW / slot));
  const kids = [h('line', { x1: pad.l, y1: pad.t + ih, x2: width - pad.r, y2: pad.t + ih, class: 'axis' })];
  items.forEach((it, i) => {
    const cx = pad.l + slot * i + slot / 2;
    const v = it.value || 0;
    if (v > 0) kids.push(h('rect', { x: cx - bw / 2, y: y(v), width: bw, height: Math.max(1, pad.t + ih - y(v)), rx: Math.min(4, bw / 3), class: `col ${it.cls || ''}` }));
    if (it.mark) kids.push(h('line', { x1: cx - bw / 2 - 2, x2: cx + bw / 2 + 2, y1: y(it.mark), y2: y(it.mark), class: 'mark' }));
    if (showValues && v > 0) kids.push(h('text', { x: cx, y: y(v) - 3, class: 'val', 'text-anchor': 'middle' }, fmt(v, digits)));
    if (it.label && (items.length - 1 - i) % every === 0) kids.push(h('text', { x: cx, y: height - 4, class: 'lbl', 'text-anchor': 'middle' }, it.label));
  });
  return h('svg', { class: 'bar-chart', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': items.map((i) => `${i.label}: ${fmt(i.value, digits)} ${unit}`).join(', ') }, ...kids);
}

// Ist-Wert gegen Zielwert als Balken (z. B. Mahlgewicht). Ohne Ziel: Balken relativ zu max.
// heating: Werte unter dem Ziel sind normal (heizt noch) und bleiben neutral; nur Überschreiten wird gelb/rot.
export function targetBar(value, target, { max = null, width = 300, height = 26, heating = false } = {}) {
  const hi = max || Math.max(value || 0, target || 0) * 1.25 || 1;
  const x = (v) => 2 + (Math.min(hi, Math.max(0, v || 0)) / hi) * (width - 4);
  const off = target ? Math.abs((value || 0) - target) / target : 0;
  const below = heating && (value || 0) < target;
  const cls = !target ? '' : off <= 0.03 ? 'ok' : below ? '' : off <= 0.08 ? 'warn' : 'bad';
  return h('svg', { class: 'target-bar', viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': target ? `${fmt(value)} von ${fmt(target)}` : fmt(value) },
    h('rect', { x: 2, y: 7, width: width - 4, height: 12, rx: 6, class: 'track' }),
    h('rect', { x: 2, y: 7, width: Math.max(0, x(value) - 2), height: 12, rx: 6, class: `fill ${cls}` }),
    target ? h('line', { x1: x(target), x2: x(target), y1: 2, y2: height - 2, class: 'mark' }) : null);
}

// Live-Diagramm wie auf der Seite „General“ der Original-Oberfläche: mehrere Sensoren über die Zeit.
// samples: [{t, ...werte}], series: [{key, label, unit, axis: 'temp'|'bar', cls}]
export function liveChart(samples, series, { width = 320, height = 150, spanMs = 5 * 60e3 } = {}) {
  const now = Date.now();
  const pad = { l: 28, r: 24, t: 8, b: 16 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const axes = { temp: [20, 110], bar: [0, 12] };
  const x = (t) => pad.l + (1 - (now - t) / spanMs) * iw;
  const y = (v, axis) => {
    const [lo, hi] = axes[axis];
    return pad.t + ih - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * ih;
  };
  const grid = [];
  for (let i = 0; i <= 4; i++) {
    const gy = pad.t + (ih * i) / 4;
    grid.push(h('line', { x1: pad.l, y1: gy, x2: width - pad.r, y2: gy, class: 'grid' }));
    grid.push(h('text', { x: pad.l - 4, y: gy + 3, class: 'lbl', 'text-anchor': 'end' }, String(Math.round(110 - (90 * i) / 4))));
    grid.push(h('text', { x: width - pad.r + 4, y: gy + 3, class: 'lbl' }, String(12 - 3 * i)));
  }
  for (let m = 1; m < spanMs / 60e3; m++) {
    const gx = x(now - m * 60e3);
    grid.push(h('text', { x: gx, y: height - 3, class: 'lbl', 'text-anchor': 'middle' }, `-${m} min`));
  }
  const lines = series.map((s) => {
    const pts = samples.filter((p) => p.t >= now - spanMs && Number.isFinite(p[s.key])).map((p) => `${x(p.t).toFixed(1)},${y(p[s.key], s.axis).toFixed(1)}`);
    return pts.length > 1 ? h('polyline', { points: pts.join(' '), class: `ln ${s.cls}` }) : null;
  });
  return h('svg', { class: 'live-chart', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `Verlauf: ${series.map((s) => s.label).join(', ')}` },
    h('text', { x: 2, y: 10, class: 'lbl' }, '°C'), h('text', { x: width - 2, y: 10, class: 'lbl', 'text-anchor': 'end' }, 'bar'),
    ...grid, ...lines);
}
