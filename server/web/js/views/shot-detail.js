// Analyse eines Bezugs: große Kurve mit Vergleich (frühere Bezüge, Referenz, Zielkurve des Skripts),
// Kennzahlen, zugeordneter Mahlvorgang der Mühle, Bewertung mit Notizen und der Einstell-Assistent.
// Dazu die Schnellbewertung direkt nach einem Bezug (Geschmack, Stärke, Mahlgrad → nächster Schritt).
import { h, icon, fmt, fmtInt, snackbar, fullscreen, sheet, switchEl } from '../ui.js';
import { api, hasGrinder } from '../api.js';
import { shotChart } from '../gauge.js';
import { targetCurve, shotMetrics, curveYield, STRENGTH } from '../../shared/shot-analysis.js';
import { TASTE } from '../../shared/machine-core.js';
import { TYPE_DE } from './grinder.js';
import { navigate } from '../app.js';
import { t, locale } from '../../shared/i18n.js';

const ADVICE_ICON = { finer: 'tune', coarser: 'tune', keep: 'check', longer: 'scale', shorter: 'scale', puck: 'warn' };
const TASTE_SHORT = {
  get sour() { return t('shots.tasteShort.sour'); },
  get balanced() { return t('shots.tasteShort.balanced'); },
  get bitter() { return t('shots.tasteShort.bitter'); },
};

// Empfehlung des Assistenten mit Verlauf (Mahlgrad und Geschmack der letzten Bezüge derselben Bohne)
export function adviceNote(a, recipe = null) {
  if (!a) return null;
  const grindDir = a.dir === 'finer' || a.dir === 'coarser';
  const trail = a.trail?.length > 1 ? h('div', { class: 'dial-trail', 'aria-label': t('shots.detail.trailAria') }, a.trail.map((s, i) => [
    i ? h('span', { class: 'arrow', 'aria-hidden': 'true' }, '→') : null,
    h('span', { class: `trail-step ${s.taste || ''}` }, [grindLabel(s.grind), TASTE_SHORT[s.taste], s.timeS ? `${fmt(s.timeS, 0)} s` : null].filter(Boolean).join(' · ') || '–'),
  ])) : null;
  return h('div', { class: `note advice dial ${a.dir}` },
    icon(ADVICE_ICON[a.dir] || 'tune', 's20'),
    h('div', { class: 'grow' },
      h('div', { class: 'dial-title' }, a.title),
      h('div', { class: 'small' }, a.text, grindDir && recipe ? ` ${t('shots.detail.adviceRecipe', { recipe })}` : ''),
      a.anchor && grindDir ? h('div', { class: 'small' }, a.anchor.timeS ? t('shots.detail.anchorTime', { grind: grindLabel(a.anchor.grind), time: fmt(a.anchor.timeS) }) : t('shots.detail.anchor', { grind: grindLabel(a.anchor.grind) })) : null,
      trail));
}

const NEW_BEAN = '__new__';

// „18 g gemahlen (Ziel 18 g) in 9 s“: Ziel und Dauer nur, wenn bekannt
function groundText(g) {
  const p = { g: fmt(g.g), target: g.targetG ? fmt(g.targetG) : null, time: g.durationMs ? fmt(g.durationMs / 1000) : null };
  if (p.target && p.time) return t('shots.detail.groundTargetTime', p);
  if (p.target) return t('shots.detail.groundTarget', p);
  if (p.time) return t('shots.detail.groundTime', p);
  return t('shots.detail.ground', p);
}

export function grindLabel(g) {
  if (g === null || g === undefined || g === '') return '';
  const s = String(g).trim();
  return /^\d{2,5}$/.test(s) ? `${s} µm` : s;
}

export function beanField(beans, value) {
  const list = (beans || []).map((b) => (typeof b === 'string' ? { name: b, roaster: '' } : b)).filter((b) => b.name);
  if (value && !list.some((b) => b.name === value)) list.unshift({ name: value, roaster: '' });
  const nameIn = h('input', { class: 'text', maxlength: 60, placeholder: t('shots.detail.beanPlaceholder'), 'aria-label': t('shots.detail.beanNewAria') });
  const extra = h('div', { class: 'bean-new', hidden: true }, nameIn);
  const sel = h('select', { class: 'text', 'aria-label': t('shots.detail.bean') },
    h('option', { value: '', selected: !value }, t('shots.detail.beanNone')),
    list.map((b) => h('option', { value: b.name, selected: b.name === value }, b.roaster ? `${b.name} · ${b.roaster}` : b.name)),
    h('option', { value: NEW_BEAN }, t('shots.detail.beanNew')));
  sel.addEventListener('change', () => {
    extra.hidden = sel.value !== NEW_BEAN;
    if (sel.value === NEW_BEAN) setTimeout(() => nameIn.focus(), 40);
  });
  return {
    el: h('label', { class: 'field' }, h('span', {}, t('shots.detail.bean')), sel, extra),
    get: () => (sel.value === NEW_BEAN ? nameIn.value.trim() : sel.value.trim()),
  };
}

export function grindField(value, suggest) {
  const mill = hasGrinder();
  const input = h('input', { class: 'text', inputmode: mill ? 'numeric' : 'text', maxlength: 12, value: value || suggest || '', placeholder: suggest || (mill ? '1761' : t('shots.detail.grindPlaceholder')), title: mill ? t('shots.detail.grindTitleMill') : t('shots.detail.grindTitleOwn') });
  return {
    el: h('label', { class: 'field' }, h('span', {}, t('shots.detail.grind')), h('div', { class: 'row' }, input, mill ? h('span', { class: 'unit-tag' }, 'µm') : null)),
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

export function openShot(id, { onChange, host = fullscreen } = {}) {
  const page = Boolean(host.page);
  return host(async (root, close) => {
    root.replaceChildren(head(close, t('shots.detail.title'), null, page), h('div', { class: 'empty' }, h('span', { class: 'spinner' }), ` ${t('shots.common.loading')}`));
    try {
      const d = await api(`/api/shots/${encodeURIComponent(id)}`);
      paint(root, d, close, onChange, page);
    } catch (e) {
      root.replaceChildren(head(close, t('shots.detail.title'), null, page), h('div', { class: 'empty' }, e.message));
    }
  });
}

// Als Unterseite steht der Zurück-Pfeil schon in der Kopfzeile: dann nur Datum und Kurzinfo
function head(close, title, sub = null, page = false) {
  return h('div', { class: 'row detail-head' },
    page ? null : h('button', { class: 'icon-btn', 'aria-label': t('common.back'), onclick: close }, icon('left')),
    h('div', { class: 'grow' }, h('div', { class: 'title' }, title), sub ? h('div', { class: 'small muted' }, sub) : null));
}

// Unterseite „Bezug“ (/bezuege/bezug?id=…): Zurück-Pfeil, Zurück-Taste, Animation und Scrollposition wie überall
export function shotPageView(root) {
  const id = new URLSearchParams(location.search).get('id');
  const host = (build) => build(root, () => navigate('/bezuege', { replace: true }));
  host.page = true;
  openShot(id, { host });
}

function paint(root, d, close, onChange, page = false) {
  let shot = d.shot;
  let advice = d.advice;
  const show = { compare: true, reference: true, target: true };
  const target = targetCurve(shot.script?.steps);
  const when = new Date(shot.endedAt);
  const title = `${when.toLocaleDateString(locale(), { weekday: 'short', day: '2-digit', month: '2-digit' })} · ${when.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}`;
  const sub = [shot.no ? t('shots.row.no', { n: fmtInt(shot.no) }) : null, shot.script?.title ? t('shots.detail.script', { title: shot.script.title }) : null, shot.estimated ? t('shots.detail.estimated') : null].filter(Boolean).join(' · ');

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
      chartBox.replaceChildren(h('p', { class: 'muted small' }, t('shots.detail.noCurve')));
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
    h('span', { class: 'chip static p' }, t('shots.detail.legendPressure')),
    shot.curve?.some((p) => p[2] > 0) ? h('span', { class: 'chip static w' }, t('shots.detail.legendWeight')) : null,
    toggle('target', t('shots.detail.legendTarget'), 'target', Boolean(target)),
    toggle('compare', t('shots.detail.legendCompare', { n: d.compare.length }), 'cmp', d.compare.length > 0),
    toggle('reference', t('shots.detail.legendReference'), 'ref', Boolean(d.reference)));
  drawChart();

  // --- Kennzahlen, Mühle, Tipp ---
  const kpiBox = h('div', { class: 'dash-kpis detail-kpis' });
  const grindBox = h('div', {});
  const adviceBox = h('div', {});
  function paintFacts() {
    const m = shotMetrics(shot);
    const k = (label, v, unit = '') => h('div', { class: 'kpi' }, h('div', { class: 'k' }, label), h('div', { class: 'v' }, v ?? '–', v !== null && v !== undefined && unit ? h('span', { class: 'muted small' }, ` ${unit}`) : null));
    kpiBox.replaceChildren(...[
      k(t('shots.detail.kpiTime'), m.timeS !== null ? fmt(m.timeS) : null, 's'), // ohne Vorbrühen, wie an der Xenia
      k(t('shots.detail.kpiYield'), m.yieldG !== null ? fmt(m.yieldG) : null, 'g'),
      m.doseG !== null ? k(m.doseAssumed ? t('shots.detail.kpiDoseDefault') : t('shots.detail.kpiDose'), fmt(m.doseG), 'g')
        // Ohne Dosis kein Verhältnis: direkt zur Einstellung „Standard-Dosis“
        : h('button', { class: 'kpi kpi-link', type: 'button', onclick: () => navigate('/einstellungen/bezuege') },
          h('div', { class: 'k' }, t('shots.detail.kpiDose')), h('div', { class: 'v' }, '–'), h('div', { class: 'muted small' }, t('shots.detail.setDefaultDose'))),
      k(t('shots.detail.kpiRatio'), m.ratio !== null ? `1:${fmt(m.ratio)}` : null),
      k(t('shots.detail.kpiPreinfusion'), m.preinfusionS !== null ? fmt(m.preinfusionS) : null, 's'),
      m.preinfusionS !== null ? k(t('shots.detail.kpiTotal'), m.totalS !== null ? fmt(m.totalS) : null, 's') : null,
      k(t('shots.detail.kpiFirstDrop'), m.firstDropS !== null ? fmt(m.firstDropS) : null, 's'),
      k(t('shots.detail.kpiAvgPressure'), m.avgPressure !== null ? fmt(m.avgPressure) : null, 'bar'),
      k(t('shots.detail.kpiMaxPressure'), m.maxPressure !== null ? fmt(m.maxPressure) : null, 'bar'),
      k(t('shots.detail.kpiAvgFlow'), m.avgFlow !== null ? fmt(m.avgFlow) : null, 'g/s')].filter(Boolean));
    const g = shot.dose;
    grindBox.replaceChildren(g
      ? h('div', { class: 'row' }, icon('grinder', 's20'),
        h('div', { class: 'grow' },
          h('div', {}, groundText(g)),
          h('div', { class: 'small muted' }, [g.recipe ? t('shots.detail.recipe', { recipe: g.recipe }) : null, TYPE_DE[g.type] || g.type, g.ddd != null ? `${fmtInt(g.ddd)} µm` : null, g.at ? new Date(g.at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) : null].filter(Boolean).join(' · '))),
        g.gbs ? h('span', { class: 'badge ok' }, 'Grind-by-Sync') : null)
      : h('p', { class: 'muted small' }, t('shots.detail.noGrind')));
    adviceBox.replaceChildren(adviceNote(advice, g?.recipe));
  }
  paintFacts();

  // --- Bewertung ---
  const n = { ...(shot.notes || {}) };
  const stars = h('div', { class: 'stars', role: 'radiogroup', 'aria-label': t('shots.detail.ratingAria') });
  const paintStars = () => stars.replaceChildren(...[1, 2, 3, 4, 5].map((i) => h('button', {
    type: 'button', class: `star ${i <= (n.rating || 0) ? 'on' : ''}`, role: 'radio', 'aria-checked': String(n.rating === i), 'aria-label': t('shots.row.stars', { n: i }),
    onclick: () => { n.rating = n.rating === i ? null : i; paintStars(); },
  }, '★')));
  paintStars();
  const taste = choice(TASTE, n.taste, (v) => { n.taste = v; });
  const strength = choice(STRENGTH, n.strength, (v) => { n.strength = v; });
  const bean = beanField(d.beans, n.bean || '');
  const grind = grindField(n.grind || '', d.lastGrind);
  const yieldIn = h('input', { class: 'text', type: 'number', inputmode: 'decimal', step: 0.1, min: 1, max: 399, value: n.yieldG ?? '', placeholder: (curveYield(shot.curve) ?? shot.weight) ? t('shots.detail.measured', { v: fmt(curveYield(shot.curve) ?? shot.weight) }) : t('shots.detail.grams') });
  const twoCups = shot.weight ? h('button', { type: 'button', class: 'btn tonal small-btn', title: t('shots.detail.twoCups'), onclick: () => { yieldIn.value = String(Math.round(shot.weight * 20) / 10); } }, '×2') : null;
  const doseIn = h('input', { class: 'text', type: 'number', inputmode: 'decimal', step: 0.1, min: 1, max: 39, value: n.doseG ?? '', placeholder: shot.dose?.g ? t('shots.detail.fromGrinder', { v: fmt(shot.dose.g) }) : t('shots.detail.grams') });
  const text = h('textarea', { class: 'text', rows: 3, maxlength: 500, placeholder: t('shots.detail.notePlaceholder') }, n.text || '');
  const ref = switchEl({ checked: Boolean(n.reference), label: t('shots.detail.rememberRef'), onChange: (on) => { n.reference = on; } });
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
      snackbar(t('shots.detail.saved'));
      onChange?.();
    } catch (e) {
      snackbar(e.message);
    } finally {
      save.disabled = false;
    }
  } }, icon('check', 's18'), t('common.save'));

  root.replaceChildren(
    head(close, title, sub, page),
    h('div', { class: 'stagger detail' },
      h('section', { class: 'card' }, chartBox, legend),
      kpiBox,
      hasGrinder() ? h('section', { class: 'card' }, h('h3', { class: 'card-head' }, icon('grinder', 's20'), t('shots.detail.grinder')), grindBox) : null,
      adviceBox,
      h('section', { class: 'card' },
        h('h3', { class: 'card-head' }, icon('edit', 's20'), t('shots.detail.rating')),
        stars,
        h('div', { class: 'gap' }),
        h('div', { class: 'field-label small muted' }, t('shots.detail.taste')),
        taste,
        h('div', { class: 'field-label small muted' }, t('shots.detail.strength')),
        strength,
        h('div', { class: 'gap' }),
        h('div', { class: 'grid2 detail-nums' },
          bean.el,
          grind.el),
        h('div', { class: 'grid2 detail-nums' },
          h('label', { class: 'field' }, h('span', {}, t('shots.detail.yieldFix')), h('div', { class: 'row' }, yieldIn, twoCups)),
          h('label', { class: 'field' }, h('span', {}, t('shots.detail.doseG')), doseIn)),
        h('div', { class: 'gap' }),
        h('label', { class: 'field' }, h('span', {}, t('shots.detail.note')), text),
        h('div', { class: 'row toggle-row' }, h('div', { class: 'grow' }, h('div', {}, t('shots.detail.refTitle')), h('div', { class: 'small muted' }, t('shots.detail.refSub'))), ref),
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
  const save = h('button', { class: 'btn filled wide', onclick: submit }, icon('check', 's18'), t('shots.quick.getAdvice'));
  body.append(
    facts ? h('p', { class: 'small muted' }, facts) : null,
    h('div', { class: 'field-label small muted' }, t('shots.detail.taste')),
    choice(TASTE, n.taste, (v) => { n.taste = v; }, 'big-chips'),
    h('div', { class: 'field-label small muted' }, t('shots.detail.strength')),
    choice(STRENGTH, n.strength, (v) => { n.strength = v; }, 'big-chips'),
    h('div', { class: 'grid2 detail-nums' },
      bean.el,
      grind.el),
    h('div', { class: 'gap' }),
    save);
  const close = sheet(t('shots.quick.title'), body);

  async function submit() {
    if (!n.taste && !n.strength) return snackbar(t('shots.quick.pickFirst'));
    save.disabled = true;
    try {
      const r = await api(`/api/shots/${encodeURIComponent(shot.id)}/notes`, { method: 'PUT', body: {
        taste: n.taste ?? null, strength: n.strength ?? null, bean: bean.get() || null, grind: grind.get() || null,
      } });
      onChange?.();
      body.replaceChildren(
        adviceNote(r.advice, shot.dose?.recipe) || h('p', { class: 'muted' }, t('shots.quick.saved')),
        h('div', { class: 'row quick-actions' },
          h('button', { class: 'btn text', onclick: () => { close(); navigate(`/bezuege/bezug?id=${encodeURIComponent(shot.id)}`); } }, t('shots.quick.details')),
          h('span', { class: 'grow' }),
          h('button', { class: 'btn filled', onclick: close }, t('shots.quick.done'))));
    } catch (e) {
      save.disabled = false;
      snackbar(e.message);
    }
  }
}
