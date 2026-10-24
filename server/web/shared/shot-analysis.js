// Auswertung eines Bezugs: Zielkurve aus den Skript-Schritten, Kennzahlen aus der Kurve und ein Mahlgrad-Tipp.
// Läuft im Browser (Detailansicht) und in den Tests. Kurvenpunkte: [Zeit s, Druck bar, Gewicht g, Menge ml].

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
// Kennzahlen aus der Kurve und den Notizen
export function shotMetrics(shot) {
  const c = (shot?.curve || []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]));
  const yieldG = shot?.notes?.yieldG ?? shot?.weight ?? null;
  const doseG = shot?.notes?.doseG ?? shot?.dose?.g ?? null;
  const firstAt = (pred) => c.find(pred)?.[0] ?? null;
  // Vorbrühen: bis der Druck erstmals 4 bar erreicht; erster Tropfen: ab 1 g auf der Waage
  const preinfusionS = firstAt((p) => p[1] >= 4);
  const firstDropS = firstAt((p) => p[2] >= 1);
  const main = c.filter((p) => p[1] >= 4);
  const avgPressure = main.length ? main.reduce((s, p) => s + p[1], 0) / main.length : null;
  const end = c[c.length - 1];
  const flowStart = firstDropS ?? preinfusionS;
  const avgFlow = end && flowStart !== null && end[0] - flowStart > 2 && end[2] > 0 ? end[2] / (end[0] - flowStart) : null;
  const round = (v, d = 1) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
  return {
    timeS: shot?.timeMs ? round(shot.timeMs / 1000) : null,
    yieldG: round(yieldG),
    doseG: round(doseG),
    ratio: doseG && yieldG ? round(yieldG / doseG) : null,
    preinfusionS: round(preinfusionS),
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
    if (short) return { dir: 'longer', text: 'Sauer und kurzes Verhältnis: etwas mehr Ausbeute laufen lassen oder feiner mahlen.' };
    return { dir: 'finer', text: 'Sauer: feiner mahlen (oder Brühtemperatur leicht erhöhen).' };
  }
  if (taste === 'bitter') {
    if (long) return { dir: 'shorter', text: 'Bitter und langes Verhältnis: früher stoppen oder gröber mahlen.' };
    return { dir: 'coarser', text: 'Bitter: gröber mahlen (oder Brühtemperatur leicht senken).' };
  }
  if (taste === 'balanced') return { dir: 'keep', text: 'Ausgewogen: so lassen und als Referenz merken.' };
  if (fast) return { dir: 'finer', text: `Mit ${m.timeS} s eher schnell: feiner mahlen.` };
  if (slow) return { dir: 'coarser', text: `Mit ${m.timeS} s eher langsam: gröber mahlen.` };
  return null;
}

// --- Einstell-Assistent --------------------------------------------------------------
// Wie der „Coffee Compass“: Geschmack (sauer ↔ bitter) sagt, ob mehr oder weniger extrahiert werden muss (Mahlgrad),
// Stärke (dünn ↔ kräftig) sagt, ob das Verhältnis passt (Ausbeute/Dosis). Dazu die Zeit und der Verlauf der letzten
// bewerteten Bezüge derselben Bohne: zweimal sauer → mutiger feiner; von bitter nach sauer → halber Schritt zurück.
export const STRENGTH = { weak: 'dünn', ok: 'passt', strong: 'kräftig' };

const DIAL_TITLE = {
  finer: ['Etwas feiner', 'Feiner mahlen', 'Deutlich feiner'],
  coarser: ['Etwas gröber', 'Gröber mahlen', 'Deutlich gröber'],
  keep: ['So lassen', 'So lassen', 'So lassen'],
  longer: ['Mehr Ausbeute', 'Mehr Ausbeute', 'Mehr Ausbeute'],
  shorter: ['Weniger Ausbeute', 'Weniger Ausbeute', 'Weniger Ausbeute'],
  puck: ['Puck prüfen', 'Puck prüfen', 'Puck prüfen'],
};

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
  const t = m.timeS !== null ? `${String(m.timeS).replace('.', ',')} s` : '';
  const pt = prev?.notes?.taste;
  const out = (dir, size, text) => ({ dir, size, title: DIAL_TITLE[dir][size], text, anchor, trail });

  if (n.taste === 'sour') {
    if (n.strength === 'strong') return out('longer', 1, 'Sauer, aber kräftig: mehr Ausbeute laufen lassen (Verhältnis etwa +0,3), Mahlgrad lassen.');
    if (slow) return out('puck', 1, `Sauer trotz ${t}: eher ungleichmäßig durchströmt oder zu kühl. Kaffee im Sieb gleichmäßig verteilen, Brühtemperatur 1 °C höher – Mahlgrad erst einmal lassen.`);
    if (pt === 'bitter') return out('finer', 0, 'Vorher bitter, jetzt sauer: der Punkt liegt dazwischen. Einen halben Schritt zurück Richtung feiner.');
    if (pt === 'sour') return out('finer', 2, 'Wieder sauer: diesmal einen größeren Schritt feiner.');
    if (fast) return out('finer', 2, `Sauer und schnell (${t}): deutlich feiner mahlen.`);
    return out('finer', 1, n.strength === 'weak' ? 'Sauer und dünn: feiner mahlen (oder 0,5 g mehr Dosis).' : 'Sauer: feiner mahlen.');
  }
  if (n.taste === 'bitter') {
    if (n.strength === 'weak') return out('shorter', 1, 'Bitter und dünn: früher stoppen (Verhältnis etwa −0,3), Mahlgrad lassen.');
    if (fast) return out('puck', 1, `Bitter trotz schnellem Durchlauf (${t}): Hinweis auf Kanäle im Kaffeebett. Verteilen und gerade tampen statt gröber mahlen.`);
    if (pt === 'sour') return out('coarser', 0, 'Vorher sauer, jetzt bitter: der Punkt liegt dazwischen. Einen halben Schritt zurück Richtung gröber.');
    if (pt === 'bitter' || slow) return out('coarser', 2, slow ? `Bitter und langsam (${t}): deutlich gröber mahlen.` : 'Wieder bitter: diesmal einen größeren Schritt gröber.');
    return out('coarser', 1, 'Bitter: gröber mahlen.');
  }
  if (n.taste === 'balanced') {
    if (n.strength === 'weak') return out('shorter', 1, 'Ausgewogen, aber dünn: weniger Ausbeute oder 0,5–1 g mehr Dosis. Mahlgrad halten.');
    if (n.strength === 'strong') return out('longer', 1, 'Ausgewogen, aber zu kräftig: mehr Ausbeute oder etwas weniger Dosis. Mahlgrad halten.');
    return out('keep', 1, 'Getroffen. Mahlgrad halten und den Bezug als Referenz merken.');
  }
  if (n.strength === 'weak') return out('shorter', 1, 'Dünn: weniger Ausbeute oder mehr Dosis.');
  if (n.strength === 'strong') return out('longer', 1, 'Zu kräftig: mehr Ausbeute oder weniger Dosis.');
  // ohne Bewertung: nur die Zeit
  if (fast) return out('finer', 1, `Mit ${t} eher schnell: feiner mahlen. Wie hat er geschmeckt?`);
  if (slow) return out('coarser', 1, `Mit ${t} eher langsam: gröber mahlen. Wie hat er geschmeckt?`);
  return null;
}
