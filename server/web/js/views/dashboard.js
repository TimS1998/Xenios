// Dashboard: anpassbare Übersicht nur zum Ansehen (Handy, Tablet hochkant und quer). Bedient nichts an den Geräten.
// Auswahl, Reihenfolge und Breite der Kacheln speichert jedes Gerät für sich (localStorage).
import { h, icon, fmt, fmtInt, ago, sheet, switchEl } from '../ui.js';
import { api, store, subscribe } from '../api.js';
import { createGauge, ring, shotChart, barChart, targetBar, liveChart } from '../gauge.js';
import { navigate, setTopActions, localStorageGet, localStorageSet } from '../app.js';
import { liveHistory, SERIES } from './home.js';
import { TYPE_DE, TRIGGER_DE } from './grinder.js';
import { ALERT_TEXT } from '../../shared/grinder-core.js';

const TILES = {
  shot: { title: 'Live-Bezug', icon: 'coffee', wide: true, note: 'Erscheint nur während eines Bezugs, dann ganz oben', build: shotTile },
  status: { title: 'Status', icon: 'power', wide: false, build: statusTile },
  gauges: { title: 'Instrumente', icon: 'thermo', wide: true, build: gaugesTile },
  lastShot: { title: 'Letzter Bezug', icon: 'coffee', wide: false, build: lastShotTile, link: '/bezuege' },
  lastGrind: { title: 'Letzter Mahlvorgang', icon: 'grinder', wide: false, build: lastGrindTile, link: '/muehle' },
  week: { title: 'Bezüge pro Tag', icon: 'event', wide: false, build: weekTile, link: '/bezuege' },
  shotTimes: { title: 'Bezugszeiten', icon: 'timer', wide: false, build: shotTimesTile, link: '/bezuege' },
  grinds: { title: 'Mahlgewichte', icon: 'scale', wide: false, build: grindsTile, link: '/muehle' },
  grinder: { title: 'Mühle heute', icon: 'grinder', wide: false, build: grinderTile, link: '/muehle' },
  live: { title: 'Verlauf (10 min)', icon: 'history', wide: true, build: liveTile },
};
const KEY = 'dashboard';
const FINISHED_MS = 20e3;   // so lange bleibt der Live-Bezug nach dem Ende stehen

function loadLayout() {
  let saved = null;
  try { saved = JSON.parse(localStorageGet(KEY) || 'null'); } catch { /* kaputt → Standard */ }
  const tiles = (Array.isArray(saved?.tiles) ? saved.tiles : []).filter((t) => TILES[t?.id]).map((t) => ({ id: t.id, on: t.on !== false, wide: Boolean(t.wide) }));
  for (const id of Object.keys(TILES)) if (!tiles.some((t) => t.id === id)) tiles.push({ id, on: true, wide: TILES[id].wide });
  return { tiles, keepAwake: Boolean(saved?.keepAwake) };
}
const saveLayout = (l) => localStorageSet(KEY, JSON.stringify(l));

export function dashboardView(root) {
  let layout = loadLayout();
  let shots = [];
  let built = [];
  const grid = h('div', { class: 'dash stagger' });
  root.append(grid);
  setTopActions(h('button', { class: 'icon-btn', 'aria-label': 'Dashboard anpassen', title: 'Dashboard anpassen', onclick: customize }, icon('tune')));

  function build() {
    built = layout.tiles.filter((t) => t.on).map((t) => {
      const def = TILES[t.id];
      const t0 = def.build({ wide: t.wide });
      const extra = h('span', { class: 'extra' });
      const open = def.link ? () => navigate(def.link) : null;
      const el = h('section', {
        class: `tile${t.wide ? ' wide' : ''}${def.link ? ' clickable' : ''} t-${t.id}`,
        role: def.link ? 'link' : null,
        tabindex: def.link ? '0' : null,
        'aria-label': def.title,
        onclick: open,
        onkeydown: open ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } : null,
      },
        h('header', { class: 'tile-head' }, icon(def.icon), h('span', {}, def.title), extra), t0.body);
      return { id: t.id, el, extra, update: t0.update };
    });
    grid.replaceChildren(built.length ? built.map((b) => b.el) : h('div', { class: 'empty' }, 'Keine Kachel ausgewählt. Oben rechts lässt sich das Dashboard anpassen.'));
    update();
  }

  function update() {
    const ctx = { m: store.machine, g: store.grinder?.enabled ? store.grinder : null, shots };
    for (const b of built) {
      try {
        const r = b.update(ctx) || {};
        b.el.hidden = r.hidden === true;
        b.extra.replaceChildren(r.extra ?? '');
      } catch (e) { console.error(b.id, e); }
    }
  }

  async function loadShots() {
    try { shots = (await api('/api/shots')).shots || []; } catch { /* nächster Versuch beim nächsten Bezug */ }
    update();
  }

  // Bildschirm anlassen (Tablet an der Wand): in der Android-App über die Brücke, im Browser per Wake Lock
  let wake = null;
  let disposed = false;
  async function setAwake(on) {
    if (on && disposed) return;
    if (typeof window.XeniaApp?.keepScreenOn === 'function') return window.XeniaApp.keepScreenOn(on);
    if (!navigator.wakeLock) return;
    if (on && !wake && document.visibilityState === 'visible') {
      const lock = await navigator.wakeLock.request('screen').catch(() => null);
      if (!lock) return;
      // Seite inzwischen verlassen oder ausgeschaltet: Sperre gleich wieder freigeben
      if (disposed || !layout.keepAwake || wake) return lock.release().catch(() => {});
      wake = lock;
      wake.addEventListener('release', () => { if (wake === lock) wake = null; });
    } else if (!on && wake) {
      wake.release().catch(() => {});
      wake = null;
    }
  }
  const onVisible = () => { if (layout.keepAwake && document.visibilityState === 'visible') setAwake(true); };
  document.addEventListener('visibilitychange', onVisible);

  function customize() {
    const list = h('div', { class: 'list dash-cfg' });
    const paint = () => list.replaceChildren(layout.tiles.map((t, i) => {
      const def = TILES[t.id];
      const move = (d) => {
        const j = i + d;
        if (j < 0 || j >= layout.tiles.length) return;
        [layout.tiles[i], layout.tiles[j]] = [layout.tiles[j], layout.tiles[i]];
        changed();
      };
      return h('div', { class: 'list-item dash-cfg-row' },
        switchEl({ checked: t.on, label: def.title, onChange: (on) => { t.on = on; changed(); } }),
        h('div', { class: 'grow' }, h('div', { class: 'title' }, def.title), def.note ? h('div', { class: 'sub' }, def.note) : null),
        t.id === 'shot' ? null : [
          h('button', { class: 'chip', 'aria-pressed': String(t.wide), title: 'Über die ganze Breite', onclick: () => { t.wide = !t.wide; changed(); } }, 'Breit'),
          h('button', { class: 'icon-btn', 'aria-label': `${def.title} nach oben`, disabled: i === 0, onclick: () => move(-1) }, icon('less')),
          h('button', { class: 'icon-btn', 'aria-label': `${def.title} nach unten`, disabled: i === layout.tiles.length - 1, onclick: () => move(1) }, icon('more'))]);
    }));
    const changed = () => {
      saveLayout(layout);
      paint();
      if (!disposed) build();
    };
    paint();
    const startHere = localStorageGet('startPage') === '/dashboard';
    // Wake Lock gibt es im Browser nur über HTTPS (bzw. localhost); in der Android-App immer
    const canWake = typeof window.XeniaApp?.keepScreenOn === 'function' || ('wakeLock' in navigator && window.isSecureContext);
    sheet('Dashboard anpassen', h('div', {},
      h('p', { class: 'muted small' }, 'Nur zum Ansehen: Im Dashboard lässt sich an Maschine und Mühle nichts verstellen. Die Auswahl gilt für dieses Gerät.'),
      list,
      h('div', { class: 'section-title' }, 'Dieses Gerät'),
      h('div', { class: 'list' },
        h('div', { class: 'list-item' }, h('span', { class: 'lead' }, icon('dashboard')), h('div', { class: 'grow' }, h('div', { class: 'title' }, 'Beim Start öffnen'), h('div', { class: 'sub' }, 'Die App startet mit dem Dashboard')),
          switchEl({ checked: startHere, label: 'Beim Start öffnen', onChange: (on) => localStorageSet('startPage', on ? '/dashboard' : '') })),
        canWake ? h('div', { class: 'list-item' }, h('span', { class: 'lead' }, icon('screen')), h('div', { class: 'grow' }, h('div', { class: 'title' }, 'Bildschirm anlassen'), h('div', { class: 'sub' }, 'Solange das Dashboard offen ist')),
          switchEl({ checked: layout.keepAwake, label: 'Bildschirm anlassen', onChange: (on) => { layout.keepAwake = on; saveLayout(layout); setAwake(on); } })) : null),
      h('button', { class: 'btn text wide', onclick: () => { const keep = layout.keepAwake; layout = loadLayoutDefaults(keep); changed(); } }, icon('refresh', 's18'), 'Standard wiederherstellen')));
  }

  let lastEnded = store.machine?.lastShot?.endedAt;
  let wasRunning = Boolean(store.machine?.shot?.running);
  // Neue Bezüge erkennt die Seite am Ende-Zeitpunkt des letzten Bezugs (auch nachträglich erkannte)
  const un = subscribe((part) => {
    if (part === 'event') return;
    const m = store.machine;
    if (m?.lastShot?.endedAt && m.lastShot.endedAt !== lastEnded) {
      lastEnded = m.lastShot.endedAt;
      loadShots();
    }
    // Neuer Bezug: nach oben scrollen, damit die Live-Kurve sichtbar ist
    if (m?.shot?.running && !wasRunning) window.scrollTo({ top: 0, behavior: 'smooth' });
    wasRunning = Boolean(m?.shot?.running);
    update();
  });
  // Uhrzeit-Angaben („vor 3 min“) und das Ausblenden des fertigen Bezugs auch ohne neue Daten
  const tick = setInterval(update, 5000);

  build();
  loadShots();
  if (layout.keepAwake) setAwake(true);
  return () => {
    disposed = true;
    un();
    clearInterval(tick);
    document.removeEventListener('visibilitychange', onVisible);
    setAwake(false);
  };
}

function loadLayoutDefaults(keepAwake) {
  return { tiles: Object.keys(TILES).map((id) => ({ id, on: true, wide: TILES[id].wide })), keepAwake };
}

// --- Kacheln -----------------------------------------------------------------------
// Jede Kachel: build({wide}) → { body, update(ctx) → {hidden?, extra?} }; ctx = { m: Maschine, g: Mühle|null, shots }

function shotTile({ wide }) {
  const chart = h('div', { class: 'chart-box' });
  const side = h('div', { class: 'live-side' });
  const body = h('div', { class: 'live-shot-grid' }, chart, side);
  return {
    body,
    update({ m }) {
      if (!m) return { hidden: true };
      const running = m.shot?.running;
      const ls = m.lastShot;
      const recent = !running && ls?.endedAt && !ls.estimated && Date.now() - Date.parse(ls.endedAt) < FINISHED_MS;
      if (!running && !recent) return { hidden: true };
      const curve = running ? m.shot.curve : ls.curve;
      const secs = running ? (m.shot.timeMs || 0) / 1000 : (ls.timeMs || 0) / 1000;
      chart.replaceChildren(shotChart(curve, { live: running, width: wide ? 560 : 320, height: wide ? 220 : 160 }));
      const p = running ? m.pressure.pump : ls.maxPressure;
      const w = running ? m.scale.weight : ls.weight;
      const flow = running ? (m.scale.rate || m.flow.rate) : null;
      side.replaceChildren(
        ring(secs / 30, `${fmt(secs, 0)} s`),
        h('div', { class: 'dash-kpis' },
          kpi(running ? 'Druck' : 'Max. Druck', fmt(p), 'bar', 'pu'),
          kpi('Gewicht', w ? fmt(w) : running ? fmt(0) : '–', 'g', 'w'),
          running ? kpi('Fluss', fmt(flow), 'g/s') : kpi('Menge', ls.volumeMl ? fmt(ls.volumeMl, 0) : '–', 'ml')));
      return { extra: running ? h('span', { class: 'badge ok pulse' }, 'Bezug läuft') : h('span', { class: 'badge' }, 'Fertig') };
    },
  };
}

function statusTile() {
  const head = h('div', { class: 'dash-status' });
  const meters = h('div', { class: 'dash-meters' });
  const chips = h('div', { class: 'chips' });
  return {
    body: [head, meters, chips],
    update({ m, shots }) {
      if (!m) {
        head.replaceChildren(orb('info', ''), h('div', {}, h('div', { class: 'label' }, 'Keine Daten')));
        return {};
      }
      const [text, cls, ic] = !m.online ? ['Offline', 'bad', 'warn']
        : m.statusKey === 'off' ? ['Aus', 'off', 'power']
        : m.statusKey === 'eco' ? ['Eco', 'off', 'eco']
        : m.statusKey === 'brewing' ? ['Bezug läuft', 'ok', 'coffee']
        : m.statusKey === 'fault' ? ['Störung', 'bad', 'warn']
        : m.heated ? ['Bereit', 'ok', 'check'] : ['Heizt auf', 'warn', 'thermo'];
      head.className = `dash-status ${cls}`;
      head.replaceChildren(orb(ic), h('div', {}, h('div', { class: 'label' }, text),
        h('div', { class: 'muted small' }, m.online ? `Brühgruppe ${fmt(m.temp.group)} °C` : `Letzter Kontakt ${ago(m.lastSeen)}`)));
      const on = m.online && m.statusKey !== 'off';
      meters.replaceChildren(
        on && m.temp.groupSet ? meter('Brühgruppe', `${fmt(m.temp.group)} / ${fmt(m.temp.groupSet)} °C`, targetBar(m.temp.group, m.temp.groupSet, { max: m.temp.groupSet + 5, heating: true })) : null,
        on && m.temp.boilerSet ? meter('Brühkessel', `${fmt(m.temp.boiler)} / ${fmt(m.temp.boilerSet)} °C`, targetBar(m.temp.boiler, m.temp.boilerSet, { max: m.temp.boilerSet + 5, heating: true })) : null,
        on && m.steamOn ? meter('Dampfkessel', `${fmt(m.pressure.steam, 2)} / ${fmt(m.pressure.steamSet, 1)} bar`, targetBar(m.pressure.steam, m.pressure.steamSet, { max: (m.pressure.steamSet || 1.5) * 1.3, heating: true })) : null);
      const today = new Date().toDateString();
      const n = shots.filter((s) => new Date(s.endedAt).toDateString() === today).length;
      chips.replaceChildren(
        m.tankOk === false ? h('span', { class: 'badge bad' }, 'Tank leer') : m.tankOk ? h('span', { class: 'badge ok' }, 'Tank ok') : null,
        h('span', { class: 'badge' }, m.steamOn ? (m.steamReady ? 'Dampf bereit' : 'Dampf heizt') : 'Dampf aus'),
        h('span', { class: 'badge' }, `${fmtInt(n)} ${n === 1 ? 'Bezug' : 'Bezüge'} heute`));
      return {};
    },
  };
}

function gaugesTile() {
  const pressure = createGauge({ title: 'Druck', min: 0, max: 12, majorStep: 2, minorStep: 0.5, redFrom: 11, digits: 1 });
  const temp = createGauge({ title: 'Brühgruppe', min: 20, max: 110, majorStep: 10, minorStep: 2.5, redFrom: 100, digits: 1, labelEvery: 20 });
  const steam = createGauge({ title: 'Dampfkessel', min: 0, max: 2.5, majorStep: 0.5, minorStep: 0.1, redFrom: 2, digits: 2, labelEvery: 1 });
  return {
    body: h('div', { class: 'gauges three' }, pressure, temp, steam),
    update({ m }) {
      if (!m) return {};
      pressure.update(m.pressure.pump, 'bar');
      temp.update(m.temp.group, m.temp.groupSet ? `Ziel ${fmt(m.temp.groupSet)} °C` : '°C');
      steam.update(m.pressure.steam, m.steamOn ? `Ziel ${fmt(m.pressure.steamSet, 1)} bar` : 'aus');
      return {};
    },
  };
}

function lastShotTile({ wide }) {
  const box = h('div', {});
  return {
    body: box,
    update({ m }) {
      const ls = m?.lastShot;
      if (!ls) {
        box.replaceChildren(h('div', { class: 'empty' }, 'Noch kein Bezug'));
        return {};
      }
      const amount = ls.weight ? [fmt(ls.weight), 'g'] : ls.volumeMl ? [fmt(ls.volumeMl, 0), 'ml'] : ['–', ''];
      box.replaceChildren(
        h('div', { class: 'dash-kpis' }, kpi('Zeit', fmt(ls.timeMs / 1000), 's'), kpi('Menge', amount[0], amount[1], 'w'), kpi('Max. Druck', fmt(ls.maxPressure), 'bar', 'pu')),
        ls.curve?.length > 1 ? shotChart(ls.curve, { width: wide ? 560 : 320, height: wide ? 160 : 130, minSeconds: 20 }) : h('p', { class: 'muted small' }, 'Keine Kurve (Bezug nachträglich erkannt)'));
      return { extra: `${ago(ls.endedAt)}${ls.estimated ? ' · nachträglich' : ''}` };
    },
  };
}

function lastGrindTile() {
  const box = h('div', {});
  return {
    body: box,
    update({ g }) {
      if (!g) {
        box.replaceChildren(h('div', { class: 'empty' }, 'Mühle nicht eingerichtet'));
        return {};
      }
      const last = g.grinds?.[0] || g.stats?.lastGrind;
      if (!last) {
        box.replaceChildren(h('div', { class: 'empty' }, g.online ? 'Noch keine Mahlvorgänge' : 'Mühle offline'));
        return {};
      }
      const recipe = g.recipes?.find((r) => r.index === last.recipe);
      box.replaceChildren(
        h('div', { class: 'big-row' },
          h('div', { class: 'big' }, last.success && last.weightG ? fmt(last.weightG) : '–', h('span', { class: 'unit' }, ' g')),
          h('div', { class: 'muted' }, last.targetG ? `Ziel ${fmt(last.targetG)} g` : last.mode === 'ByTime' ? 'nach Zeit' : '')),
        last.success && last.weightG ? targetBar(last.weightG, last.targetG) : h('span', { class: 'badge bad' }, 'Abgebrochen'),
        h('div', { class: 'chips' },
          h('span', { class: 'badge' }, `${fmt(last.durationMs / 1000)} s`),
          last.recipe ? h('span', { class: 'badge' }, `Rezept ${last.recipe}${recipe?.type ? ` · ${TYPE_DE[recipe.type] || recipe.type}` : ''}`) : null,
          TRIGGER_DE[last.trigger] ? h('span', { class: 'badge' }, TRIGGER_DE[last.trigger]) : null,
          last.gbs ? h('span', { class: 'badge ok' }, 'Grind-by-Sync') : null,
          !g.online ? h('span', { class: 'badge bad' }, 'offline') : null));
      return { extra: ago(last.at) };
    },
  };
}

function weekTile() {
  const box = h('div', {});
  return {
    body: box,
    update({ shots }) {
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - i);
        days.push({ key: d.toDateString(), label: i === 0 ? 'heute' : d.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', ''), value: 0, cls: i === 0 ? 'now' : '' });
      }
      for (const s of shots) {
        const day = days.find((d) => d.key === new Date(s.endedAt).toDateString());
        if (day) day.value++;
      }
      const sum = days.reduce((a, d) => a + d.value, 0);
      box.replaceChildren(sum ? barChart(days) : h('div', { class: 'empty' }, 'Keine Bezüge in den letzten 7 Tagen'));
      return { extra: `${fmtInt(sum)} in 7 Tagen` };
    },
  };
}

function shotTimesTile() {
  const box = h('div', {});
  return {
    body: box,
    update({ shots }) {
      const list = shots.filter((s) => !s.estimated && s.timeMs > 0).slice(0, 12).reverse();
      if (!list.length) {
        box.replaceChildren(h('div', { class: 'empty' }, 'Noch keine Bezüge mit Zeit'));
        return {};
      }
      const avg = list.reduce((a, s) => a + s.timeMs, 0) / list.length / 1000;
      box.replaceChildren(barChart(list.map((s, i) => ({
        value: s.timeMs / 1000,
        label: new Date(s.endedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
        cls: i === list.length - 1 ? 'now' : '',
      })), { unit: 's' }));
      return { extra: `Ø ${fmt(avg, 0)} s` };
    },
  };
}

function grindsTile() {
  const box = h('div', {});
  return {
    body: box,
    update({ g }) {
      if (!g) {
        box.replaceChildren(h('div', { class: 'empty' }, 'Mühle nicht eingerichtet'));
        return {};
      }
      const list = (g.grinds || []).filter((x) => x.success && x.weightG).slice(0, 12).reverse();
      if (!list.length) {
        box.replaceChildren(h('div', { class: 'empty' }, 'Noch keine Mahlvorgänge'));
        return {};
      }
      box.replaceChildren(barChart(list.map((x) => {
        const off = x.targetG ? Math.abs(x.weightG - x.targetG) / x.targetG : null;
        return { value: x.weightG, mark: x.targetG, label: x.recipe ? `R${x.recipe}` : '', cls: off === null ? '' : off <= 0.03 ? 'ok' : off <= 0.08 ? 'warn' : 'bad' };
      }), { unit: 'g', digits: 1 }), h('div', { class: 'legend muted small' }, h('span', { class: 'mark-key' }), 'Ziel', h('span', { class: 'sw ok' }), '±3 %', h('span', { class: 'sw warn' }), '±8 %'));
      const dev = g.stats?.avgDeviationG;
      return { extra: dev !== null && dev !== undefined ? `Ø Abw. ${fmt(dev, 2)} g` : '' };
    },
  };
}

function grinderTile() {
  const box = h('div', {});
  return {
    body: box,
    update({ g }) {
      if (!g) {
        box.replaceChildren(h('div', { class: 'empty' }, 'Mühle nicht eingerichtet'));
        return {};
      }
      const st = g.stats || {};
      const alerts = (g.alerts || []).filter((a) => a.active);
      const recipe = g.recipes?.find((r) => r.selected);
      box.replaceChildren(
        h('div', { class: 'dash-kpis' },
          kpi('Mahlvorgänge', fmtInt(st.today ?? 0), ''),
          kpi('Kaffee', fmt(st.todayCoffeeG ?? 0), 'g'),
          kpi('Gesamt', fmtInt(st.totalGrinds ?? 0), '')),
        h('div', { class: 'chips' },
          h('span', { class: `badge ${g.online ? 'ok' : 'bad'}` }, g.online ? 'online' : 'offline'),
          recipe ? h('span', { class: 'badge' }, `Rezept ${recipe.index} gewählt`) : null,
          ...alerts.slice(0, 3).map((a) => h('span', { class: 'badge warn' }, ALERT_TEXT[a.type] || a.type))));
      return { extra: g.lastSync ? `Stand ${ago(g.lastSync)}` : '' };
    },
  };
}

function liveTile({ wide }) {
  const box = h('div', {});
  const legend = h('div', { class: 'legend muted small' }, SERIES.map((s) => [h('span', { class: `sw ${s.cls}` }), s.label]));
  return {
    body: [box, legend],
    update() {
      box.replaceChildren(liveChart(liveHistory, SERIES, { width: wide ? 640 : 320, height: wide ? 200 : 150, spanMs: 10 * 60e3 }));
      return {};
    },
  };
}

function kpi(k, v, unit, cls = '') {
  return h('div', { class: `kpi ${cls}` }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v, unit ? h('span', { class: 'muted small' }, ' ' + unit) : null));
}
function meter(label, value, bar) {
  return h('div', { class: 'dash-meter' }, h('div', { class: 'row between small' }, h('span', { class: 'muted' }, label), h('span', { class: 'num' }, value)), bar);
}
function orb(ic) {
  return h('span', { class: 'orb' }, icon(ic));
}
