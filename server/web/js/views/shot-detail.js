// Analyse eines Bezugs: große Kurve mit Vergleich (frühere Bezüge, Referenz, Zielkurve des Skripts),
// Kennzahlen, zugeordneter Mahlvorgang der Mühle, Bewertung mit Notizen und der Einstell-Assistent.
// Dazu die Schnellbewertung direkt nach einem Bezug (Geschmack, Stärke, Mahlgrad → nächster Schritt).
import { h, icon, fmt, fmtInt, snackbar, fullscreen, sheet, switchEl } from '../ui.js';
import { api, hasGrinder } from '../api.js';
import { shotChart } from '../gauge.js';
import { targetCurve, shotMetrics, STRENGTH } from '../../shared/shot-analysis.js';
import { TASTE } from '../../shared/machine-core.js';
import { TYPE_DE } from './grinder.js';

const ADVICE_ICON = { finer: 'tune', coarser: 'tune', keep: 'check', longer: 'scale', shorter: 'scale', puck: 'warn' };
const TASTE_SHORT = { sour: 'sauer', balanced: 'ausgewogen', bitter: 'bitter' };

// Empfehlung des Assistenten mit Verlauf (Mahlgrad und Geschmack der letzten Bezüge derselben Bohne)
export function adviceNote(a, recipe = null) {
  if (!a) return null;
  const grindDir = a.dir === 'finer' || a.dir === 'coarser';
  const trail = a.trail?.length > 1 ? h('div', { class: 'dial-trail', 'aria-label': 'Verlauf' }, a.trail.map((t, i) => [
    i ? h('span', { class: 'arrow', 'aria-hidden': 'true' }, '→') : null,
    h('span', { class: `trail-step ${t.taste || ''}` }, [grindLabel(t.grind), TASTE_SHORT[t.taste], t.timeS ? `${fmt(t.timeS, 0)} s` : null].filter(Boolean).join(' · ') || '–'),
  ])) : null;
  return h('div', { class: `note advice dial ${a.dir}` },
    icon(ADVICE_ICON[a.dir] || 'tune', 's20'),
    h('div', { class: 'grow' },
      h('div', { class: 'dial-title' }, a.title),
      h('div', { class: 'small' }, a.text, grindDir && recipe ? ` (Rezept ${recipe} an der Mühle)` : ''),
      a.anchor && grindDir ? h('div', { class: 'small' }, `Zuletzt getroffen bei ${grindLabel(a.anchor.grind)}${a.anchor.timeS ? ` in ${fmt(a.anchor.timeS)} s` : ''}.`) : null,
      trail));
}

const NEW_BEAN = '__new__';

export function grindLabel(g) {
  if (g === null || g === undefined || g === '') return '';
  const s = String(g).trim();
  return /^\d{2,5}$/.test(s) ? `${s} µm` : s;
}

export function beanField(beans, value) {
  const list = (beans || []).map((b) => (typeof b === 'string' ? { name: b, roaster: '' } : b)).filter((b) => b.name);
  if (value && !list.some((b) => b.name === value)) list.unshift({ name: value, roaster: '' });
  const nameIn = h('input', { class: 'text', maxlength: 60, placeholder: 'Name der Bohne', 'aria-label': 'Neue Bohne' });
  const extra = h('div', { class: 'bean-new', hidden: true }, nameIn);
  const sel = h('select', { class: 'text', 'aria-label': 'Bohne' },
    h('option', { value: '', selected: !value }, 'Keine'),
    list.map((b) => h('option', { value: b.name, selected: b.name === value }, b.roaster ? `${b.name} · ${b.roaster}` : b.name)),
    h('option', { value: NEW_BEAN }, 'Neue Bohne …'));
  sel.addEventListener('change', () => {
    extra.hidden = sel.value !== NEW_BEAN;
    if (sel.value === NEW_BEAN) setTimeout(() => nameIn.focus(), 40);
  });
  return {
    el: h('label', { class: 'field' }, h('span', {}, 'Bohne'), sel, extra),
    get: () => (sel.value === NEW_BEAN ? nameIn.value.trim() : sel.value.trim()),
  };
}

export function grindField(value, suggest) {
  const mill = hasGrinder();
  const input = h('input', { class: 'text', inputmode: mill ? 'numeric' : 'text', maxlength: 12, value: value || suggest || '', placeholder: suggest || (mill ? '1761' : 'z. B. 2,5'), title: mill ? 'Scheibenabstand wie auf der E64 WS' : 'Mahlgrad der eigenen Mühle' });
  return {
    el: h('label', { class: 'field' }, h('span', {}, 'Mahlgrad'), h('div', { class: 'row' }, input, mill ? h('span', { class: 'unit-tag' }, 'µm') : null)),
    get: () => input.value.trim(),
  };
}

// Auswahl als Chips (eine Option oder keine)
function choice(options, value, onPick, cls = '') {
  const box = h('div', { class: `chips ${cls}`, role: 'radiogroup' });
  const paint = (v) => [...box.children].forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.key === v)));
  box.append(...Object.entries(options).map(([k, label]) => h('button', { type: 'button', class: 'chip', dataset: { key: k }, 'aria-pressed': String(value === k),
    onclick: () => { value = value === k ? null : k; paint(value); onPick(value); } }, label)));
  return box;
}

export function openShot(id, { onChange } = {}) {
  return fullscreen(async (root, close) => {
    root.replaceChildren(head(close, 'Bezug'), h('div', { class: 'empty' }, h('span', { class: 'spinner' }), ' Lade …'));
    try {
      const d = await api(`/api/shots/${encodeURIComponent(id)}`);
      paint(root, d, close, onChange);
    } catch (e) {
      root.replaceChildren(head(close, 'Bezug'), h('div', { class: 'empty' }, e.message));
    }
  });
}

function head(close, title, sub = null) {
  return h('div', { class: 'row detail-head' },
    h('button', { class: 'icon-btn', 'aria-label': 'Zurück', onclick: close }, icon('left')),
    h('div', { class: 'grow' }, h('div', { class: 'title' }, title), sub ? h('div', { class: 'small muted' }, sub) : null));
}

function paint(root, d, close, onChange) {
  let shot = d.shot;
  let advice = d.advice;
  const show = { compare: true, reference: true, target: true };
  const target = targetCurve(shot.script?.steps);
  const when = new Date(shot.endedAt);
  const title = `${when.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })} · ${when.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
  const sub = [shot.no ? `Nr. ${fmtInt(shot.no)}` : null, shot.script?.title ? `Skript „${shot.script.title}“` : null, shot.estimated ? 'nachträglich erkannt' : null].filter(Boolean).join(' · ');

  // --- Kurve mit Vergleich ---
  const chartBox = h('div', { class: 'chart-box' });
  const legend = h('div', { class: 'chips legend-chips' });
  const toggle = (key, label, cls, available) => (available ? h('button', { class: `chip ${cls}`, 'aria-pressed': String(show[key]), onclick: (e) => {
    show[key] = !show[key];
    e.currentTarget.setAttribute('aria-pressed', String(show[key]));
    drawChart();
  } }, label) : null);
  function drawChart() {
    if (!(shot.curve?.length > 1)) {
      chartBox.replaceChildren(h('p', { class: 'muted small' }, 'Keine Kurve: Der Bezug wurde nachträglich über den Bezugszähler erkannt.'));
      return;
    }
    chartBox.replaceChildren(shotChart(shot.curve, {
      width: 640, height: 260, minSeconds: 20,
      compare: show.compare ? d.compare.map((s) => s.curve) : [],
      reference: show.reference && d.reference ? d.reference.curve : null,
      target: show.target ? target : null,
    }));
  }
  legend.replaceChildren(
    h('span', { class: 'chip static p' }, 'Druck'),
    shot.curve?.some((p) => p[2] > 0) ? h('span', { class: 'chip static w' }, 'Gewicht') : null,
    toggle('target', 'Ziel (Skript)', 'target', Boolean(target)),
    toggle('compare', `Frühere (${d.compare.length})`, 'cmp', d.compare.length > 0),
    toggle('reference', 'Referenz', 'ref', Boolean(d.reference)));
  drawChart();

  // --- Kennzahlen, Mühle, Tipp ---
  const kpiBox = h('div', { class: 'dash-kpis detail-kpis' });
  const grindBox = h('div', {});
  const adviceBox = h('div', {});
  function paintFacts() {
    const m = shotMetrics(shot);
    const k = (label, v, unit = '') => h('div', { class: 'kpi' }, h('div', { class: 'k' }, label), h('div', { class: 'v' }, v ?? '–', v !== null && v !== undefined && unit ? h('span', { class: 'muted small' }, ` ${unit}`) : null));
    kpiBox.replaceChildren(
      k('Zeit', m.timeS !== null ? fmt(m.timeS) : null, 's'),
      k('Ausbeute', m.yieldG !== null ? fmt(m.yieldG) : null, 'g'),
      k('Dosis', m.doseG !== null ? fmt(m.doseG) : null, 'g'),
      k('Verhältnis', m.ratio !== null ? `1:${fmt(m.ratio)}` : null),
      k('Vorbrühen', m.preinfusionS !== null ? fmt(m.preinfusionS) : null, 's'),
      k('Erster Tropfen', m.firstDropS !== null ? fmt(m.firstDropS) : null, 's'),
      k('Ø Druck', m.avgPressure !== null ? fmt(m.avgPressure) : null, 'bar'),
      k('Max. Druck', m.maxPressure !== null ? fmt(m.maxPressure) : null, 'bar'),
      k('Ø Fluss', m.avgFlow !== null ? fmt(m.avgFlow) : null, 'g/s'));
    const g = shot.dose;
    grindBox.replaceChildren(g
      ? h('div', { class: 'row' }, icon('grinder', 's20'),
        h('div', { class: 'grow' },
          h('div', {}, `${fmt(g.g)} g gemahlen${g.targetG ? ` (Ziel ${fmt(g.targetG)} g)` : ''}${g.durationMs ? ` in ${fmt(g.durationMs / 1000)} s` : ''}`),
          h('div', { class: 'small muted' }, [g.recipe ? `Rezept ${g.recipe}` : null, TYPE_DE[g.type] || g.type, g.ddd != null ? `${fmtInt(g.ddd)} µm` : null, g.at ? new Date(g.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : null].filter(Boolean).join(' · '))),
        g.gbs ? h('span', { class: 'badge ok' }, 'Grind-by-Sync') : null)
      : h('p', { class: 'muted small' }, 'Kein Mahlvorgang der Mühle zugeordnet (bis 20 min vor dem Bezug). Die Dosis lässt sich unten eintragen.'));
    adviceBox.replaceChildren(adviceNote(advice, g?.recipe));
  }
  paintFacts();

  // --- Bewertung ---
  const n = { ...(shot.notes || {}) };
  const stars = h('div', { class: 'stars', role: 'radiogroup', 'aria-label': 'Bewertung' });
  const paintStars = () => stars.replaceChildren(...[1, 2, 3, 4, 5].map((i) => h('button', {
    type: 'button', class: `star ${i <= (n.rating || 0) ? 'on' : ''}`, role: 'radio', 'aria-checked': String(n.rating === i), 'aria-label': `${i} Sterne`,
    onclick: () => { n.rating = n.rating === i ? null : i; paintStars(); },
  }, '★')));
  paintStars();
  const taste = choice(TASTE, n.taste, (v) => { n.taste = v; });
  const strength = choice(STRENGTH, n.strength, (v) => { n.strength = v; });
  const bean = beanField(d.beans, n.bean || '');
  const grind = grindField(n.grind || '', d.lastGrind);
  const yieldIn = h('input', { class: 'text', type: 'number', inputmode: 'decimal', step: 0.1, min: 1, max: 399, value: n.yieldG ?? '', placeholder: shot.weight ? `gemessen ${fmt(shot.weight)}` : 'Gramm' });
  const twoCups = shot.weight ? h('button', { type: 'button', class: 'btn tonal small-btn', title: 'Zwei Tassen, nur eine stand auf der Waage', onclick: () => { yieldIn.value = String(Math.round(shot.weight * 20) / 10); } }, '×2') : null;
  const doseIn = h('input', { class: 'text', type: 'number', inputmode: 'decimal', step: 0.1, min: 1, max: 39, value: n.doseG ?? '', placeholder: shot.dose?.g ? `Mühle ${fmt(shot.dose.g)}` : 'Gramm' });
  const text = h('textarea', { class: 'text', rows: 3, maxlength: 500, placeholder: 'Notiz (Bohne, Mahlgrad, Eindruck …)' }, n.text || '');
  const ref = switchEl({ checked: Boolean(n.reference), label: 'Als Referenz merken', onChange: (on) => { n.reference = on; } });
  const save = h('button', { class: 'btn filled wide', onclick: async () => {
    save.disabled = true;
    try {
      const r = await api(`/api/shots/${encodeURIComponent(shot.id)}/notes`, { method: 'PUT', body: {
        rating: n.rating ?? null, taste: n.taste ?? null, strength: n.strength ?? null, bean: bean.get() || null, grind: grind.get() || null,
        text: text.value.trim() || null, yieldG: yieldIn.value === '' ? null : Number(yieldIn.value), doseG: doseIn.value === '' ? null : Number(doseIn.value),
        reference: Boolean(n.reference),
      } });
      shot = r.shot;
      advice = r.advice;
      paintFacts();
      snackbar('Bewertung gespeichert');
      onChange?.();
    } catch (e) {
      snackbar(e.message);
    } finally {
      save.disabled = false;
    }
  } }, icon('check', 's18'), 'Speichern');

  root.replaceChildren(
    head(close, title, sub),
    h('div', { class: 'stagger detail' },
      h('section', { class: 'card' }, chartBox, legend),
      kpiBox,
      hasGrinder() ? h('section', { class: 'card' }, h('h3', { class: 'card-head' }, icon('grinder', 's20'), 'Mühle'), grindBox) : null,
      adviceBox,
      h('section', { class: 'card' },
        h('h3', { class: 'card-head' }, icon('edit', 's20'), 'Bewertung'),
        stars,
        h('div', { class: 'gap' }),
        h('div', { class: 'field-label small muted' }, 'Geschmack'),
        taste,
        h('div', { class: 'field-label small muted' }, 'Stärke'),
        strength,
        h('div', { class: 'gap' }),
        h('div', { class: 'grid2 detail-nums' },
          bean.el,
          grind.el),
        h('div', { class: 'grid2 detail-nums' },
          h('label', { class: 'field' }, h('span', {}, 'Ausbeute korrigieren (g)'), h('div', { class: 'row' }, yieldIn, twoCups)),
          h('label', { class: 'field' }, h('span', {}, 'Dosis (g)'), doseIn)),
        h('div', { class: 'gap' }),
        h('label', { class: 'field' }, h('span', {}, 'Notiz'), text),
        h('div', { class: 'row toggle-row' }, h('div', { class: 'grow' }, h('div', {}, 'Referenz-Bezug'), h('div', { class: 'small muted' }, 'Erscheint bei späteren Bezügen als Vergleichskurve')), ref),
        save)));
}

// Schnellbewertung direkt nach dem Bezug: Geschmack, Stärke, Bohne, Mahlgrad → Empfehlung für den nächsten Bezug.
// Bohne und Mahlgrad werden vom letzten Bezug übernommen (meist unverändert).
export async function quickRate(id, { taste = null, onChange } = {}) {
  let d;
  try {
    d = await api(`/api/shots/${encodeURIComponent(id)}`);
  } catch (e) {
    return snackbar(e.message);
  }
  const shot = d.shot;
  const n = { ...(shot.notes || {}) };
  if (taste) n.taste = taste;
  const m = shotMetrics(shot);
  const facts = [m.timeS !== null ? `${fmt(m.timeS)} s` : null, m.yieldG !== null ? `${fmt(m.yieldG)} g` : null, m.ratio !== null ? `1:${fmt(m.ratio)}` : null, shot.script?.title || null].filter(Boolean).join(' · ');
  const bean = beanField(d.beans, n.bean || d.beans[0]?.name || '');
  const grind = grindField(n.grind || '', d.lastGrind);
  const body = h('div', { class: 'quick-rate' });
  const save = h('button', { class: 'btn filled wide', onclick: submit }, icon('check', 's18'), 'Empfehlung holen');
  body.append(
    facts ? h('p', { class: 'small muted' }, facts) : null,
    h('div', { class: 'field-label small muted' }, 'Geschmack'),
    choice(TASTE, n.taste, (v) => { n.taste = v; }, 'big-chips'),
    h('div', { class: 'field-label small muted' }, 'Stärke'),
    choice(STRENGTH, n.strength, (v) => { n.strength = v; }, 'big-chips'),
    h('div', { class: 'grid2 detail-nums' },
      bean.el,
      grind.el),
    h('div', { class: 'gap' }),
    save);
  const close = sheet('Wie war der Bezug?', body);

  async function submit() {
    if (!n.taste && !n.strength) return snackbar('Erst Geschmack oder Stärke wählen');
    save.disabled = true;
    try {
      const r = await api(`/api/shots/${encodeURIComponent(shot.id)}/notes`, { method: 'PUT', body: {
        taste: n.taste ?? null, strength: n.strength ?? null, bean: bean.get() || null, grind: grind.get() || null,
      } });
      onChange?.();
      body.replaceChildren(
        adviceNote(r.advice, shot.dose?.recipe) || h('p', { class: 'muted' }, 'Gespeichert.'),
        h('div', { class: 'row quick-actions' },
          h('button', { class: 'btn text', onclick: () => { close(); openShot(shot.id, { onChange }); } }, 'Details'),
          h('span', { class: 'grow' }),
          h('button', { class: 'btn filled', onclick: close }, 'Fertig')));
    } catch (e) {
      save.disabled = false;
      snackbar(e.message);
    }
  }
}
