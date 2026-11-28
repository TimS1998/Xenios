// Auswertung eines Bezugs: Zielkurve aus den Skript-Schritten, Kennzahlen aus der Kurve und ein Mahlgrad-Tipp.
// Läuft im Browser (Detailansicht) und in den Tests. Kurvenpunkte: [Zeit s, Druck bar, Gewicht g, Menge ml].
import { t } from './i18n.js';

// Soll-Druck über die Zeit aus Skript-Schritten (Anzeigeeinheiten wie im Editor: bar, s).
// Pumpendruck (4) gibt den Druck für eine Dauer vor; Warten (12) nach „Pumpe aus“ ist drucklos.
// Schritte ohne bekannten Druck (Pumpenleistung, Durchfluss) unterbrechen die Kurve → null.
export function targetCurve(steps) {
  if (!Array.isArray(steps) || !steps.some((s) => Number(s.op) === 4)) return null;
  const pts = [];
  let t = 0;
  let pumpOn = false;
  for (const s of steps) {
    const op = Number(s.op);
    const [a, b] = (s.args || []).map(Number);
    if (op === 4 && b > 0) {
      pts.push([t, a], [t + b, a]);
      t += b;
      pumpOn = true;
    } else if (op === 3 && b > 0) {
      pts.push(null);
      t += b;
      pumpOn = true;
    } else if (op === 5 && b > 0) {
      pts.push(null);
      t += b;
      pumpOn = true;
    } else if (op === 6) {
      pumpOn = false;
    } else if (op === 12 && a > 0) {
      if (!pumpOn) pts.push([t, 0], [t + a, 0]);
      t += a;
    }
  }
  return pts.length ? pts : null;
}

// Druckprofil-Baukasten → Skript-Schritte (Anzeigeeinheiten): Brühventil auf → Vorbrühen → optional Pause
// (Pumpe aus) → Hauptdruck → optional Abfall in vier Stufen → Pumpe aus. Ergibt ein normales Skript der Maschine.
// Geplante Laufzeit eines Skripts in Sekunden (Schritte mit Dauer: Pumpe 3/4/5, Warten 12); null, wenn unbekannt
export function scriptDuration(steps) {
  if (!Array.isArray(steps) || !steps.length) return null;
  let t = 0;
  for (const st of steps) {
    const op = Number(st.op);
    const a = (st.args || []).map(Number);
    if ([3, 4, 5].includes(op) && a[1] > 0) t += a[1];
    else if (op === 12 && a[0] > 0) t += a[0];
  }
  return t > 0 ? t : null;
}

export function profileSteps(p) {
  const r1 = (v) => Math.round(v * 10) / 10;
  const steps = [{ op: 13, args: [] }];
  if (p.basket === 'single') steps.push({ op: 32, args: [] });
  if (p.basket === 'double') steps.push({ op: 33, args: [] });
  if (p.preT > 0) steps.push({ op: 4, args: [p.preP, p.preT] });
  if (p.pauseT > 0) steps.push({ op: 6, args: [] }, { op: 12, args: [p.pauseT] });
  steps.push({ op: 4, args: [p.mainP, p.mainT] });
  if (p.declineT > 0 && p.endP !== p.mainP) {
    for (let i = 1; i <= 4; i++) steps.push({ op: 4, args: [r1(p.mainP + ((p.endP - p.mainP) * i) / 4), r1(p.declineT / 4)] });
  }
  steps.push({ op: 6, args: [] });
  return steps;
}
// Zeiten eines Bezugs. Wie an der Xenia zählt als Bezugszeit nur die eigentliche Extraktion: das Vorbrühen (Phase mit
// niedrigem Druck am Anfang) wird von der Gesamtzeit abgezogen. Vorbrühen = Zeit bis zum ersten Mal ≥ 4 bar, wenn
// das mindestens 3 s dauert (kürzer ist es nur der normale Druckaufbau). Erster Tropfen = 1 g mehr auf der Waage als
// bisher am wenigsten (so auch bei nicht genau tarierter Waage). Neue Bezüge speichern die Werte; ältere werden aus
// der Kurve berechnet, ohne Kurve gilt die Gesamtzeit.
const MAIN_BAR = 4;
const PRE_MIN_S = 3;
export function shotPhases(shot) {
  const totalMs = Number.isFinite(shot?.timeMs) ? shot.timeMs : null;
  if (Number.isFinite(shot?.brewMs)) {
    return { totalMs, preMs: shot.preinfusionMs || 0, brewMs: shot.brewMs, firstDropMs: Number.isFinite(shot.firstDropMs) ? shot.firstDropMs : null };
  }
  const c = (shot?.curve || []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]));
  let preS = 0;
  let firstS = null;
  if (c.length) {
    const reach = c.find((p) => p[1] >= MAIN_BAR)?.[0];
    if (reach != null && reach >= PRE_MIN_S) preS = reach;
    let min = Infinity;
    for (const p of c) {
      const w = Number(p[2]);
      if (p[2] == null || !Number.isFinite(w)) continue;
      if (w - min >= 1) { firstS = p[0]; break; }
      min = Math.min(min, w);
    }
  }
  const preMs = Math.round(preS * 1000);
  return { totalMs, preMs, brewMs: totalMs !== null ? Math.max(0, totalMs - preMs) : null, firstDropMs: firstS !== null ? Math.round(firstS * 1000) : null };
}
// Bezugszeit in Sekunden (ohne Vorbrühen) für Listen, Kacheln und Statistik
export function brewSeconds(shot) {
  const b = shotPhases(shot).brewMs;
  return b ? b / 1000 : null;
}
// Laufender Bezug: im Vorbrühen dessen Dauer, danach die Bezugszeit ab Ende des Vorbrühens
export function liveTimes(shot) {
  const t = (shot?.timeMs || 0) / 1000;
  const c = (shot?.curve || []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]));
  const reach = c.find((p) => p[1] >= MAIN_BAR)?.[0];
  if (reach == null) return t >= PRE_MIN_S ? { pre: true, preS: t, brewS: 0 } : { pre: false, preS: 0, brewS: t };
  const preS = reach >= PRE_MIN_S ? reach : 0;
  return { pre: false, preS, brewS: Math.max(0, t - preS) };
}

// Gewicht vor dem Tarieren verwerfen: Manche Waagen (Bookoo an der DBL) melden zu Beginn des Bezugs noch kurz den
// alten Wert (z. B. 290 g), bevor sie auf 0 springen. Ab dem ersten Wert unter 1 g zählt die Kurve; davor 0.
// Nur in den ersten Sekunden: fällt das Gewicht erst später unter 1 g (Tasse abgenommen), ist das kein Tarieren.
const TARE_WINDOW_S = 5;
export function taredCurve(curve) {
  const c = Array.isArray(curve) ? curve : [];
  const i0 = c.findIndex((p) => Array.isArray(p) && Number(p[0]) < TARE_WINDOW_S && p[2] != null && Number(p[2]) < 1);
  if (i0 <= 0) return c;
  return c.map((p, i) => (i < i0 && Array.isArray(p) && p[2] != null ? [p[0], p[1], 0, ...p.slice(3)] : p));
}
// Ausbeute aus der Kurve: höchstes Gewicht nach dem Tarieren (null ohne Gewichtswerte)
export function curveYield(curve) {
  const w = taredCurve(curve).filter((p) => Array.isArray(p) && p[2] != null).map((p) => Number(p[2])).filter(Number.isFinite);
  const max = w.length ? Math.max(...w) : 0;
  return max > 0 ? Math.round(max * 10) / 10 : null;
}

// Kennzahlen aus der Kurve und den Notizen
export function shotMetrics(shot) {
  const c = taredCurve(shot?.curve || []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]));
  const yieldG = shot?.notes?.yieldG ?? curveYield(c) ?? shot?.weight ?? null;
  const doseG = shot?.notes?.doseG ?? shot?.dose?.g ?? shot?.doseDefaultG ?? null;
  const ph = shotPhases(shot);
  const main = c.filter((p) => p[1] >= MAIN_BAR);
  const avgPressure = main.length ? main.reduce((s, p) => s + p[1], 0) / main.length : null;
  const end = c[c.length - 1];
  const firstDropS = ph.firstDropMs !== null ? ph.firstDropMs / 1000 : null;
  const flowStart = firstDropS ?? (ph.preMs ? ph.preMs / 1000 : null);
  const avgFlow = end && flowStart !== null && end[0] - flowStart > 2 && end[2] > 0 ? end[2] / (end[0] - flowStart) : null;
  const round = (v, d = 1) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
  return {
    timeS: ph.brewMs ? round(ph.brewMs / 1000) : null, // Bezugszeit ohne Vorbrühen
    totalS: ph.totalMs ? round(ph.totalMs / 1000) : null,
    yieldG: round(yieldG),
    doseG: round(doseG),
    doseAssumed: shot?.notes?.doseG == null && shot?.dose?.g == null && shot?.doseDefaultG != null,
    ratio: doseG && yieldG ? round(yieldG / doseG) : null,
    preinfusionS: ph.preMs ? round(ph.preMs / 1000) : null,
    firstDropS: round(firstDropS),
    avgPressure: round(avgPressure),
    maxPressure: shot?.maxPressure ?? null,
    avgFlow: round(avgFlow),
  };
}

// Einfacher Tipp in Richtung Mahlgrad. Geschmack zählt vor Zeit und Verhältnis; Zielbereich klassischer Espresso
// (25–32 s, 1:1,8–1:2,5). Kein Ersatz für die eigene Zunge, nur ein Anhaltspunkt.
export function grindAdvice(shot, m = shotMetrics(shot)) {
  const taste = shot?.notes?.taste;
  const fast = m.timeS !== null && m.timeS < 23;
  const slow = m.timeS !== null && m.timeS > 35;
  const long = m.ratio !== null && m.ratio > 2.6;
  const short = m.ratio !== null && m.ratio < 1.7;
  if (taste === 'sour') {
    if (short) return { dir: 'longer', text: t('shots.analysis.grind.sourShort') };
    return { dir: 'finer', text: t('shots.analysis.grind.sour') };
  }
  if (taste === 'bitter') {
    if (long) return { dir: 'shorter', text: t('shots.analysis.grind.bitterLong') };
    return { dir: 'coarser', text: t('shots.analysis.grind.bitter') };
  }
  if (taste === 'balanced') return { dir: 'keep', text: t('shots.analysis.grind.balanced') };
  if (fast) return { dir: 'finer', text: t('shots.analysis.grind.fast', { s: m.timeS }) };
  if (slow) return { dir: 'coarser', text: t('shots.analysis.grind.slow', { s: m.timeS }) };
  return null;
}

// --- Einstell-Assistent --------------------------------------------------------------
// Wie der „Coffee Compass“: Geschmack (sauer ↔ bitter) sagt, ob mehr oder weniger extrahiert werden muss (Mahlgrad),
// Stärke (dünn ↔ kräftig) sagt, ob das Verhältnis passt (Ausbeute/Dosis). Dazu die Zeit und der Verlauf der letzten
// bewerteten Bezüge derselben Bohne: zweimal sauer → mutiger feiner; von bitter nach sauer → halber Schritt zurück.
// Bezeichnungen erst beim Lesen (Sprache je Gerät); Schlüssel, `in` und Object.entries wie bei einem festen Objekt
export const STRENGTH = {
  get weak() { return t('shots.analysis.strength.weak'); },
  get ok() { return t('shots.analysis.strength.ok'); },
  get strong() { return t('shots.analysis.strength.strong'); },
};

const DIAL_TITLE = () => ({
  finer: [t('shots.analysis.dialTitle.slightlyFiner'), t('shots.analysis.dialTitle.finer'), t('shots.analysis.dialTitle.muchFiner')],
  coarser: [t('shots.analysis.dialTitle.slightlyCoarser'), t('shots.analysis.dialTitle.coarser'), t('shots.analysis.dialTitle.muchCoarser')],
  keep: Array(3).fill(t('shots.analysis.dialTitle.keep')),
  longer: Array(3).fill(t('shots.analysis.dialTitle.longer')),
  shorter: Array(3).fill(t('shots.analysis.dialTitle.shorter')),
  puck: Array(3).fill(t('shots.analysis.dialTitle.puck')),
});

// Pumpzeit des Skripts (für lange Profile wie Blooming gelten andere Zeiten)
function plannedSeconds(steps) {
  const tc = targetCurve(steps);
  const last = tc?.filter(Boolean).at(-1);
  return last ? last[0] : null;
}

// shot: der bewertete Bezug; earlier: ältere Bezüge (neueste zuerst). → { dir, size, title, text, anchor, trail } oder null
export function dialIn(shot, earlier = []) {
  const n = shot?.notes || {};
  const m = shotMetrics(shot);
  const bean = n.bean || null;
  const end = Date.parse(shot?.endedAt) || Date.now();
  // Vergleich: bewertete Bezüge derselben Bohne der letzten 14 Tage (ohne Bohne: der letzten 2 Tage)
  const span = (bean ? 14 : 2) * 86400e3;
  const rated = earlier.filter((s) => s !== shot && (s.notes?.taste || s.notes?.strength)
    && (s.notes?.bean || null) === bean && end - Date.parse(s.endedAt) <= span && Date.parse(s.endedAt) <= end);
  const prev = rated[0] || null;
  const anchorShot = rated.find((s) => (s.notes.taste === 'balanced' || s.notes.reference) && s.notes.grind);
  const anchor = anchorShot ? { grind: anchorShot.notes.grind, at: anchorShot.endedAt, timeS: shotMetrics(anchorShot).timeS } : null;
  const trail = [shot, ...rated.slice(0, 3)].reverse().map((s) => ({ at: s.endedAt, grind: s.notes?.grind ?? null, taste: s.notes?.taste ?? null, timeS: shotMetrics(s).timeS }));

  const planned = plannedSeconds(shot?.script?.steps);
  const long = planned !== null && planned > 32; // Profil mit langer Pumpzeit: Zeitregeln gelten nicht
  const fast = !long && m.timeS !== null && m.timeS < 22;
  const slow = !long && m.timeS !== null && m.timeS > 35;
  const time = m.timeS !== null ? `${String(m.timeS).replace('.', ',')} s` : '';
  const pt = prev?.notes?.taste;
  const out = (dir, size, text) => ({ dir, size, title: DIAL_TITLE()[dir][size], text, anchor, trail });

  if (n.taste === 'sour') {
    if (n.strength === 'strong') return out('longer', 1, t('shots.analysis.dial.sourStrong'));
    if (slow) return out('puck', 1, t('shots.analysis.dial.sourSlow', { time }));
    if (pt === 'bitter') return out('finer', 0, t('shots.analysis.dial.sourAfterBitter'));
    if (pt === 'sour') return out('finer', 2, t('shots.analysis.dial.sourAgain'));
    if (fast) return out('finer', 2, t('shots.analysis.dial.sourFast', { time }));
    return out('finer', 1, n.strength === 'weak' ? t('shots.analysis.dial.sourWeak') : t('shots.analysis.dial.sour'));
  }
  if (n.taste === 'bitter') {
    if (n.strength === 'weak') return out('shorter', 1, t('shots.analysis.dial.bitterWeak'));
    if (fast) return out('puck', 1, t('shots.analysis.dial.bitterFast', { time }));
    if (pt === 'sour') return out('coarser', 0, t('shots.analysis.dial.bitterAfterSour'));
    if (pt === 'bitter' || slow) return out('coarser', 2, slow ? t('shots.analysis.dial.bitterSlow', { time }) : t('shots.analysis.dial.bitterAgain'));
    return out('coarser', 1, t('shots.analysis.dial.bitter'));
  }
  if (n.taste === 'balanced') {
    if (n.strength === 'weak') return out('shorter', 1, t('shots.analysis.dial.balancedWeak'));
    if (n.strength === 'strong') return out('longer', 1, t('shots.analysis.dial.balancedStrong'));
    return out('keep', 1, t('shots.analysis.dial.balanced'));
  }
  if (n.strength === 'weak') return out('shorter', 1, t('shots.analysis.dial.weak'));
  if (n.strength === 'strong') return out('longer', 1, t('shots.analysis.dial.strong'));
  // ohne Bewertung: nur die Zeit
  if (fast) return out('finer', 1, t('shots.analysis.dial.fast', { time }));
  if (slow) return out('coarser', 1, t('shots.analysis.dial.slow', { time }));
  return null;
}
