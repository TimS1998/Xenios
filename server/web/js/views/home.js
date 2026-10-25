// Startseite: Instrumente, Status, Ein/Aus/Eco/Dampf, Zieltemperatur, laufender/letzter Bezug, Mühle.
import { h, icon, fmt, switchEl, snackbar, ago, promptNumber } from '../ui.js';
import { api, store, subscribe, machineOn } from '../api.js';
import { createGauge, sparkline, ring, liveChart } from '../gauge.js';
import { navigate } from '../app.js';

export function homeView(root) {
  const pressure = createGauge({ title: 'Druck', min: 0, max: 12, majorStep: 2, minorStep: 0.5, redFrom: 11, digits: 1 });
  const temp = createGauge({ title: 'Brühtemperatur', min: 20, max: 110, majorStep: 10, minorStep: 2.5, redFrom: 100, digits: 1, labelEvery: 20 });
  const statusLine = h('div', { class: 'status-line' });
  const offline = h('div', { class: 'offline-banner', hidden: true }, icon('warn', 's20'), h('span', {}));

  // Power-Bereich
  let busy = false;
  const powerRow = (ic, label, key) => {
    const state = h('span', { class: 'trail' });
    const sw = switchEl({ label, onChange: (on, input) => act(key, on, input) });
    const row = h('div', { class: 'list-item' }, h('span', { class: 'lead' }, icon(ic)), h('span', { class: 'grow title' }, label), state, sw);
    row.update = (on, text, disabled) => {
      sw.querySelector('input').checked = on;
      sw.querySelector('input').disabled = disabled;
      state.textContent = text;
    };
    return row;
  };
  const rowMachine = powerRow('power', 'Maschine', 'machine');
  const rowEco = powerRow('eco', 'Eco-Modus', 'eco');
  const rowSteam = powerRow('cloud', 'Dampfkessel', 'steam');

  async function act(key, on, input) {
    if (busy) return;
    busy = true;
    try {
      if (key === 'machine') await api('/api/machine/power', { method: 'POST', body: { mode: on ? 'on' : 'off' } });
      if (key === 'eco') await api('/api/machine/power', { method: 'POST', body: { mode: on ? 'eco' : 'on' } });
      if (key === 'steam') await api('/api/machine/steam', { method: 'POST', body: { on } });
      snackbar(key === 'machine' ? (on ? 'Xenia wird eingeschaltet' : 'Xenia ausgeschaltet') : key === 'eco' ? (on ? 'Eco-Modus an' : 'Eco-Modus aus') : on ? 'Dampfkessel an' : 'Dampfkessel aus');
    } catch (e) {
      input.checked = !on;
      snackbar(e.message);
    } finally {
      busy = false;
    }
  }

  // Zieltemperatur
  let target = null;
  let targetDirty = false;
  const tValue = h('button', { class: 'temp-value', title: 'Wert eingeben', onclick: editTarget }, '–');
  const applyBtn = h('button', { class: 'btn filled wide', disabled: true, onclick: applyTarget }, 'Temperatur übernehmen');
  const colderBtn = h('button', { class: 'icon-btn', 'aria-label': 'Kälter', onclick: () => stepT(-0.5) }, icon('more'));
  const warmerBtn = h('button', { class: 'icon-btn', 'aria-label': 'Wärmer', onclick: () => stepT(0.5) }, icon('less'));
  const stepT = (d) => {
    if (target === null) return;
    target = Math.round(Math.min(96, Math.max(60, target + d)) * 10) / 10;
    targetDirty = true;
    paintTarget();
  };
  const tempCard = h('div', { class: 'card temp-card' },
    h('div', { class: 'temp-caption' }, 'Zieltemperatur Brühgruppe'),
    h('div', { class: 'temp-row' }, colderBtn, tValue, warmerBtn),
    applyBtn);
  function paintTarget() {
    const off = !machineOn();
    tValue.textContent = target === null ? '–' : `${fmt(target)} °C`;
    applyBtn.disabled = !targetDirty || off;
    tValue.disabled = colderBtn.disabled = warmerBtn.disabled = off;
    tempCard.classList.toggle('disabled', off);
  }
  async function editTarget() {
    const n = await promptNumber('Zieltemperatur', { value: target, min: 60, max: 96, step: 0.1, unit: '°C' });
    if (n === null) return;
    if (Number.isNaN(n)) return snackbar('Bitte einen Wert zwischen 60 und 96 °C eingeben');
    target = Math.round(n * 10) / 10;
    targetDirty = true;
    paintTarget();
  }
  async function applyTarget() {
    applyBtn.disabled = true;
    try {
      await api('/api/machine/temperature', { method: 'POST', body: { group: target } });
      targetDirty = false;
      snackbar(`Zieltemperatur ${fmt(target)} °C gespeichert`);
    } catch (e) {
      snackbar(e.message);
      applyBtn.disabled = false;
    }
  }

  // Live-Werte und -Diagramm (wie die Seite „General“ der Original-Oberfläche)
  const liveChartBox = h('div', {});
  const liveValues = h('dl', { class: 'kv' });
  const chips = h('div', { class: 'series-chips' }, SERIES.map((s) => {
    const c = h('button', { class: `chip ${s.cls}`, 'aria-pressed': String(shownSeries.has(s.key)), onclick: () => {
      if (shownSeries.has(s.key)) shownSeries.delete(s.key); else shownSeries.add(s.key);
      c.setAttribute('aria-pressed', String(shownSeries.has(s.key)));
      paintLive();
    } }, s.label);
    return c;
  }));
  const liveCard = h('div', { class: 'card' }, h('h3', {}, 'Live-Werte'), chips, liveChartBox, liveValues);
  function paintLive() {
    liveChartBox.replaceChildren(liveChart(liveHistory, SERIES.filter((s) => shownSeries.has(s.key))));
    const m = store.machine;
    if (!m) return;
    const row = (k, v) => [h('dt', {}, k), h('dd', {}, v)];
    liveValues.replaceChildren(
      ...row('Brühgruppe', `${fmt(m.temp.group)} °C (Ziel ${fmt(m.temp.groupSet)})`),
      ...row('Brühkessel', `${fmt(m.temp.boiler)} °C (Ziel ${fmt(m.temp.boilerSet)})`),
      ...row('Pumpendruck', `${fmt(m.pressure.pump)} bar`),
      ...row('Dampfkessel', m.steamOn ? `${fmt(m.pressure.steam, 2)} bar (Ziel ${fmt(m.pressure.steamSet)})` : `aus (Ziel ${fmt(m.pressure.steamSet)} bar)`),
      ...row('Heizleistung Gruppe / Kessel', `${fmt(m.power.group, 0)} % / ${fmt(m.power.boiler, 0)} %`),
      ...row('Pumpenleistung', `${fmt(m.power.pump, 0)} %`),
      ...row('Waage', `${fmt(m.scale.weight)} g · ${fmt(m.scale.rate)} g/s`),
      ...row('Durchfluss', `${fmt(m.flow.ml ?? m.flow.volume, 0)} ml · ${fmt(m.flow.rate)} ml/s`),
      ...row('Wassertank', m.tankOk === false ? 'leer' : m.tankOk ? 'ok' : '–'));
  }

  // Bezug
  const shotCard = h('div', { class: 'card', hidden: true });
  const lastShotCard = h('div', { class: 'card low', hidden: true });
  const millTitle = h('div', { class: 'section-title', hidden: true }, 'Mühle');
  const grinderCard = h('div', { class: 'list-item clickable', onclick: () => navigate('/muehle'), hidden: true });

  root.append(
    offline,
    h('div', { class: 'gauges' }, pressure, temp),
    statusLine,
    shotCard,
    h('div', { class: 'section-title' }, 'Power'),
    h('div', { class: 'list' }, rowMachine, rowEco, rowSteam),
    h('div', { class: 'section-title' }, 'Temperatur'),
    tempCard,
    lastShotCard,
    h('div', { class: 'section-title' }, 'Sensoren'),
    liveCard,
    millTitle,
    grinderCard,
  );

  function update() {
    const m = store.machine;
    if (!m) return;
    offline.hidden = m.online;
    offline.lastChild.textContent = m.online ? '' : `Maschine nicht erreichbar${m.error ? ` (${m.error})` : ''}. Letzter Kontakt: ${ago(m.lastSeen)}`;
    pressure.update(m.pressure.pump, m.steamOn ? `Dampf ${fmt(m.pressure.steam, 1)} bar` : 'Dampfkessel aus');
    temp.update(m.temp.group, `Kessel ${fmt(m.temp.boiler, 1)}`);

    const on = ['on', 'brewing', 'draining', 'paddle'].includes(m.statusKey);
    const eco = m.statusKey === 'eco';
    const dis = !m.online || m.statusKey === 'brewing';
    rowMachine.update(on || eco, on ? 'AN' : eco ? 'ECO' : 'AUS', dis);
    rowEco.update(eco, eco ? 'AN' : 'AUS', dis || m.statusKey === 'off');
    rowSteam.update(m.steamOn, m.steamOn ? (m.steamReady ? 'BEREIT' : 'HEIZT') : 'AUS', !m.online || !(on || eco));

    let badge;
    if (!m.online) badge = h('span', { class: 'badge bad' }, 'Offline');
    else if (m.statusKey === 'off') badge = h('span', { class: 'badge' }, 'Aus');
    else if (m.statusKey === 'eco') badge = h('span', { class: 'badge' }, 'Eco');
    else if (m.statusKey === 'brewing') badge = h('span', { class: 'badge ok' }, 'Bezug läuft');
    else if (m.statusKey === 'fault') badge = h('span', { class: 'badge bad' }, 'Störung');
    else if (m.heated) badge = h('span', { class: 'badge ok' }, 'Bereit');
    else badge = h('span', { class: 'badge warn' }, 'Heizt auf');
    const extra = [];
    if (m.tankOk === false) extra.push(h('span', { class: 'badge bad' }, 'Tank leer'));
    if (m.statusKey !== 'off' && m.temp.groupSet) extra.push(h('span', { class: 'muted small' }, `Ziel ${fmt(m.temp.groupSet)} °C`));
    statusLine.replaceChildren(badge, ...extra);

    if (!targetDirty && m.temp.groupSet !== null) target = m.temp.groupSet;
    paintTarget();

    // laufender Bezug
    if (m.shot.running) {
      shotCard.hidden = false;
      const secs = (m.shot.timeMs || 0) / 1000;
      shotCard.replaceChildren(
        h('div', { class: 'shot-card' },
          ring(secs / 30, `${fmt(secs, 0)} s`),
          h('div', { class: 'kpis' },
            kpi('Druck', `${fmt(m.pressure.pump)}`, 'bar'),
            kpi('Gewicht', `${fmt(m.scale.weight)}`, 'g'),
            kpi('Fluss', `${fmt(m.scale.rate || m.flow.rate)}`, 'g/s'))),
        sparkline(m.shot.curve),
        h('button', { class: 'btn danger wide', onclick: stopScript }, icon('stop', 's18'), 'Bezug stoppen'));
    } else shotCard.hidden = true;

    const ls = m.lastShot;
    if (ls && !m.shot.running) {
      lastShotCard.hidden = false;
      lastShotCard.replaceChildren(
        h('div', { class: 'row between' }, h('h3', {}, 'Letzter Bezug'), h('span', { class: 'muted small' }, ago(ls.endedAt), ls.estimated ? ' · nachträglich' : '')),
        h('div', { class: 'kpis' }, kpi('Zeit', fmt(ls.timeMs / 1000), 's'), kpi('Gewicht', ls.weight ? fmt(ls.weight) : ls.volumeMl ? fmt(ls.volumeMl, 0) : '–', ls.weight ? 'g' : 'ml'), kpi('Max. Druck', fmt(ls.maxPressure), 'bar')),
        ls.curve?.length ? sparkline(ls.curve) : null,
        h('button', { class: 'btn text', onclick: () => navigate('/bezuege') }, icon('history', 's18'), 'Alle Bezüge'));
    } else lastShotCard.hidden = true;
  }

  function updateGrinder() {
    const g = store.grinder;
    if (!g || !g.enabled) {
      millTitle.hidden = true;
      grinderCard.hidden = true;
      return;
    }
    millTitle.hidden = false;
    grinderCard.hidden = false;
    const last = g.stats?.lastGrind;
    const recipe = g.recipes?.find((r) => r.selected);
    grinderCard.replaceChildren(
      h('span', { class: 'lead' }, icon('grinder')),
      h('div', { class: 'grow' },
        h('div', { class: 'title' }, g.info?.typeName || 'Mühle', ' ', g.online ? '' : h('span', { class: 'badge bad' }, 'offline')),
        h('div', { class: 'sub' }, last ? `Zuletzt ${fmt(last.weightG)} g in ${fmt(last.durationMs / 1000)} s · ${ago(last.at)}` : 'Noch keine Daten',
          recipe ? ` · Rezept ${recipe.index}` : '')),
      h('span', { class: 'trail' }, g.stats ? `${g.stats.today} heute` : ''),
      icon('right'));
  }

  async function stopScript() {
    try {
      const r = await api('/api/machine/scripts/stop', { method: 'POST' });
      snackbar(r.stopped ? 'Bezug gestoppt' : 'Kein Skript aktiv');
    } catch (e) {
      snackbar(e.message);
    }
  }

  update();
  updateGrinder();
  paintLive();
  const un = subscribe((part) => {
    if (part === 'machine' || part === 'all' || part === 'conn') {
      update();
      paintLive();
    }
    if (part === 'grinder' || part === 'all') updateGrinder();
  });
  return () => un();
}

// Verlauf der letzten Minuten; sammelt auch, während andere Seiten offen sind.
export const SERIES = [
  { key: 'bg', label: 'Brühgruppe', axis: 'temp', cls: 'bg' },
  { key: 'bb', label: 'Brühkessel', axis: 'temp', cls: 'bb' },
  { key: 'pu', label: 'Pumpendruck', axis: 'bar', cls: 'pu' },
  { key: 'sb', label: 'Dampfdruck', axis: 'bar', cls: 'sb' },
];
const shownSeries = new Set(['bg', 'pu', 'sb']);
export const liveHistory = [];
subscribe((part) => {
  if (part !== 'machine' && part !== 'all') return;
  const m = store.machine;
  if (!m?.online) return;
  const t = Date.now();
  if (liveHistory.length && t - liveHistory[liveHistory.length - 1].t < 900) return;
  liveHistory.push({ t, bg: m.temp.group, bb: m.temp.boiler, pu: m.pressure.pump, sb: m.pressure.steam });
  while (liveHistory.length && t - liveHistory[0].t > 10 * 60e3) liveHistory.shift();
});

function kpi(k, v, unit) {
  return h('div', { class: 'kpi' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v, unit ? h('span', { class: 'muted small' }, ' ' + unit) : null));
}
