// Profile aus der Community von visualizer.coffee für die Xenia nachbilden.
// Die Decent regelt Fluss und Druck mit Ausstiegsbedingungen; die Xenia kennt per Skript nur Druckstufen.
// Deshalb wird nicht die Decent-Logik übersetzt, sondern der tatsächlich gemessene Druckverlauf eines
// gelungenen Bezugs in Druckstufen zerlegt (Pausen ohne Druck werden zu „Pumpe aus + Warten“).

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const r1 = (v) => Math.round(v * 10) / 10;

// Skriptnamen der Xenia: nur A–Z, 0–9, Leerzeichen, - _ #, höchstens 40 Zeichen
export function scriptName(text, fallback = 'Profil') {
  const s = String(text || '')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9\-_# ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
    .trim();
  return s || fallback;
}

// Messreihe auf ein 0,5-s-Raster bringen (lineare Interpolation)
function resample(t, p, step = 0.5) {
  const pts = [];
  for (let i = 0; i < t.length; i++) if (Number.isFinite(t[i]) && Number.isFinite(p[i])) pts.push([t[i], Math.max(0, p[i])]);
  if (pts.length < 2) return [];
  const end = pts[pts.length - 1][0];
  const out = [];
  let j = 0;
  for (let x = 0; x <= end + 1e-9; x += step) {
    while (j < pts.length - 2 && pts[j + 1][0] < x) j++;
    const [t0, p0] = pts[j];
    const [t1, p1] = pts[j + 1];
    out.push([x, t1 > t0 ? p0 + ((p1 - p0) * Math.min(1, Math.max(0, (x - t0) / (t1 - t0)))) : p0]);
  }
  return out;
}

// Treppe aus Abschnitten: jeder mindestens minLen lang, danach verlängert, solange der Druck höchstens tol
// vom Mittel abweicht. Rampen werden so zu gleichmäßigen Stufen statt zu einem Mittelwert.
function segments(samples, tol, minLen) {
  const segs = [];
  const n = samples.length;
  let i = 0;
  while (i < n) {
    const t0 = samples[i][0];
    let sum = 0;
    let cnt = 0;
    let j = i;
    while (j < n && (cnt === 0 || samples[j][0] - t0 < minLen)) { sum += samples[j][1]; cnt++; j++; }
    while (j < n && Math.abs(samples[j][1] - sum / cnt) <= tol && samples[j][0] - t0 < 45) { sum += samples[j][1]; cnt++; j++; }
    const t1 = j < n ? samples[j][0] : samples[n - 1][0];
    segs.push({ t0, t1, p: sum / cnt });
    i = j;
  }
  // ein Rest am Ende unter minLen gehört zum vorigen Abschnitt
  const last = segs[segs.length - 1];
  if (segs.length > 1 && last.t1 - last.t0 < minLen) {
    const prev = segs[segs.length - 2];
    const a = prev.t1 - prev.t0;
    const b = last.t1 - last.t0;
    prev.p = (prev.p * a + last.p * b) / Math.max(0.1, a + b);
    prev.t1 = last.t1;
    segs.pop();
  }
  return segs;
}

// Gemessener Druck → Skript-Schritte (Anzeigeeinheiten: bar, s), höchstens maxSteps Druckstufen
export function pressureSteps(timeframe, pressure, { maxSteps = 14 } = {}) {
  const samples = resample((timeframe || []).map(num), (pressure || []).map(num));
  if (samples.length < 4) return null;
  let segs = [];
  for (const [tol, minLen] of [[0.5, 1.5], [0.8, 2], [1.2, 2.5], [1.8, 3.5], [2.5, 5]]) {
    segs = segments(samples, tol, minLen);
    if (segs.length <= maxSteps) break;
  }
  const steps = [{ op: 13, args: [] }];
  let built = false; // erst ab dem ersten Druckaufbau zählen Pausen als „Pumpe aus“
  let pumpOff = false;
  for (const s of segs) {
    const dur = r1(Math.max(0.5, s.t1 - s.t0));
    if (built && s.p < 0.8) {
      // Blooming/Pause: Pumpe aus und warten
      if (!pumpOff) steps.push({ op: 6, args: [] });
      steps.push({ op: 12, args: [Math.min(120, dur)] });
      pumpOff = true;
      continue;
    }
    // Anfang (Füllen) mit mindestens 1 bar, damit die Pumpe fördert
    const p = r1(Math.min(10, Math.max(1, s.p)));
    if (p >= 2) built = true;
    let rest = dur;
    while (rest > 0.05) {
      const d = r1(Math.min(45, rest));
      steps.push({ op: 4, args: [p, d] });
      rest = r1(rest - d);
    }
    pumpOff = false;
  }
  if (!pumpOff) steps.push({ op: 6, args: [] });
  return steps;
}

// Visualizer-Bezug (API /api/shots/:id) → Profil für die Xenia mit Vorschau und Eckdaten
export function profileFromShot(shot) {
  const t = (shot.timeframe || []).map(num);
  const d = shot.data || {};
  const steps = pressureSteps(t, d.espresso_pressure);
  if (!steps) return null;
  const p = (d.espresso_pressure || []).map(num);
  const w = (d.espresso_weight || []).map(num);
  // Kurve wie unsere Bezüge: [t, bar, g, ml], etwa alle 0,5 s
  const curve = [];
  let last = -1;
  for (let i = 0; i < t.length; i++) {
    if (!Number.isFinite(t[i]) || t[i] - last < 0.45) continue;
    curve.push([r1(t[i]), r1(p[i] ?? 0), r1(w[i] ?? 0), 0]);
    last = t[i];
  }
  const dose = num(shot.bean_weight);
  const yieldG = num(shot.drink_weight);
  return {
    name: scriptName(shot.profile_title, 'Visualizer'),
    steps,
    curve,
    info: {
      id: shot.id,
      title: shot.profile_title || null,
      user: shot.user_name || null,
      bean: [shot.bean_brand, shot.bean_type].filter(Boolean).join(' · ') || null,
      roast: shot.roast_level || null,
      grinder: [shot.grinder_model, shot.grinder_setting].filter(Boolean).join(' · ') || null,
      dose,
      yield: yieldG,
      ratio: dose && yieldG ? r1(yieldG / dose) : null,
      time: num(shot.duration) ? r1(num(shot.duration)) : null,
      enjoyment: num(shot.espresso_enjoyment),
      url: `https://visualizer.coffee/shots/${shot.id}`,
    },
  };
}

// Listeneintrag der Community-Suche
export function summarize(s) {
  const dose = num(s.bean_weight);
  const yieldG = num(s.drink_weight);
  return {
    id: s.id,
    title: s.profile_title || 'Ohne Titel',
    user: s.user_name || null,
    bean: [s.bean_brand, s.bean_type].filter(Boolean).join(' · ') || null,
    roast: s.roast_level || null,
    dose,
    yield: yieldG,
    ratio: dose && yieldG ? r1(yieldG / dose) : null,
    time: num(s.duration) ? r1(num(s.duration)) : null,
    enjoyment: num(s.espresso_enjoyment),
  };
}
