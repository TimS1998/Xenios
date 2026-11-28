// Home (Dashboard): anpassbare Übersicht (Handy, Tablet hochkant und quer). Bedienen lassen sich die Kacheln „Schalter“
// (Ein/Eco/Aus, Dampf, Skript stoppen) und „Sollwerte“. Am Handy (eine Spalte) sind die Kacheln so hoch wie ihr Inhalt. Auswahl, Reihenfolge, Breite und Höhe der Kacheln speichert jedes Gerät für sich (localStorage).
// Raster wie bei Android-Widgets: Breite in Spalten (oder ganze Breite), Höhe in Zellen; Kacheln einer Zeile sind gleich hoch.
import { h, icon, fmt, fmtInt, ago, sheet, switchEl, snackbar, promptNumber } from '../ui.js';
import { api, store, subscribe, hasGrinder, machineOn, scriptActive, isClassic } from '../api.js';
import { isHidden, noSteamOn, setNoSteamOn, powerOnBody, onPrefs } from '../prefs.js';
import { createGauge, ring, shotChart, barChart, targetBar, liveChart } from '../gauge.js';
import { navigate, setTopActions, localStorageGet, localStorageSet } from '../app.js';
import { liveHistory, SERIES } from '../live.js';
import { TYPE_DE, TRIGGER_DE } from './grinder.js';
import { ALERT_TEXT } from '../../shared/grinder-core.js';
import { shotMetrics, scriptDuration, brewSeconds, liveTimes } from '../../shared/shot-analysis.js';
import { t, locale } from '../../shared/i18n.js';

// w: Spalten (0 = ganze Breite), h: Höhe in Zellen. Reihenfolge = Standardanordnung (schmal und breit gleich):
// Live-Bezug (immer oben), Schalter, Status, Instrumente, Verlauf, Letzter Bezug, Bezüge pro Tag, Bezugszeiten,
// Sollwerte, Pflege. Breite Ansicht (4 Spalten): Schalter | Status nebeneinander, Instrumente und Verlauf über die
// ganze Breite, dann Letzter Bezug (2 × 2) mit Bezüge pro Tag / Bezugszeiten und Sollwerte / Pflege rechts daneben.
const TILES = {
  shot: { get title() { return t('home.tiles.shot.title'); }, icon: 'coffeeDrip', w: 0, h: 2, get note() { return t('home.tiles.shot.note'); }, build: shotTile },
  control: { get title() { return t('home.tiles.control.title'); }, icon: 'toggleTile', w: 2, h: 1, get note() { return t('home.tiles.control.note'); }, build: controlTile },
  status: { get title() { return t('home.tiles.status.title'); }, icon: 'power', w: 2, h: 1, build: statusTile },
  gauges: { get title() { return t('home.tiles.gauges.title'); }, icon: 'thermo', w: 0, h: 2, get note() { return t('home.tiles.gauges.note'); }, build: gaugesTile },
  live: { get title() { return t('home.tiles.live.title'); }, icon: 'history', w: 0, h: 2, build: liveTile },
  lastShot: { get title() { return t('home.tiles.lastShot.title'); }, icon: 'coffeeLine', w: 2, h: 2, build: lastShotTile, link: '/bezuege' },
  week: { get title() { return t('home.tiles.week.title'); }, icon: 'calendarBars', w: 1, h: 1, build: weekTile, link: '/bezuege' },
  shotTimes: { get title() { return t('home.tiles.shotTimes.title'); }, icon: 'timer', w: 1, h: 1, build: shotTimesTile, link: '/bezuege' },
  targets: { get title() { return t('home.tiles.targets.title'); }, icon: 'thermo', w: 1, h: 1, get note() { return t('home.tiles.targets.note'); }, build: targetsTile },
  care: { get title() { return t('home.tiles.care.title'); }, icon: 'check', w: 1, h: 1, build: careTile, link: '/bezuege' },
  lastGrind: { get title() { return t('home.tiles.lastGrind.title'); }, icon: 'grinder', w: 1, h: 1, build: lastGrindTile, link: '/muehle' },
  grinds: { get title() { return t('home.tiles.grinds.title'); }, icon: 'scale', w: 1, h: 1, build: grindsTile, link: '/muehle' },
  grinder: { get title() { return t('home.tiles.grinder.title'); }, icon: 'grinder', w: 1, h: 1, build: grinderTile, link: '/muehle' },
};
const GRINDER_TILES = new Set(['lastGrind', 'grinds', 'grinder']);
const KEY = 'dashboard';
const LAYOUT_VERSION = 7; // 3: Breite/Höhe in Zellen; 7: neue Standardanordnung und spaltenweise Platzierung
const FINISHED_MS = 20e3;   // so lange bleibt der Live-Bezug nach dem Ende stehen
const MIN_COL = 250;        // Mindestbreite einer Spalte (px); daraus ergibt sich die Spaltenzahl (1, 2 oder 4)
const MAX_COL = 340;        // Höchstbreite einer Spalte: darüber bleibt das Raster schmaler und steht zentriert
const GAP = 12;
const WIDTHS = () => [[1, t('home.customize.columns', { n: 1 })], [2, t('home.customize.columns', { n: 2 })], [3, t('home.customize.columns', { n: 3 })], [0, t('home.customize.fullWidth')]];
const HEIGHTS = () => [1, 2, 3, 4].map((n) => [n, t('home.customize.height', { n })]);
const CELL = 180;           // Höhe einer Zelle (px), wie --cell in app.css
// Mindesthöhe je Kachel in Zellen: wird bei jeder Anordnung für die aktuelle Breite gemessen (Inhalt bei 1 Zelle).
// Bis dahin (oder für gerade ausgeblendete Kacheln wie den Live-Bezug) gelten diese Werte.
const MIN_ROWS = { shot: 2, status: 2, live: 2 };
const minRows = {};
const minH = (id) => minRows[id] ?? MIN_ROWS[id] ?? 1;
const clampW = (v, d) => ([0, 1, 2, 3].includes(Number(v)) ? Number(v) : d);
const clampH = (v, d) => ([1, 2, 3, 4].includes(Number(v)) ? Number(v) : d);

function tileVisible(id) {
  if (GRINDER_TILES.has(id) && !hasGrinder()) return false;
  if (id === 'care' && isHidden('care')) return false;
  // Sollwerte nur, wenn „Maschinen-Einstellungen ändern“ erlaubt ist
  if (id === 'targets' && store.server?.features?.settings === false) return false;
  return true;
}

function loadLayout() {
  let saved = null;
  try { saved = JSON.parse(localStorageGet(KEY) || 'null'); } catch { /* kaputt → Standard */ }
  const v3 = Number(saved?.v) >= 3;
  const tiles = (Array.isArray(saved?.tiles) ? saved.tiles : []).filter((t) => TILES[t?.id]).map((t) => {
    const def = TILES[t.id];
    // Ältere Layouts: „breit“ wird zur ganzen Breite, die Höhe kommt aus dem Standard
    const w = v3 ? clampW(t.w, def.w) : t.wide ? 0 : def.w;
    return { id: t.id, on: t.on !== false, w, h: v3 ? clampH(t.h, def.h) : def.h, ...(t.arr === 2 || t.arr === 4 ? { arr: t.arr } : {}) };
  });
  for (const id of Object.keys(TILES)) if (!tiles.some((t) => t.id === id)) tiles.push({ id, on: true, w: TILES[id].w, h: TILES[id].h });
  // Ältere Layouts (vor Version 7): einmalig die neue Standardanordnung und -größen; ein-/ausgeblendete Kacheln
  // und die Anordnung der Instrumente am Handy bleiben
  if (saved && Number(saved.v || 0) < 7) {
    const old = Object.fromEntries(tiles.map((t) => [t.id, t]));
    tiles.splice(0, tiles.length, ...Object.keys(TILES).map((id) => ({ id, on: old[id]?.on !== false, w: TILES[id].w, h: TILES[id].h, ...(old[id]?.arr ? { arr: old[id].arr } : {}) })));
  }
  return { tiles: shotFirst(tiles), keepAwake: Boolean(saved?.keepAwake) };
}
const saveLayout = (l) => localStorageSet(KEY, JSON.stringify({ ...l, v: LAYOUT_VERSION }));

// Live-Bezug steht immer ganz oben
function shotFirst(tiles) {
  const i = tiles.findIndex((t) => t.id === 'shot');
  if (i > 0) tiles.unshift(...tiles.splice(i, 1));
  return tiles;
}

// Platzierung im Raster: Kacheln über die ganze Breite beginnen einen neuen Abschnitt. Schmalere Kacheln füllen
// einen Abschnitt (so hoch wie seine erste Kachel) spaltenweise: von links nach rechts, in jeder Spalte von oben nach
// unten. Damit bleibt die Reihenfolge auch beim Schmalerwerden bis zur einspaltigen Ansicht sinnvoll.
// items: [{ w, h }] (w bereits auf cols begrenzt) → [{ col, row }] (0-basiert)
export function packTiles(items, cols) {
  const used = [];
  const free = (r, c, w, h) => {
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) if (used[y]?.[x]) return false;
    return true;
  };
  const take = (r, c, w, h) => {
    for (let y = r; y < r + h; y++) { used[y] ||= []; for (let x = c; x < c + w; x++) used[y][x] = true; }
  };
  let bottom = 0;
  let band = null; // { top, h }
  return items.map(({ w, h }) => {
    let pos = null;
    if (w < cols && band && h <= band.h) {
      for (let c = 0; c + w <= cols && !pos; c++) {
        for (let r = band.top; r + h <= band.top + band.h; r++) if (free(r, c, w, h)) { pos = { col: c, row: r }; break; }
      }
    }
    if (!pos) {
      pos = { col: 0, row: bottom };
      band = w < cols ? { top: bottom, h } : null;
    }
    take(pos.row, pos.col, w, h);
    bottom = Math.max(bottom, pos.row + h);
    return pos;
  });
}

export function dashboardView(root) {
  let layout = loadLayout();
  let shots = [];
  let built = [];
  const grid = h('div', { class: 'dash stagger' });
  // Spaltenzahl aus der verfügbaren Breite; Kacheln spannen über w Spalten (höchstens alle) und h Zellen
  let cols = 1;
  // Erst alle Kacheln auf 1 Zelle setzen und ihren Platzbedarf lesen (ein Layoutdurchgang, kein Zwischenbild),
  // dann jede über max(gewählte Höhe, Mindesthöhe) Zellen spannen. Zellen sind fest CELL px hoch.
  const place = () => {
    // Eine Spalte (Handy): alle Kacheln untereinander, jede so hoch wie ihr Inhalt; Breite/Höhe sind dann ohne Wirkung
    grid.classList.toggle('single', cols === 1);
    if (cols === 1) {
      for (const b of built) {
        b.el.style.setProperty('grid-column', '1 / -1');
        b.el.style.setProperty('grid-row', 'auto');
        b.el.style.order = '';
      }
      return;
    }
    // Seitenhöhe und Scrollposition während des Messens festhalten: sonst wird die Seite kurz kürzer und springt nach oben
    const keepY = window.scrollY;
    grid.style.minHeight = `${grid.offsetHeight}px`;
    const spanOf = (b) => (b.w === 0 ? cols : Math.min(b.w, cols));
    // Platzbedarf messen: jede Kachel in ihrer Breite, eine Zelle hoch (ein Layoutdurchgang, kein Zwischenbild)
    for (const b of built) {
      b.el.style.order = '';
      b.el.style.setProperty('grid-column', `1 / span ${spanOf(b)}`);
      b.el.style.setProperty('grid-row', 'auto / span 1');
    }
    for (const b of built) {
      if (b.el.hidden) continue;
      minRows[b.id] = Math.min(4, Math.max(1, Math.ceil((b.el.scrollHeight + GAP) / (CELL + GAP))));
    }
    // dann fest platzieren (spaltenweise Abschnitte, siehe packTiles)
    const shown = built.filter((b) => !b.el.hidden);
    const spots = packTiles(shown.map((b) => ({ w: spanOf(b), h: Math.max(b.h, minH(b.id)) })), cols);
    shown.forEach((b, i) => {
      const w = spanOf(b);
      const hh = Math.max(b.h, minH(b.id));
      b.el.style.setProperty('grid-column', `${spots[i].col + 1} / span ${w}`);
      b.el.style.setProperty('grid-row', `${spots[i].row + 1} / span ${hh}`);
    });
    grid.style.minHeight = '';
    if (window.scrollY !== keepY) window.scrollTo(0, keepY);
  };
  // Wächst ein Inhalt nachträglich (z. B. Zeile „Zieldruck“ beim Einschalten des Dampfkessels), neu anordnen
  const refit = () => {
    if (cols > 1 && built.some((b) => !b.el.hidden && b.el.scrollHeight > b.el.clientHeight + 1)) place();
  };
  // Neu anordnen mit Animation: jede Kachel gleitet von alter zu neuer Position und Größe (nichts springt)
  // Lage der Kacheln (dokumentbezogen), nach jeder Anordnung gemerkt: Ausgangspunkt für Animationen beim Ändern der
  // Fenstergröße (dann ist die alte Lage beim Messen schon verloren)
  let lastRects = new Map();
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { left: r.left + window.scrollX, top: r.top + window.scrollY, width: r.width, height: r.height }; };
  let snapTimer = 0;
  const snap = () => { clearTimeout(snapTimer); snapTimer = setTimeout(() => { lastRects = new Map(built.map((b) => [b, rectOf(b.el)])); }, 300); };
  // Neu anordnen mit Animation: jede Kachel gleitet von alter zu neuer Position und Größe (nichts springt).
  // mutate: Änderung am Inhalt, erst nach dem Messen der alten Lage (sonst ist die Kachel schon gewachsen)
  const relayout = (mutate, before = null) => {
    const from = before || new Map(built.map((b) => [b, rectOf(b.el)]));
    mutate?.();
    place();
    snap();
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    for (const b of built) {
      const r0 = from.get(b);
      if (!r0 || b.el.hidden || !r0.height) continue;
      const r1 = rectOf(b.el);
      if (Math.abs(r0.top - r1.top) < 1 && Math.abs(r0.left - r1.left) < 1 && Math.abs(r0.height - r1.height) < 1 && Math.abs(r0.width - r1.width) < 1) continue;
      b.el.animate([
        { transform: `translate(${r0.left - r1.left}px, ${r0.top - r1.top}px)`, height: `${r0.height}px`, width: `${r0.width}px` },
        { transform: 'none', height: `${r1.height}px`, width: `${r1.width}px` },
      ], { duration: 300, easing: 'cubic-bezier(.2, 0, 0, 1)' });
    }
  };
  // Spaltenzahl aus der Breite; true, wenn sie sich geändert hat
  // Nur 1 (Handy), 2 oder 4 Spalten: so skaliert die Anordnung sauber. Reicht der Platz noch nicht für die nächste
  // Stufe, wachsen die Spalten nur bis MAX_COL und das Raster steht zentriert im Inhaltsbereich.
  const available = () => {
    const host = grid.parentElement;
    if (!host) return 0;
    const cs = getComputedStyle(host);
    return host.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  };
  const measureCols = () => {
    const width = available();
    if (!width) return false;
    const fit = Math.floor((width + GAP) / (MIN_COL + GAP));
    const n = fit >= 4 ? 4 : fit >= 2 ? 2 : 1;
    grid.style.maxWidth = n > 1 ? `${n * MAX_COL + (n - 1) * GAP}px` : '';
    if (n === cols) return false;
    cols = n;
    grid.style.setProperty('--cols', String(cols));
    return true;
  };
  // Spaltenzahl geändert (Fenster breiter/schmaler): Kacheln gleiten an ihre neuen Plätze
  const sizes = new ResizeObserver(() => {
    if (!measureCols()) { snap(); return; }
    if (built.length && lastRects.size) relayout(null, lastRects); else { place(); snap(); }
  });
  root.append(grid);
  setTopActions(h('button', { class: 'icon-btn', 'aria-label': t('home.customize.title'), title: t('home.customize.title'), onclick: customize }, icon('tune')));

  let firstBuild = true;
  function build() {
    built = layout.tiles.filter((t) => t.on && tileVisible(t.id)).map((t) => {
      const def = TILES[t.id];
      const t0 = def.build({ wide: t.w !== 1, h: t.h, arr: t.arr, relayout: (fn) => relayout(fn) });
      const extra = h('span', { class: 'extra' });
      const open = def.link ? () => navigate(def.link) : null;
      const el = h('section', {
        class: `tile${t.w !== 1 ? ' wide' : ''}${def.link ? ' clickable' : ''} t-${t.id}`,
        dataset: { h: String(t.h) },
        role: def.link ? 'link' : null,
        tabindex: def.link ? '0' : null,
        'aria-label': def.title,
        onclick: open,
        onkeydown: open ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } : null,
      },
        h('header', { class: 'tile-head' }, icon(def.icon), h('span', {}, def.title), extra), h('div', { class: 'tile-body' }, t0.body));
      return { id: t.id, el, extra, update: t0.update, w: t.w, h: t.h };
    });
    // Sichtbarkeit (z. B. Live-Bezug nur während eines Bezugs) vor dem Einfügen festlegen: nichts blitzt kurz auf
    const ctx = { m: store.machine, g: store.grinder?.enabled && hasGrinder() ? store.grinder : null, shots, maint };
    for (const b of built) {
      try { b.el.hidden = (b.update(ctx) || {}).hidden === true || (awaitFresh && b.id === 'shot'); } catch { /* update() folgt */ }
    }
    if (firstBuild) firstBuild = false;
    else grid.classList.remove('stagger'); // gestaffelter Einflug nur beim Öffnen der Seite
    grid.replaceChildren(built.length ? built.map((b) => b.el) : h('div', { class: 'empty' }, t('home.customize.empty')));
    measureCols(); // gleich in der richtigen Spaltenzahl aufbauen, nicht erst einspaltig
    place();
    update();
    snap();
  }

  function update() {
    const ctx = { m: store.machine, g: store.grinder?.enabled && hasGrinder() ? store.grinder : null, shots, maint };
    let toggled = false;
    for (const b of built) {
      try {
        const r = b.update(ctx) || {};
        const hide = r.hidden === true || (awaitFresh && b.id === 'shot');
        if (hide !== b.el.hidden) toggled = true;
        b.el.hidden = hide;
        b.extra.replaceChildren(r.extra ?? '');
      } catch (e) { console.error(b.id, e); }
    }
    // Kachel erschienen oder verschwunden (z. B. Live-Bezug): die übrigen rücken animiert nach
    if (toggled && built.every((b) => b.el.isConnected) && cols > 1) relayout();
    else refit();
  }

  let maint = null;
  async function loadShots() {
    try { shots = (await api('/api/shots')).shots || []; } catch { /* nächster Versuch beim nächsten Bezug */ }
    try { maint = (await api('/api/maintenance')).backflush; } catch { maint = null; }
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
    const visible = () => layout.tiles.filter((t) => tileVisible(t.id));
    const paint = () => list.replaceChildren(visible().map((tile, i, vis) => {
      const def = TILES[tile.id];
      const move = (d) => {
        const next = vis[i + d];
        if (!next) return;
        const a = layout.tiles.indexOf(tile);
        const b = layout.tiles.indexOf(next);
        [layout.tiles[a], layout.tiles[b]] = [layout.tiles[b], layout.tiles[a]];
        changed('move');
      };
      const pinned = false;
      return h('div', { class: 'list-item dash-cfg-row' },
        switchEl({ checked: tile.on, label: def.title, onChange: (on) => { tile.on = on; changed(); } }),
        h('div', { class: 'grow' }, h('div', { class: 'title' }, def.title), pinned ? h('div', { class: 'sub' }, t('home.customize.pinnedNote')) : def.note ? h('div', { class: 'sub' }, def.note) : null),
        h('div', { class: 'dash-cfg-ctl' },
          pinned || cols === 1 ? null : sizeSelect(WIDTHS(), tile.w, t('home.customize.widthOf', { title: def.title }), (v) => { tile.w = v; changed(); }),
          // Nur Höhen anbieten, in die der Inhalt bei der aktuellen Breite passt
          cols === 1 ? null : sizeSelect(HEIGHTS().filter(([v]) => v >= minH(tile.id)), Math.max(tile.h, minH(tile.id)), t('home.customize.heightOf', { title: def.title }), (v) => { tile.h = v; changed(); }),
          // Handy: Instrumente 1 × 4 (Standard) oder 2 × 2 (größer)
          cols === 1 && tile.id === 'gauges' ? sizeSelect([[4, '1 × 4'], [2, '2 × 2']], tile.arr === 2 ? 2 : 4, t('home.customize.arrangementOf', { title: def.title }), (v) => { tile.arr = v; changed(); }) : null,
          tile.id === 'shot' || pinned ? null : [
            h('button', { class: 'icon-btn', 'aria-label': t('home.customize.moveUp', { title: def.title }), disabled: i === 0, onclick: () => move(-1) }, icon('less')),
            h('button', { class: 'icon-btn', 'aria-label': t('home.customize.moveDown', { title: def.title }), disabled: i === vis.length - 1, onclick: () => move(1) }, icon('more'))]));
    }));
    const changed = (kind) => {
      shotFirst(layout.tiles);
      saveLayout(layout);
      if (!disposed) {
        if (kind === 'move') {
          // Nur die Reihenfolge: vorhandene Kacheln behalten und an die neuen Plätze gleiten lassen
          relayout(() => {
            const order = layout.tiles.map((t) => t.id);
            built.sort((x, y) => order.indexOf(x.id) - order.indexOf(y.id));
            grid.append(...built.map((b) => b.el)); // Reihenfolge im Dokument (für die einspaltige Ansicht)
          });
        } else {
          // Größe/Ein-Aus: neu aufbauen, aber animiert von der bisherigen Lage aus
          const before = new Map(built.map((b) => [b.id, rectOf(b.el)]));
          build();
          relayout(null, new Map(built.map((b) => [b, before.get(b.id)]).filter(([, r]) => r)));
        }
      }
      paint();
    };
    paint();
    // Wake Lock gibt es im Browser nur über HTTPS (bzw. localhost); in der Android-App immer
    const canWake = typeof window.XeniaApp?.keepScreenOn === 'function' || ('wakeLock' in navigator && window.isSecureContext);
    sheet(t('home.customize.title'), h('div', {},
      h('p', { class: 'muted small' }, cols === 1
        ? t('home.customize.introSingle')
        : t('home.customize.introGrid')),
      list,
      h('div', { class: 'section-title' }, t('home.customize.thisDevice')),
      h('div', { class: 'list' },
        canWake ? h('div', { class: 'list-item' }, h('span', { class: 'lead' }, icon('screen')), h('div', { class: 'grow' }, h('div', { class: 'title' }, t('home.customize.keepAwake')), h('div', { class: 'sub' }, t('home.customize.keepAwakeSub'))),
          switchEl({ checked: layout.keepAwake, label: t('home.customize.keepAwake'), onChange: (on) => { layout.keepAwake = on; saveLayout(layout); setAwake(on); } })) : null),
      h('button', { class: 'btn text wide', onclick: () => { const keep = layout.keepAwake; layout = loadLayoutDefaults(keep); changed(); } }, icon('refresh', 's18'), t('home.customize.reset'))));
  }

  let lastEnded = store.machine?.lastShot?.endedAt;
  let wasRunning = Boolean(store.machine?.shot?.running);
  // App/Tab im Hintergrund: die Live-Kachel sofort (ungesehen) ausblenden. Nach dem Zurückkommen zeigt die Seite
  // sie erst wieder, wenn frische Daten einen laufenden Bezug melden – kein veralteter Bezug, der dann wegklappt.
  let awaitFresh = false;
  const onVisibility = () => {
    if (document.visibilityState !== 'hidden') return;
    awaitFresh = true;
    const sb = built.find((b) => b.id === 'shot');
    if (sb && !sb.el.hidden) { sb.el.hidden = true; place(); }
  };
  document.addEventListener('visibilitychange', onVisibility);
  // Neue Bezüge erkennt die Seite am Ende-Zeitpunkt des letzten Bezugs (auch nachträglich erkannte)
  const un = subscribe((part) => {
    if (part === 'event') return;
    // frischer Gesamtstand nach dem Zurückkommen (Server: Snapshot beim Neuverbinden, Direkt-Modus: erste Abfrage)
    if (awaitFresh && document.visibilityState === 'visible' && (part === 'all' || (store.server?.mode === 'direct' && part === 'machine'))) awaitFresh = false;
    if (part === 'server') { build(); return; }
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
  const unPrefs = onPrefs((k) => { if (k === 'hiddenComponents') build(); else update(); });

  build();
  sizes.observe(root); // Breite des Inhaltsbereichs (das Raster selbst ist ggf. schmaler)
  loadShots();
  if (layout.keepAwake) setAwake(true);
  return () => {
    disposed = true;
    sizes.disconnect();
    un();
    unPrefs();
    clearInterval(tick);
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('visibilitychange', onVisible);
    setAwake(false);
  };
}

function loadLayoutDefaults(keepAwake) {
  return { tiles: Object.keys(TILES).map((id) => ({ id, on: true, w: TILES[id].w, h: TILES[id].h })), keepAwake };
}

function sizeSelect(options, value, label, onChange) {
  const el = h('select', { class: 'text small-select', 'aria-label': label, title: label },
    options.map(([v, t]) => h('option', { value: v, selected: v === value }, t)));
  el.addEventListener('change', () => onChange(Number(el.value)));
  return el;
}

// --- Kacheln -----------------------------------------------------------------------
// Jede Kachel: build({wide, h}) → { body, update(ctx) → {hidden?, extra?} }; ctx = { m: Maschine, g: Mühle|null, shots }

// Zusätzliche Höhe für Diagramme in höheren Kacheln (eine Zelle = CELL px)
const extraH = (h) => (Math.max(1, h || 1) - 1) * CELL;

function shotTile({ wide, h: rows }) {
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
      // Bezugszeit wie an der Xenia: ohne Vorbrühen; während des Vorbrühens dessen Dauer
      const lt = running ? liveTimes(m.shot) : null;
      const secs = running ? (lt.pre ? lt.preS : lt.brewS) : (brewSeconds(ls) || 0);
      chart.replaceChildren(shotChart(curve, { live: running, width: wide ? 560 : 320, height: Math.max(140, (wide ? 220 : 160) + extraH(rows) - CELL) }));
      const p = running ? m.pressure.pump : ls.maxPressure;
      const w = running ? m.scale.weight : ls.weight;
      const flow = running ? (m.scale.rate || m.flow.rate) : null;
      side.replaceChildren(
        ring(lt?.pre ? 0 : secs / 30, `${fmt(secs, 0)} s`, lt?.pre ? t('home.shot.preinfusion') : null),
        h('div', { class: 'dash-kpis' },
          kpi(running ? t('home.kpi.pressure') : t('home.kpi.maxPressure'), fmt(p), 'bar', 'pu'),
          kpi(t('home.kpi.weight'), w ? fmt(w) : running ? fmt(0) : '–', 'g', 'w'),
          running ? kpi(t('home.kpi.flow'), fmt(flow), 'g/s')
            // Ohne Durchflussmesser (alte Xenia) statt der Wassermenge das Verhältnis
            : isClassic() ? kpi(t('home.kpi.ratio'), shotMetrics(ls).ratio ? `1:${fmt(shotMetrics(ls).ratio)}` : '–', '')
            : kpi(t('home.kpi.amount'), ls.volumeMl ? fmt(ls.volumeMl, 0) : '–', 'ml')));
      return { extra: running ? h('span', { class: 'badge ok pulse' }, t('home.shot.running')) : h('span', { class: 'badge' }, t('home.shot.done')) };
    },
  };
}

// Schalter: Ein/Eco/Aus als Segmente, Dampfkessel und „Ohne Dampf einschalten“ (gilt geräteweit, wie auf der Startseite)
function controlTile() {
  let busy = false;
  // Laufender Schaltbefehl: Knöpfe zeigen sofort den Zielzustand und bleiben gesperrt, bis die Maschine ihn meldet
  // (höchstens 10 s) – kein zweites Drücken, weil sich scheinbar nichts tut
  let pending = null; // { mode } oder { steam }, until
  let lastM = null;
  let paintNow = () => {};
  const seg = (mode, label, ic) => h('button', { class: 'seg-btn', type: 'button', dataset: { mode }, onclick: (e) => { e.stopPropagation(); setMode(mode); } }, icon(ic, 's18'), label);
  const btnOn = seg('on', t('home.control.on'), 'power');
  const btnEco = seg('eco', t('home.control.eco'), 'eco');
  const btnOff = seg('off', t('home.control.off'), 'close');
  const steamSw = switchEl({ label: t('home.control.steamBoiler'), onChange: (on, input) => setSteam(on, input) });
  const steamState = h('span', { class: 'muted small' });
  const noSteamSw = switchEl({ checked: noSteamOn(), label: t('home.control.noSteam'), onChange: (on) => setNoSteamOn(on) });
  // „Skript stoppen“: erscheint nur, solange ein Skript, Bezug oder Backflush läuft
  const stopBtn = h('button', { class: 'btn danger wide', type: 'button', hidden: true, onclick: () => run(async () => {
    const r = await api('/api/machine/scripts/stop', { method: 'POST' });
    if (!r.stopped && !r.backflush) throw new Error(t('home.control.noScript'));
  }, t('home.control.stopping')) }, icon('stop', 's18'), t('home.control.stopScript'));
  const body = h('div', { class: 'dash-control' },
    stopBtn,
    h('div', { class: 'seg' }, btnOn, btnEco, btnOff),
    h('div', { class: 'ctl-row' }, icon('cloud', 's20'), h('span', { class: 'grow' }, `${t('home.control.steamBoiler')} `, steamState), steamSw),
    h('div', { class: 'ctl-row' }, icon('power', 's20'), h('span', { class: 'grow' }, t('home.control.noSteam')), noSteamSw));

  async function run(fn, msg) {
    if (busy) return;
    busy = true;
    try {
      await fn();
      snackbar(msg);
    } catch (e) {
      snackbar(e.message);
    } finally {
      busy = false;
    }
  }
  // Befehl senden; bis zur Bestätigung durch die Maschine gilt „pending“ (bei Fehler sofort zurück)
  function begin(p, send, msg) {
    if (pending || busy) return;
    pending = { ...p, until: Date.now() + 10000 };
    setTimeout(() => { if (pending && Date.now() >= pending.until) { pending = null; paintNow(); } }, 10100);
    paintNow();
    snackbar(msg);
    busy = true;
    send().catch((e) => { pending = null; paintNow(); snackbar(e.message); }).finally(() => { busy = false; });
  }
  function setMode(mode) {
    const m = store.machine;
    if (!m?.online) return snackbar(t('home.control.unreachable'));
    if (mode === 'on') {
      const b = powerOnBody();
      return begin({ mode, steam: b.steam !== false }, () => api('/api/machine/power', { method: 'POST', body: b }), b.steam === false ? t('home.control.poweringOnNoSteam') : t('home.control.poweringOn'));
    }
    if (mode === 'eco') return begin({ mode }, () => api('/api/machine/power', { method: 'POST', body: { mode: 'eco' } }), t('home.control.toEco'));
    return begin({ mode }, () => api('/api/machine/power', { method: 'POST', body: { mode: 'off' } }), t('home.control.poweringOff'));
  }
  function setSteam(on, input) {
    if (pending || busy) { input.checked = !on; return; }
    begin({ steamOnly: on }, () => api('/api/machine/steam', { method: 'POST', body: { on } }), on ? t('home.control.steamTurningOn') : t('home.control.steamTurningOff'));
  }
  // Meldet die Maschine den erwarteten Zustand?
  function confirmed(m) {
    if (!pending || !m?.online) return false;
    const key = m.statusKey;
    const on = ['on', 'brewing', 'draining', 'paddle'].includes(key);
    if ('steamOnly' in pending) return Boolean(m.steamOn) === pending.steamOnly;
    if (pending.mode === 'on') return on;
    if (pending.mode === 'eco') return key === 'eco';
    return key === 'off';
  }
  // Schalter selbst lösen keine Navigation aus
  body.addEventListener('click', (e) => e.stopPropagation());
  return {
    body,
    update({ m }) {
      lastM = m;
      paintNow = () => paint(lastM);
      paint(m);
      stopBtn.hidden = !scriptActive(m);
      stopBtn.lastChild.textContent = m?.backflush ? t('home.control.stopBackflush') : m?.shot?.script?.title ? t('home.control.stopNamed', { title: m.shot.script.title }) : t('home.control.stopShot');
      return { extra: !m?.online ? h('span', { class: 'badge bad' }, t('home.control.offline')) : null };
    },
  };
  function paint(m) {
      if (pending && confirmed(m)) pending = null;
      const online = Boolean(m?.online);
      const key = m?.statusKey;
      const p = pending && !('steamOnly' in pending) ? pending.mode : null;
      const on = p ? p === 'on' : ['on', 'brewing', 'draining', 'paddle'].includes(key);
      const eco = p ? p === 'eco' : key === 'eco';
      const off = p ? p === 'off' : key === 'off';
      const brewing = key === 'brewing';
      for (const [b, active] of [[btnOn, on], [btnEco, eco], [btnOff, off]]) {
        b.setAttribute('aria-pressed', String(Boolean(online && active)));
        // während eines Schaltbefehls alle gesperrt, der Zielknopf leicht gedämpft (läuft noch)
        b.disabled = Boolean(pending) || !online || brewing || (active && online);
        b.classList.toggle('pending', Boolean(p) && active);
      }
      if (!pending) btnEco.disabled ||= off;
      const sIn = steamSw.querySelector('input');
      const steamPending = pending && 'steamOnly' in pending;
      sIn.checked = steamPending ? pending.steamOnly : Boolean(m?.steamOn);
      sIn.disabled = Boolean(pending) || !online || !(on || eco) || !machineOn(m);
      steamState.textContent = !online ? '' : steamPending ? (pending.steamOnly ? t('home.control.steamSwitchingOn') : t('home.control.steamSwitchingOff'))
        : m.steamOn ? (m.steamReady ? t('home.control.steamReady', { p: fmt(m.pressure.steam, 1) }) : t('home.control.steamHeating', { p: fmt(m.pressure.steam, 1) })) : t('home.control.steamOff');
      noSteamSw.querySelector('input').checked = noSteamOn();
  }
}

function statusTile() {
  const head = h('div', { class: 'dash-status' });
  const meters = h('div', { class: 'dash-meters' });
  const chips = h('div', { class: 'chips' });
  const running = h('div', { class: 'dash-running', hidden: true });
  return {
    body: [head, running, meters, chips],
    update({ m, shots }) {
      if (!m) {
        head.replaceChildren(orb('info', ''), h('div', {}, h('div', { class: 'label' }, t('home.status.noData'))));
        return {};
      }
      const [text, cls, ic] = !m.online ? [t('home.status.offline'), 'bad', 'warn']
        : m.statusKey === 'off' ? [t('home.status.off'), 'off', 'power']
        : m.statusKey === 'eco' ? [t('home.status.eco'), 'off', 'eco']
        : m.statusKey === 'brewing' ? [t('home.status.brewing'), 'ok', 'coffeeDrip']
        : m.statusKey === 'fault' ? [t('home.status.fault'), 'bad', 'warn']
        : m.heated ? [t('home.status.ready'), 'ok', 'check'] : [t('home.status.heating'), 'warn', 'thermo'];
      head.className = `dash-status ${cls}`;
      head.replaceChildren(orb(ic), h('div', {}, h('div', { class: 'label' }, text),
        h('div', { class: 'muted small' }, m.online ? t('home.status.groupTemp', { t: fmt(m.temp.group) }) : t('home.status.lastContact', { ago: ago(m.lastSeen) }))));
      // Laufendes Skript (Name, Zeit, Restzeit soweit bekannt), Backflush-Runde oder die letzte Störung
      const sh = m.shot || {};
      if (m.online && m.backflush) {
        running.hidden = false;
        running.className = 'dash-running';
        running.replaceChildren(h('div', { class: 'run-title' }, icon('play', 's18'), t('home.status.backflush')),
          h('div', { class: 'muted small' }, t('home.status.backflushRound', { cycle: fmtInt(m.backflush.cycle), cycles: fmtInt(m.backflush.cycles) })),
          targetBar(m.backflush.cycle, m.backflush.cycles, { max: m.backflush.cycles }));
      } else if (m.online && sh.running) {
        const secs = (sh.timeMs || 0) / 1000;
        const total = scriptDuration(sh.script?.steps);
        const left = total ? Math.max(0, total - secs) : null;
        running.hidden = false;
        running.className = 'dash-running';
        running.replaceChildren(h('div', { class: 'run-title' }, icon('play', 's18'), sh.script?.title || t('home.status.manualShot')),
          h('div', { class: 'muted small' }, left !== null ? t('home.status.elapsedLeft', { secs: fmt(secs, 0), left: fmt(left, 0) }) : `${fmt(secs, 0)} s`),
          total ? targetBar(Math.min(secs, total), total, { max: total }) : null);
      } else if (m.lastFault) {
        running.hidden = false;
        running.className = 'dash-running fault';
        running.replaceChildren(h('div', { class: 'run-title' }, icon('warn', 's18'), m.lastFault.text), h('div', { class: 'muted small' }, ago(m.lastFault.at)));
      } else {
        running.hidden = true;
      }
      const on = m.online && m.statusKey !== 'off';
      meters.replaceChildren(
        on && m.temp.groupSet ? meter(t('home.status.group'), `${fmt(m.temp.group)} / ${fmt(m.temp.groupSet)} °C`, targetBar(m.temp.group, m.temp.groupSet, { max: m.temp.groupSet + 5, heating: true })) : null,
        on && m.temp.boilerSet ? meter(t('home.status.boiler'), `${fmt(m.temp.boiler)} / ${fmt(m.temp.boilerSet)} °C`, targetBar(m.temp.boiler, m.temp.boilerSet, { max: m.temp.boilerSet + 5, heating: true })) : null,
        on && m.steamOn ? meter(t('home.status.steamBoiler'), `${fmt(m.pressure.steam, 2)} / ${fmt(m.pressure.steamSet, 1)} bar`, targetBar(m.pressure.steam, m.pressure.steamSet, { max: (m.pressure.steamSet || 1.5) * 1.3, heating: true })) : null);
      const today = new Date().toDateString();
      const n = shots.filter((s) => new Date(s.endedAt).toDateString() === today).length;
      chips.replaceChildren(
        m.tankOk === false ? h('span', { class: 'badge bad' }, t('home.status.tankEmpty')) : m.tankOk ? h('span', { class: 'badge ok' }, t('home.status.tankOk')) : null,
        h('span', { class: 'badge' }, m.steamOn ? (m.steamReady ? t('home.status.steamReady') : t('home.status.steamHeating')) : t('home.status.steamOff')),
        // Alte Xenia (DBL): verbundene Bluetooth-Waage
        m.online && m.scaleLink?.connected && !isHidden('scale') ? h('span', { class: 'badge ok' }, t('home.status.scaleConnected')) : null,
        h('span', { class: 'badge' }, t('home.status.shotsToday', { n, count: fmtInt(n) })));
      return {};
    },
  };
}

function gaugesTile({ arr } = {}) {
  const pressure = createGauge({ title: t('home.gauges.pressure'), min: 0, max: 12, majorStep: 2, minorStep: 0.5, redFrom: 11, digits: 1, unit: 'bar', mano: { max: 16, majorStep: 2, minorStep: 1, labelEvery: 2, label: 'POMPA' } });
  const temp = createGauge({ title: t('home.gauges.group'), min: 20, max: 110, majorStep: 10, minorStep: 2.5, redFrom: 100, digits: 1, labelEvery: 20, unit: '°C', mano: { min: 0, max: 120, majorStep: 20, minorStep: 5, labelEvery: 20, label: 'GRUPPO' } });
  const boiler = createGauge({ title: t('home.gauges.boiler'), min: 20, max: 110, majorStep: 10, minorStep: 2.5, redFrom: 100, digits: 1, labelEvery: 20, unit: '°C', mano: { min: 0, max: 120, majorStep: 20, minorStep: 5, labelEvery: 20, label: 'CAFFÈ' } });
  const steam = createGauge({ title: t('home.gauges.steamBoiler'), min: 0, max: 2.5, majorStep: 0.5, minorStep: 0.1, redFrom: 2, digits: 2, labelEvery: 1, unit: 'bar', mano: { max: 3, majorStep: 0.5, minorStep: 0.1, labelEvery: 0.5, label: 'CALDAIA' } });
  // Die Manometer füllen die Fläche der Kachel: je nach Breite und Höhe in einer Reihe (4 × 1) oder als 2 × 2,
  // je nachdem, was größere Instrumente ergibt. So geht die Kachel bis auf Höhe 1 (flachste Version: kleine Reihe).
  const grid = h('div', { class: 'gauges dash-gauges' }, pressure, temp, boiler, steam);
  const fit = h('div', { class: 'gauge-fit' }, grid);
  const OVER = 54; // Titel über und Messwert unter jedem Manometer (px)
  const GAPX = 6;
  const GAPY = 8;
  const arrange = () => {
    const W = fit.clientWidth;
    const H = fit.clientHeight;
    if (!W) return;
    if (fit.closest('.dash.single')) {
      // Handy: Höhe nach Inhalt; Anordnung in „Home anpassen“ wählbar (Standard 1 × 4, sonst 2 × 2)
      const c = arr === 2 ? 2 : 4;
      const size = Math.floor(Math.min((W - GAPX * (c - 1)) / c - 8, 200));
      grid.style.setProperty('grid-template-columns', `repeat(${c}, minmax(0, 1fr))`);
      grid.style.setProperty('--gsize', `${size}px`);
      grid.classList.toggle('tiny', size < 90);
      return;
    }
    if (!H) return;
    let best = null;
    for (const [c, r] of [[4, 1], [2, 2]]) {
      const size = Math.min((W - GAPX * (c - 1)) / c, (H - r * OVER - GAPY * (r - 1)) / r, 220);
      if (!best || size > best.size) best = { c, size };
    }
    const size = Math.max(36, Math.floor(best.size));
    grid.style.setProperty('grid-template-columns', `repeat(${best.c}, minmax(0, 1fr))`);
    grid.style.setProperty('--gsize', `${size}px`);
    grid.classList.toggle('tiny', size < 90);
  };
  new ResizeObserver(arrange).observe(fit);
  return {
    body: fit,
    update({ m }) {
      if (!m) return {};
      // Ziele immer zeigen (Druck: eingestellter Pumpendruck; Dampf auch bei ausgeschaltetem Kessel)
      pressure.update(m.pressure.pump, m.pressure.pumpSet ? t('home.gauges.targetBar', { v: fmt(m.pressure.pumpSet) }) : 'bar');
      temp.update(m.temp.group, m.temp.groupSet ? t('home.gauges.targetTemp', { v: fmt(m.temp.groupSet) }) : '°C');
      boiler.update(m.temp.boiler, m.temp.boilerSet ? t('home.gauges.targetTemp', { v: fmt(m.temp.boilerSet) }) : '°C');
      steam.update(m.pressure.steam, m.pressure.steamSet ? (m.steamOn ? t('home.gauges.targetBar', { v: fmt(m.pressure.steamSet, 1) }) : t('home.gauges.steamOffTarget', { v: fmt(m.pressure.steamSet, 1) })) : (m.steamOn ? 'bar' : t('home.gauges.off')));
      return {};
    },
  };
}

function lastShotTile({ wide }) {
  // Kurve füllt den Platz der gewählten Höhe (wie der Verlauf), statt selbst eine Höhe vorzugeben – sonst wüchse die
  // Kachel über die eingestellte Höhe hinaus
  const head = h('div', {});
  const fit = h('div', { class: 'chart-fit' });
  let curve = null;
  const draw = () => {
    if (!curve) return fit.replaceChildren();
    const bw = fit.clientWidth;
    const bh = fit.clientHeight;
    const size = bw > 50 && bh > 30 ? { width: Math.round(bw * 0.7), height: Math.round(bh * 0.7) } : { width: wide ? 560 : 320, height: wide ? 160 : 130 };
    fit.replaceChildren(shotChart(curve, { ...size, minSeconds: 20 }));
  };
  return {
    body: [head, fit],
    update({ m }) {
      const ls = m?.lastShot;
      if (!ls) {
        curve = null;
        head.replaceChildren(h('div', { class: 'empty' }, t('home.lastShot.none')));
        draw();
        return {};
      }
      const met = shotMetrics(ls);
      const ratio = met.ratio;
      const amount = met.yieldG ? [fmt(met.yieldG), 'g'] : ls.volumeMl ? [fmt(ls.volumeMl, 0), 'ml'] : ['–', ''];
      head.replaceChildren(
        h('div', { class: 'dash-kpis' }, kpi(t('home.kpi.time'), fmt(met.timeS), 's'), kpi(t('home.kpi.amount'), amount[0], amount[1], 'w'),
          ratio ? kpi(t('home.kpi.ratio'), `1:${fmt(ratio)}`, '') : kpi(t('home.kpi.maxPressure'), fmt(ls.maxPressure), 'bar', 'pu')),
        ls.curve?.length > 1 ? null : h('p', { class: 'muted small' }, t('home.lastShot.noCurve')));
      curve = ls.curve?.length > 1 ? ls.curve : null;
      draw();
      if (curve && !fit.clientHeight) requestAnimationFrame(draw); // erst nach dem Einfügen messbar
      return { extra: `${ls.notes?.rating ? `${'★'.repeat(ls.notes.rating)} · ` : ''}${ls.estimated ? t('home.lastShot.agoEstimated', { ago: ago(ls.endedAt) }) : ago(ls.endedAt)}` };
    },
  };
}

function lastGrindTile() {
  const box = h('div', {});
  return {
    body: box,
    update({ g }) {
      if (!g) {
        box.replaceChildren(h('div', { class: 'empty' }, t('home.grind.notSetUp')));
        return {};
      }
      const last = g.grinds?.[0] || g.stats?.lastGrind;
      if (!last) {
        box.replaceChildren(h('div', { class: 'empty' }, g.online ? t('home.grind.none') : t('home.grind.offline')));
        return {};
      }
      const recipe = g.recipes?.find((r) => r.index === last.recipe);
      box.replaceChildren(
        h('div', { class: 'big-row' },
          h('div', { class: 'big' }, last.success && last.weightG ? fmt(last.weightG) : '–', h('span', { class: 'unit' }, ' g')),
          h('div', { class: 'muted' }, last.targetG ? t('home.grind.target', { v: fmt(last.targetG) }) : last.mode === 'ByTime' ? t('home.grind.byTime') : '')),
        last.success && last.weightG ? targetBar(last.weightG, last.targetG) : h('span', { class: 'badge bad' }, t('home.grind.aborted')),
        h('div', { class: 'chips' },
          h('span', { class: 'badge' }, `${fmt(last.durationMs / 1000)} s`),
          last.recipe ? h('span', { class: 'badge' }, recipe?.type ? t('home.grind.recipeType', { n: last.recipe, type: TYPE_DE[recipe.type] || recipe.type }) : t('home.grind.recipe', { n: last.recipe })) : null,
          TRIGGER_DE[last.trigger] ? h('span', { class: 'badge' }, TRIGGER_DE[last.trigger]) : null,
          last.ddd != null ? h('span', { class: 'badge' }, `${fmtInt(last.ddd)} µm`) : null,
          last.gbs ? h('span', { class: 'badge ok' }, t('home.grind.gbs')) : null,
          !g.online ? h('span', { class: 'badge bad' }, t('home.grind.offlineBadge')) : null));
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
        days.push({ key: d.toDateString(), label: i === 0 ? t('home.week.today') : d.toLocaleDateString(locale(), { weekday: 'short' }).replace('.', ''), value: 0, cls: i === 0 ? 'now' : '' });
      }
      for (const s of shots) {
        const day = days.find((d) => d.key === new Date(s.endedAt).toDateString());
        if (day) day.value++;
      }
      const sum = days.reduce((a, d) => a + d.value, 0);
      box.replaceChildren(sum ? barChart(days) : h('div', { class: 'empty' }, t('home.week.none')));
      return { extra: t('home.week.sum', { n: fmtInt(sum) }) };
    },
  };
}

function shotTimesTile() {
  const box = h('div', {});
  return {
    body: box,
    update({ shots }) {
      const list = shots.filter((s) => !s.estimated && brewSeconds(s) > 0).slice(0, 12).reverse();
      if (!list.length) {
        box.replaceChildren(h('div', { class: 'empty' }, t('home.shotTimes.none')));
        return {};
      }
      const avg = list.reduce((a, s) => a + brewSeconds(s), 0) / list.length;
      box.replaceChildren(barChart(list.map((s, i) => ({
        value: brewSeconds(s),
        label: new Date(s.endedAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }),
        cls: i === list.length - 1 ? 'now' : '',
      })), { unit: 's' }));
      return { extra: t('home.shotTimes.avg', { v: fmt(avg, 0) }) };
    },
  };
}

function grindsTile() {
  const box = h('div', {});
  return {
    body: box,
    update({ g }) {
      if (!g) {
        box.replaceChildren(h('div', { class: 'empty' }, t('home.grind.notSetUp')));
        return {};
      }
      // Spülen/abgebrochene Mahlvorgänge (unter halbem Ziel) verzerren die Skala und sagen über die Genauigkeit nichts
      const list = (g.grinds || []).filter((x) => x.success && x.weightG >= 1 && (!x.targetG || x.weightG >= x.targetG / 2)).slice(0, 12).reverse();
      if (!list.length) {
        box.replaceChildren(h('div', { class: 'empty' }, t('home.grind.none')));
        return {};
      }
      box.replaceChildren(barChart(list.map((x) => {
        const off = x.targetG ? Math.abs(x.weightG - x.targetG) / x.targetG : null;
        return { value: x.weightG, mark: x.targetG, label: x.recipe ? t('home.grind.recipeShort', { n: x.recipe }) : '', cls: off === null ? '' : off <= 0.03 ? 'ok' : off <= 0.08 ? 'warn' : 'bad' };
      }), { unit: 'g', digits: 1 }), h('div', { class: 'legend muted small' }, h('span', { class: 'mark-key' }), t('home.grind.legendTarget'), h('span', { class: 'sw ok' }), '±3 %', h('span', { class: 'sw warn' }), '±8 %'));
      const dev = g.stats?.avgDeviationG;
      return { extra: dev !== null && dev !== undefined ? t('home.grind.avgDeviation', { v: fmt(dev, 2) }) : '' };
    },
  };
}

function grinderTile() {
  const box = h('div', {});
  return {
    body: box,
    update({ g }) {
      if (!g) {
        box.replaceChildren(h('div', { class: 'empty' }, t('home.grind.notSetUp')));
        return {};
      }
      const st = g.stats || {};
      const alerts = (g.alerts || []).filter((a) => a.active);
      const recipe = g.recipes?.find((r) => r.selected);
      box.replaceChildren(
        h('div', { class: 'dash-kpis' },
          kpi(t('home.kpi.grinds'), fmtInt(st.today ?? 0), ''),
          kpi(t('home.kpi.coffee'), fmt(st.todayCoffeeG ?? 0), 'g'),
          kpi(t('home.kpi.total'), fmtInt(st.totalGrinds ?? 0), '')),
        h('div', { class: 'chips' },
          h('span', { class: `badge ${g.online ? 'ok' : 'bad'}` }, g.online ? t('home.grind.online') : t('home.grind.offlineBadge')),
          recipe ? h('span', { class: 'badge' }, t('home.grind.recipeSelected', { n: recipe.index })) : null,
          ...alerts.slice(0, 3).map((a) => h('span', { class: 'badge warn' }, ALERT_TEXT[a.type] || a.type))));
      return { extra: g.lastSync ? t('home.grind.syncedAgo', { ago: ago(g.lastSync) }) : '' };
    },
  };
}

// Verlauf der letzten 10 Minuten; darunter lassen sich alle Sensorwerte aufklappen (die Kachel wächst dann mit)
function liveTile({ wide, h: rows, relayout }) {
  const box = h('div', { class: 'chart-fit' }); // füllt die Kachel; Höhe kommt aus der gewählten Zellenzahl
  const legend = h('div', { class: 'legend muted small' }, SERIES.map((s) => [h('span', { class: `sw ${s.cls}` }), s.label]));
  const values = h('dl', { class: 'kv live-values', hidden: true, 'data-noanim': '' }); // eigene Animation (siehe unten)
  const toggle = h('button', { class: 'tab-mini', type: 'button', 'aria-expanded': 'false', onclick: (e) => {
    e.stopPropagation();
    const tile = toggle.closest('.tile');
    const opening = values.hidden;
    toggle.setAttribute('aria-expanded', String(opening));
    toggle.lastChild.textContent = opening ? t('home.live.hideAll') : t('home.live.showAll');
    const ease = { duration: 180, easing: 'cubic-bezier(.2, 0, 0, 1)' };
    if (opening) {
      // Diagramm behält seine Höhe; die Kachel wächst animiert, dann blenden die Werte ein
      box.style.minHeight = `${box.clientHeight}px`;
      fill(store.machine); // sofort füllen, nicht erst mit der nächsten Statusmeldung
      if (relayout) relayout(() => { values.hidden = false; }); else values.hidden = false;
      values.animate?.([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], ease);
      setTimeout(() => fitIntoView(tile, 1), 280); // beim Einblenden nur nach unten scrollen
    } else {
      // erst die Werte ausblenden, dann schrumpft die Kachel animiert
      const out = values.animate?.([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-6px)' }], ease);
      const done = () => {
        const hideValues = () => { values.hidden = true; box.style.minHeight = ''; };
        if (relayout) relayout(hideValues); else hideValues();
        setTimeout(() => fitIntoView(tile, -1), 280); // beim Ausblenden nur nach oben scrollen
      };
      if (out) out.onfinish = done; else done();
    }
  } }, icon('more', 's18'), h('span', {}, t('home.live.showAll')));
  const row = (k, v) => [h('dt', {}, k), h('dd', {}, v)];
  return {
    body: [box, h('div', { class: 'live-foot' }, legend, toggle), values],
    update({ m }) {
      // Diagramm im Seitenverhältnis der Kachel zeichnen (Faktor 0,6 → Schrift und Linien etwa 1,7-fach), damit
      // es die Fläche füllt, ohne die Beschriftung zu verkleinern
      const bw = box.clientWidth, bh = box.clientHeight;
      const size = bw > 50 && bh > 30 ? { width: Math.round(bw * 0.6), height: Math.round(bh * 0.6) } : { width: wide ? 640 : 320, height: (wide ? 200 : 150) + extraH(rows) };
      box.replaceChildren(liveChart(liveHistory, SERIES, { ...size, spanMs: 10 * 60e3 }));
      if (!values.hidden) fill(m);
      return {};
    },
  };
  function fill(m) {
      if (m) {
        values.replaceChildren(
          ...row(t('home.live.group'), t('home.live.tempValue', { v: fmt(m.temp.group), set: fmt(m.temp.groupSet) })),
          ...row(t('home.live.boiler'), t('home.live.tempValue', { v: fmt(m.temp.boiler), set: fmt(m.temp.boilerSet) })),
          ...row(t('home.live.pump'), `${fmt(m.pressure.pump)} bar`),
          ...row(t('home.live.steamBoiler'), m.steamOn ? t('home.live.steamOnValue', { v: fmt(m.pressure.steam, 2), set: fmt(m.pressure.steamSet) }) : t('home.live.steamOffValue', { set: fmt(m.pressure.steamSet) })),
          ...row(t('home.live.heating'), `${fmt(m.power?.group, 0)} % / ${fmt(m.power?.boiler, 0)} %`),
          ...row(t('home.live.pumpPower'), `${fmt(m.power?.pump, 0)} %`),
          ...(isHidden('scale') ? [] : row(t('home.live.scale'), `${fmt(m.scale?.weight)} g · ${fmt(m.scale?.rate)} g/s`)),
          // Die alte Xenia (DBL) hat keinen Durchflussmesser (Felder stehen immer auf 0)
          ...(isClassic() ? [] : row(t('home.live.flow'), `${fmt(m.flow?.ml ?? m.flow?.volume, 0)} ml · ${fmt(m.flow?.rate)} ml/s`)),
          ...row(t('home.live.tank'), m.tankOk === false ? t('home.live.tankEmpty') : m.tankOk ? t('home.live.tankOk') : '–'));
      }
  }
}

// Element so scrollen, dass es zwischen Kopfleiste und unterer Leiste ganz sichtbar ist; ist es höher als der
// verfügbare Platz, steht sein Kopf direkt unter der Kopfleiste
function fitIntoView(el, dir = 0) {
  if (!el) return;
  const top = (document.querySelector('.topbar')?.getBoundingClientRect().bottom || 64) + 8;
  const nav = document.getElementById('navbar')?.getBoundingClientRect();
  const bottom = (nav && nav.top > window.innerHeight / 2 ? nav.top : window.innerHeight) - 8;
  const r = el.getBoundingClientRect();
  let dy = 0;
  if (r.height > bottom - top || r.top < top) dy = r.top - top;
  else if (r.bottom > bottom) dy = r.bottom - bottom;
  if (dir > 0) dy = Math.max(0, dy); // nur nach unten
  if (dir < 0) dy = Math.min(0, dy); // nur nach oben
  if (Math.abs(dy) > 2) window.scrollBy({ top: dy, behavior: 'smooth' });
}

// Sollwerte: Brühgruppe, Brühkessel, Dampfdruck mit − / +; gespeichert wird 1,5 s nach dem letzten Tipp.
// Ein gespeicherter Wert bleibt stehen, bis die Maschine ihn meldet (höchstens 8 s).
function targetsTile() {
  const rows = [
    { key: 'BG_SET_TEMP', label: t('home.targets.group'), min: 60, max: 96, step: 0.5, unit: '°C', read: (m) => m.temp.groupSet },
    { key: 'BB_SET_TEMP', label: t('home.targets.boiler'), min: 60, max: 96, step: 0.5, unit: '°C', read: (m) => m.temp.boilerSet },
    { key: 'SB_SET_PRESS', label: t('home.targets.steamPressure'), min: 0, max: 1.8, step: 0.1, unit: 'bar', read: (m) => m.pressure?.steamSet },
  ].map((r) => {
    const st = { ...r, value: null, timer: null, hold: null };
    const val = h('button', { class: 'tgt-val num', type: 'button', title: t('home.targets.enterValue'), onclick: async (e) => {
      e.stopPropagation();
      const n = await promptNumber(r.label, { value: st.value, min: r.min, max: r.max, step: 0.1, unit: r.unit });
      if (n === null || Number.isNaN(n)) return;
      set(Math.round(n * 10) / 10, 0);
    } }, '–');
    const set = (v, delay = 1500) => {
      st.value = Math.round(Math.min(r.max, Math.max(r.min, v)) * 10) / 10;
      val.textContent = `${fmt(st.value)} ${r.unit}`;
      clearTimeout(st.timer);
      st.timer = setTimeout(async () => {
        st.timer = null;
        try {
          await api('/api/machine/settings', { method: 'POST', body: { changes: { [r.key]: st.value } } });
          st.hold = { value: st.value, until: Date.now() + 8000 };
          snackbar(t('home.targets.saved', { label: r.label, value: fmt(st.value), unit: r.unit }));
        } catch (e) { snackbar(e.message); }
      }, delay);
    };
    st.el = h('div', { class: 'tgt-row' }, h('span', { class: 'grow' }, r.label),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('home.targets.decrease', { label: r.label }), onclick: (e) => { e.stopPropagation(); if (st.value !== null) set(st.value - r.step); } }, icon('more', 's20')),
      val,
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('home.targets.increase', { label: r.label }), onclick: (e) => { e.stopPropagation(); if (st.value !== null) set(st.value + r.step); } }, icon('less', 's20')));
    st.val = val;
    return st;
  });
  return {
    body: h('div', { class: 'tgt-list' }, rows.map((r) => r.el)),
    update({ m }) {
      if (!m) return {};
      for (const r of rows) {
        const v = r.read(m);
        if (r.hold && (v === r.hold.value || Date.now() > r.hold.until)) r.hold = null;
        if (!r.timer && !r.hold && v !== null && v !== undefined) {
          r.value = v;
          r.val.textContent = `${fmt(v)} ${r.unit}`;
        }
      }
      return { extra: m.online ? null : h('span', { class: 'badge bad' }, t('home.targets.offline')) };
    },
  };
}

// Pflege: Tage seit dem letzten Backflush als Ring (voll = fällig)
function careTile() {
  const box = h('div', {});
  return {
    body: box,
    update({ maint: b }) {
      if (!b) return { hidden: true };
      const pct = b.daysSince === null ? 1 : Math.min(1, b.daysSince / b.intervalDays);
      box.replaceChildren(h('div', { class: `care-row ${b.due ? 'due' : ''}` },
        ring(pct, b.daysSince === null ? '–' : `${b.daysSince} d`),
        h('div', {},
          h('div', { class: 'label' }, b.due ? t('home.care.due') : t('home.care.ok')),
          h('div', { class: 'muted small' }, b.lastAt ? t('home.care.since', { shots: fmtInt(b.shotsSince), days: b.intervalDays }) : t('home.care.never')))));
      return { extra: b.due ? h('span', { class: 'badge warn' }, t('home.care.dueBadge')) : '' };
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
