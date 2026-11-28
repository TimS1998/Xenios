import { pageEnter } from './motion.js'; // zuerst: animiertes Ein- und Ausblenden für die ganze App
// App-Start: Login, Navigation, Live-Verbindung, Service Worker, Shortcuts.
import { h, icon, snackbar, closeTopOverlay } from './ui.js';
import { api, store, subscribe, connect, disconnect, setUnauthorizedHandler, refreshState, directMode, hasGrinder, hasPaddle } from './api.js';
import { dashboardView } from './views/dashboard.js';
import { scriptsView, scriptNewView, scriptEditView, profileBuilderView, discoverView } from './views/scripts.js';
import { controlsView, paddleView } from './views/controls.js';
import { shotsView } from './views/shots.js';
import { timerView } from './views/timer.js';
import { grinderView } from './views/grinder.js';
import { settingsView, machineSettingsView, appearanceView, viewPrefsView, shotPrefsView, firmwareView } from './views/settings.js';
import { serverPage } from './views/server.js';
import { showSetup } from './setup.js';
import { quickRate, shotPageView } from './views/shot-detail.js';
import { hiddenTabs, onPrefs, powerOnBody } from './prefs.js';
import { t } from '../shared/i18n.js';

// Beschriftung (Leiste) und Titel (Kopfzeile) erst beim Gebrauch nachschlagen; Titel = Beschriftung, wenn nicht anders
function named(r, label, title = label, short) {
  Object.defineProperty(r, 'label', { get: label, enumerable: true });
  Object.defineProperty(r, 'title', { get: title, enumerable: true });
  if (short) Object.defineProperty(r, 'short', { get: short, enumerable: true });
  return r;
}
const ROUTES = [
  // Home ist das Dashboard (frühere eigene Startseite entfällt; /dashboard leitet hierher)
  named({ path: '/', icon: 'home', view: dashboardView, wide: true }, () => t('app.nav.home'), () => 'Xenios'),
  named({ path: '/bezuege', icon: 'coffeeLine', view: shotsView }, () => t('app.nav.shots')),
  named({ path: '/skripte', icon: 'list', view: scriptsView }, () => t('app.nav.scripts')),
  named({ path: '/steuerung', icon: 'toggleTile', view: controlsView, feature: 'settings' }, () => t('app.nav.controls')),
  named({ path: '/paddle', icon: 'speed', view: paddleView, feature: 'paddle' }, () => t('app.nav.paddle')),
  named({ path: '/timer', icon: 'event', view: timerView }, () => t('app.nav.timer')),
  named({ path: '/muehle', icon: 'grinder', view: grinderView }, () => t('app.nav.grinder')),
  // Einstellungen: immer in der Leiste, lässt sich nicht ausblenden
  named({ path: '/einstellungen', icon: 'settings', view: settingsView, fixed: true }, () => t('app.nav.settings'), undefined, () => t('app.nav.settingsShort')),
  named({ path: '/bezuege/bezug', icon: 'coffeeLine', view: shotPageView, nav: false, back: '/bezuege' }, () => t('app.nav.shot')),
  named({ path: '/skripte/neu', icon: 'add', view: scriptNewView, nav: false, back: '/skripte' }, () => t('app.nav.scriptNew')),
  named({ path: '/skripte/bearbeiten', icon: 'edit', view: scriptEditView, nav: false, back: '/skripte' }, () => t('app.nav.scriptEdit')),
  named({ path: '/skripte/profil', icon: 'profile', view: profileBuilderView, nav: false, back: '/skripte' }, () => t('app.nav.profileBuilder')),
  named({ path: '/skripte/entdecken', icon: 'explore', view: discoverView, nav: false, back: '/skripte' }, () => t('app.nav.discover')),
  // Unterseiten der Einstellungen; server: nur mit Server (nicht im Direkt-Modus der App)
  ...[
    ['darstellung', () => t('app.settingsPages.appearance'), appearanceView],
    ['ansicht', () => t('app.settingsPages.view'), viewPrefsView],
    ['temperaturen', () => t('app.settingsPages.temperatures'), machineSettingsView('temp')],
    ['bezuege', () => t('app.settingsPages.shots'), shotPrefsView],
    ['einschalten', () => t('app.settingsPages.power'), machineSettingsView('power')],
    ['modell', () => t('app.settingsPages.model'), serverPage('modell'), true],
    ['firmware', () => t('app.settingsPages.firmware'), firmwareView],
    ['muehle', () => t('app.settingsPages.grinder'), serverPage('muehle'), true],
    ['unterwegs', () => t('app.settingsPages.remote'), serverPage('unterwegs'), true],
    ['benachrichtigungen', () => t('app.settingsPages.notifications'), serverPage('benachrichtigungen'), true],
    ['sicherheit', () => t('app.settingsPages.security'), serverPage('sicherheit'), true],
    ['system', () => t('app.settingsPages.system'), serverPage('system'), true],
  ].map(([id, title, view, server]) => named({ path: `/einstellungen/${id}`, icon: 'settings', view, nav: false, back: '/einstellungen', server }, title)),
];
// Frühere Adressen der Einstellungen (Lesezeichen, alte Links)
const MOVED = { '/einstellungen/maschine': '/einstellungen/temperaturen', '/server': '/einstellungen', '/server#aufzeichnung': '/einstellungen/bezuege', '/einstellungen#aufzeichnung': '/einstellungen/bezuege' };

const $ = (id) => document.getElementById(id);

// Feste Texte in index.html (data-i18n, -placeholder, -aria-label, -title) aus dem Katalog setzen; der deutsche Text im
// HTML bleibt als Rückfall. Läuft beim Start, bevor Anmeldung bzw. App sichtbar werden.
const I18N_ATTRS = { 'data-i18n-placeholder': 'placeholder', 'data-i18n-aria-label': 'aria-label', 'data-i18n-title': 'title' };
export function applyI18n(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.getAttribute('data-i18n'));
  for (const [data, attr] of Object.entries(I18N_ATTRS)) {
    for (const el of root.querySelectorAll(`[${data}]`)) el.setAttribute(attr, t(el.getAttribute(data)));
  }
}
applyI18n();

let current = null;      // { route, dispose }

// --- Darstellung --------------------------------------------------------------
// Design „material“ (Standard, siehe uiPalette) oder „xenia“ (wie die Web-Oberfläche der Maschine); das Design legt
// Farben, Formen, Schrift, Navigation und Anzeigen fest. Dazu je Gerät: eigene Akzent-/Aktiv-Farbe, Hell/Dunkel und
// das Zifferblatt der Manometer. Hier nur die Standardfarben je Design.
export const THEME_DEFAULTS = { accent: { xenia: '#4f9a1c', material: '#4a5891' }, active: { xenia: '#f5862f', material: '#5c6bc0' } };
export function applyTheme(theme = localStorageGet('theme') || 'system') {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  // Design: Xenia (wie die Web-Oberfläche der Maschine) oder Material (Material 3: Leiste mit Beschriftung, runde
  // Formen, flache Anzeigen) – jeweils mit eigenen Farben
  const palette = uiPalette();
  root.dataset.style = palette;
  if (palette === 'material') root.dataset.palette = 'material';
  else delete root.dataset.palette;
  // Anzeigen: Farbvorlage Xenia → Manometer, Material → flache Anzeigen. Hell oder dunkel merkt sich jede Vorlage
  // für sich; ohne eigene Wahl folgen sie der Helligkeit (helle Ansicht → helle Anzeigen, dunkle → dunkle).
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.gauge = gaugeChoice(palette) || (dark ? 'black' : 'white');
  const setColor = (name, onName, value, extra) => {
    if (!value) {
      for (const n of [name, onName, ...Object.keys(extra || {})]) root.style.removeProperty(n);
      return;
    }
    root.style.setProperty(name, value);
    root.style.setProperty(onName, contrastOn(value));
    for (const [n, v] of Object.entries(extra || {})) root.style.setProperty(n, v);
  };
  const accent = localStorageGet('accent');
  setColor('--primary', '--on-primary', accent, accent ? {
    '--primary-container': `color-mix(in srgb, ${accent} 18%, var(--surface-container-lowest))`,
    '--on-primary-container': `color-mix(in srgb, ${accent} 70%, var(--on-surface))`,
    '--success': accent,
  } : null);
  setColor('--active', '--on-active', localStorageGet('activeColor'));
  const bar = palette === 'material' ? (dark ? '#1b1b21' : '#2f3e74') : (dark ? '#2b2d34' : '#383c44');
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', bar));
  syncAppBars();
  sendAppTheme();
}

// Android-App: Zoom sperren (im Browser bleibt Zoomen erlaubt)
if (/XeniaApp\//.test(navigator.userAgent)) {
  document.querySelector('meta[name="viewport"]')?.setAttribute('content', 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
  document.documentElement.classList.add('in-app');
  // Strg/Cmd + Plus/Minus/0 und Strg + Mausrad (Tastatur oder Maus am Handy/Tablet)
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '0', 'Add', 'Subtract'].includes(e.key)) e.preventDefault();
  }, { capture: true });
  window.addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) e.preventDefault(); }, { capture: true, passive: false });
}

// Android-Widgets: Farben und Manometer-Design der App für hell und dunkel melden (aufgelöste Farben, #rrggbb).
// Die Widgets zeichnen sich damit wie die Kacheln; bei „System“ wechseln sie mit der Helligkeit des Handys.
const WIDGET_COLORS = {
  bg: '--surface-container-high', surface: '--surface', onSurface: '--on-surface', muted: '--on-surface-variant', primary: '--primary', onPrimary: '--on-primary',
  primaryContainer: '--primary-container', onPrimaryContainer: '--on-primary-container', secondaryContainer: '--secondary-container',
  onSecondaryContainer: '--on-secondary-container', outline: '--outline', outlineVariant: '--outline-variant', highest: '--surface-container-highest',
  danger: '--danger', onDanger: '--on-danger', dangerContainer: '--danger-container', success: '--success', warning: '--warning',
  active: '--active', onActive: '--on-active',
};
const GAUGE_COLORS = { face: '--gauge-face', ring: '--gauge-ring', tick: '--gauge-tick', needle: '--gauge-needle', text: '--gauge-text', ink: '--gauge-ink' };
function hexOf(css) {
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(css) || /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(css);
  if (!m) return null;
  const k = css.startsWith('color(') ? 255 : 1;
  return '#' + [m[1], m[2], m[3]].map((x) => Math.max(0, Math.min(255, Math.round(Number(x) * k))).toString(16).padStart(2, '0')).join('');
}
let appThemeTimer = 0;
export function sendAppTheme() {
  if (typeof window.XeniaApp?.setTheme !== 'function') return;
  clearTimeout(appThemeTimer);
  appThemeTimer = setTimeout(() => {
    const root = document.documentElement;
    const keep = { theme: root.dataset.theme, gauge: root.dataset.gauge };
    const palette = uiPalette();
    root.classList.add('no-trans'); // kurzes Umschalten hell/dunkel ohne Farbübergänge (kein Flackern)
    // Hilfselemente: Farbe über „color“ auflösen (auch color-mix); Manometer-Farben im Kontext eines Manometers
    const probe = h('div', { style: { position: 'absolute', visibility: 'hidden', pointerEvents: 'none' } });
    const gaugeBox = h('div', { class: `gauge${palette === 'material' ? '' : ' mano'}` });
    probe.append(gaugeBox);
    document.body.append(probe);
    const read = (host, map) => Object.fromEntries(Object.entries(map).map(([k, v]) => {
      const el = h('span', { style: { color: `var(${v})` } });
      host.append(el);
      const c = hexOf(getComputedStyle(el).color);
      el.remove();
      return [k, c];
    }).filter(([, c]) => c));
    const out = { mode: localStorageGet('theme') || 'system', palette, mano: palette !== 'material', noSteamOn: localStorageGet('powerNoSteam') === '1' };
    for (const mode of ['light', 'dark']) {
      root.dataset.theme = mode;
      const gauge = gaugeChoice(palette) || (mode === 'dark' ? 'black' : 'white');
      root.dataset.gauge = gauge;
      out[mode] = { gauge, colors: read(probe, WIDGET_COLORS), gaugeColors: read(gaugeBox, GAUGE_COLORS) };
    }
    if (keep.theme) root.dataset.theme = keep.theme; else delete root.dataset.theme;
    root.dataset.gauge = keep.gauge;
    probe.remove();
    getComputedStyle(root).color; // Stil übernehmen, bevor die Übergänge wieder gelten
    root.classList.remove('no-trans');
    try { window.XeniaApp.setTheme(JSON.stringify(out)); } catch { /* ältere App */ }
  }, 300);
}

// Farbvorlage: Material ist Standard
export function uiPalette() {
  return localStorageGet('uiStyle') === 'xenia' ? 'xenia' : 'material';
}
// Eigene Wahl der Anzeigen je Vorlage ('white' | 'black') oder null = folgt der Helligkeit
export const gaugeKey = (palette) => (palette === 'material' ? 'gaugeStyleMaterial' : 'gaugeStyle');
export function gaugeChoice(palette) {
  const v = localStorageGet(gaugeKey(palette));
  return v === 'white' || v === 'black' ? v : null;
}

// Systemleisten in den Farben der Seite: im Browser die Adressleiste (theme-color) wie die Kopfzeile,
// in der Android-App zusätzlich die Navigationsleiste wie die untere Leiste
let barsTimer = 0;
export function syncAppBars() {
  const send = () => {
    const color = (el) => {
      const m = el && /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(getComputedStyle(el).backgroundColor);
      if (!m || (m[4] !== undefined && Number(m[4]) < 0.5)) return null;
      return '#' + [m[1], m[2], m[3]].map((x) => Math.round(Number(x)).toString(16).padStart(2, '0')).join('');
    };
    const page = color(document.body) || color(document.documentElement) || '#ffffff';
    const nav = document.querySelector('.navbar');
    const r = nav?.getBoundingClientRect();
    const navAtBottom = r && r.width >= window.innerWidth - 2 && Math.abs(r.bottom - window.innerHeight) < 3; // breite Xenia-Ansicht: Leiste links
    const top = color(document.querySelector('.topbar')) || page;
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', top));
    if (typeof window.XeniaApp?.setBars !== 'function') return;
    try { window.XeniaApp.setBars(top, (navAtBottom && color(nav)) || page); } catch { /* ältere App */ }
  };
  requestAnimationFrame(send);
  clearTimeout(barsTimer);
  barsTimer = setTimeout(send, 400); // nach dem Farbübergang der Seite (0,3 s)
}
window.addEventListener('resize', () => syncAppBars());
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());
// Schrift auf einer Farbfläche: schwarz oder weiß, je nach Helligkeit
export function contrastOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.4 ? '#111111' : '#ffffff';
}
export function localStorageGet(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}
export function localStorageSet(k, v) {
  try { localStorage.setItem(k, v); } catch { /* privat */ }
}
// Einmalig (2.10.5): neue Standards übernehmen – Material, Anzeigen folgen der Helligkeit
if (localStorageGet('themeDefaults') !== '2') {
  for (const k of ['uiStyle', 'gaugeStyle', 'gaugeStyleMaterial']) { try { localStorage.removeItem(k); } catch { /* privat */ } }
  localStorageSet('themeDefaults', '2');
}
applyTheme();

// --- Navigation ---------------------------------------------------------------
// Alle Seiten, die in die untere Leiste können (die Mühle nur, wenn eingerichtet und nicht ausgeblendet)
// Ausgeschaltete Funktionen (Einstellungen → Sicherheit → Funktionen) blenden ihre Seiten aus: Paddle ohne
// Pumpensteuerung, Schalter (Tastenbelegung) ohne „Maschinen-Einstellungen ändern“.
export function routeAvailable(r) {
  if (r.path === '/muehle' && !hasGrinder()) return false;
  if (r.server && store.server?.mode === 'direct') return false;
  if (r.feature && store.server?.features?.[r.feature] === false) return false;
  if (r.path === '/paddle' && store.machine?.info && !hasPaddle()) return false; // erst entscheiden, wenn die Firmware bekannt ist
  return true;
}
export function navChoices() {
  return ROUTES.filter((r) => r.nav !== false && routeAvailable(r));
}

// Sichtbare Tabs: ohne die in den Einstellungen ausgeblendeten; „Einstellungen“ bleibt immer stehen
function navRoutes() {
  const hidden = hiddenTabs();
  return navChoices().filter((r) => r.fixed || !hidden.has(r.path));
}

function buildNav() {
  $('back-btn').replaceChildren(icon('left'));
  const routes = navRoutes();
  const cls = `navbar-inner${routes.length > 5 ? ' many' : ''}${routes.length > 7 ? ' lots' : ''}`;
  // Beschriftung mit Kurzform für schmale Leisten (CSS wählt, siehe .nav-label); voller Name als Tooltip/Screenreader
  const make = (r) => h('button', { class: 'nav-item', dataset: { path: r.path }, title: r.label, 'aria-label': r.label, onclick: () => navigate(r.path) },
    h('span', { class: 'pill' }, icon(r.icon)), h('span', { class: 'nav-label', 'aria-hidden': 'true' }, h('span', { class: 'full' }, r.label), h('span', { class: 'short' }, r.short || r.label)));
  const old = $('navbar').querySelector('.navbar-inner');
  if (!old || !old.isConnected || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    $('navbar').replaceChildren(h('div', { class: cls }, routes.map(make)));
    markNav();
    requestAnimationFrame(fitNavLabels);
    return;
  }
  // Leiste bleibt stehen: wegfallende Einträge schrumpfen weg, neue wachsen hinein, die übrigen rücken mit
  old.className = cls;
  const vertical = getComputedStyle(old).flexDirection.startsWith('column'); // linke Navigationsliste (breite Xenia-Ansicht)
  const prop = vertical ? 'maxHeight' : 'maxWidth';
  // Größe samt Innenabstand: sonst bleibt der Eintrag beim Schrumpfen am Innenabstand hängen und springt dann
  const pads = vertical ? ['paddingTop', 'paddingBottom'] : ['paddingLeft', 'paddingRight'];
  const minProp = vertical ? 'minHeight' : 'minWidth';
  const full = (b) => {
    const cs = getComputedStyle(b);
    return { [prop]: `${vertical ? b.offsetHeight : b.offsetWidth}px`, [pads[0]]: cs[pads[0]], [pads[1]]: cs[pads[1]], [minProp]: '0px', boxSizing: 'border-box' };
  };
  const none = { [prop]: '0px', [pads[0]]: '0px', [pads[1]]: '0px', [minProp]: '0px', boxSizing: 'border-box' };
  const ease = { duration: 280, easing: 'cubic-bezier(.2, 0, 0, 1)' };
  const keep = new Map([...old.children].filter((b) => !b.__leaving).map((b) => [b.dataset.path, b]));
  const want = new Set(routes.map((r) => r.path));
  for (const [path, b] of keep) {
    if (want.has(path)) continue;
    b.__leaving = true;
    b.style.pointerEvents = 'none';
    b.style.overflow = 'hidden';
    const a = b.animate([{ ...full(b), opacity: 1 }, { ...none, opacity: 0, transform: vertical ? 'translateX(-12px)' : 'translateY(12px)' }], { ...ease, fill: 'forwards' });
    a.onfinish = () => b.remove();
    // Sicherheitsnetz: läuft die Animation nicht zu Ende (App im Hintergrund, abgebrochen), trotzdem entfernen
    setTimeout(() => { if (b.__leaving && b.isConnected) b.remove(); }, 600);
  }
  // Bleibende Einträge nicht umstellen (sonst wandert ein wegfallender ans Ende); neue vor dem nächsten bleibenden einfügen
  routes.forEach((r, i) => {
    if (keep.has(r.path)) return;
    const b = make(r);
    const next = routes.slice(i + 1).map((x) => keep.get(x.path)).find(Boolean);
    old.insertBefore(b, next || null);
    b.style.overflow = 'hidden';
    const a = b.animate([{ ...none, opacity: 0, transform: vertical ? 'translateX(-12px)' : 'translateY(12px)' }, { ...full(b), opacity: 1 }], ease);
    a.onfinish = () => { b.style.overflow = ''; };
  });
  markNav();
  setTimeout(fitNavLabels, 320); // nach dem Ein-/Ausblenden der Einträge
}

// Passt ein voller Name nicht in seinen Platz (Schrift, Schriftgröße des Systems), Kurzformen zeigen
function fitNavLabels() {
  const inner = $('navbar')?.querySelector('.navbar-inner');
  if (!inner) return;
  inner.classList.remove('use-short');
  if (getComputedStyle(inner).flexDirection.startsWith('column')) return; // breite Xenia-Ansicht: Liste links
  const over = [...inner.querySelectorAll('.nav-label')].some((l) => l.scrollWidth > l.clientWidth + 1);
  inner.classList.toggle('use-short', over);
}
window.addEventListener('resize', () => requestAnimationFrame(fitNavLabels));
document.fonts?.ready?.then(() => fitNavLabels());

// Aktiven Tab markieren: nach jedem Seitenwechsel UND nach jedem Neuaufbau der Leiste (Server-Zustand, Einstellungen)
function markNav() {
  syncAppBars();
  const here = ROUTES.find((r) => r.path === location.pathname);
  const navPath = here?.navPath || here?.back || location.pathname;
  document.querySelectorAll('.nav-item').forEach((b) => (b.dataset.path === navPath ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
}

// Zurück (Android-Taste, Pfeil in der Kopfzeile): offenes Fenster schließen → vorige Seite im Verlauf (an die
// gemerkte Scrollposition) → … Ohne Verlauf (z. B. aus einem Widget geöffnet): übergeordnete Seite, dann Home.
// true = erledigt; false = schon auf Home ohne Verlauf (die App geht dann in den Hintergrund).
function goBack() {
  if (closeTopOverlay()) return true;
  if ((history.state?.d || 0) > 0) { history.back(); return true; }
  const route = current?.route;
  if (route?.back) { navigate(route.back, { replace: true }); return true; }
  if (location.pathname !== '/') { navigate('/', { replace: true }); return true; }
  return false;
}
window.xeniosBack = goBack;

// Titel der Kopfzeile überblenden (z. B. „Bezüge“ ↔ „Bezug“): alter und neuer Titel liegen übereinander,
// der alte blendet aus, der neue ein
function setTitle(text) {
  const el = $('title');
  if (el.dataset.text === text) return;
  el.dataset.text = text;
  const now = h('span', { class: 'tt' }, text);
  const old = [...el.childNodes];
  el.append(now);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !old.some((n) => n.textContent.trim())) {
    old.forEach((n) => n.remove());
    return;
  }
  const ease = { duration: 240, easing: 'cubic-bezier(.2, 0, 0, 1)' };
  for (const n of old) {
    if (!(n instanceof HTMLElement)) { n.remove(); continue; }
    n.getAnimations().forEach((a) => a.cancel());
    const a = n.animate([{ opacity: 1 }, { opacity: 0 }], { ...ease, fill: 'forwards' });
    a.onfinish = () => n.remove();
  }
  now.animate([{ opacity: 0 }, { opacity: 1 }], ease);
}

export function navigate(path, { replace = false } = {}) {
  const here = location.pathname + location.search + location.hash;
  if (here !== path) {
    const d = history.state?.d || 0;
    // Scrollposition der verlassenen Seite im Verlauf merken (für „Zurück“)
    if (!replace) history.replaceState({ ...(history.state || {}), d, y: window.scrollY }, '');
    history[replace ? 'replaceState' : 'pushState']({ d: replace ? d : d + 1, y: 0 }, '', path);
  }
  restoreY = null;
  render();
}

export function setTopActions(...nodes) {
  $('topbar-actions').replaceChildren(...nodes.filter(Boolean));
}
export function setTabs(tabs, active, onSelect) {
  const el = $('tabs');
  if (!tabs) {
    el.hidden = true;
    el.replaceChildren();
    return;
  }
  el.hidden = false;
  el.replaceChildren(...tabs.map((t) => h('button', { class: 'tab', role: 'tab', 'aria-selected': String(t.id === active), onclick: () => onSelect(t.id) }, t.label)));
}

function render() {
  if (location.pathname === '/dashboard') return navigate('/', { replace: true });
  const moved = MOVED[location.pathname + location.hash] || MOVED[location.pathname];
  if (moved) return navigate(moved, { replace: true });
  const want = ROUTES.find((r) => r.path === location.pathname);
  if (want && !routeAvailable(want)) return navigate(want.back || '/', { replace: true });
  const route = ROUTES.find((r) => r.path === location.pathname) || ROUTES.find((r) => r.path === '/');
  // Zurück im Verlauf: an die gemerkte Stelle der Seite
  const restore = restoreY;
  restoreY = null;
  current?.dispose?.();
  $('app').classList.toggle('wide', Boolean(route.wide));
  setTopActions();
  setTabs(null);
  setTitle(route.title);
  // Zurück-Pfeil weich ein-/ausblenden (Breite), damit der Titel nicht springt
  $('back-btn').classList.toggle('gone', !route.back);
  $('back-btn').onclick = () => goBack();
  document.title = route.title === 'Xenios' ? 'Xenios' : t('app.shell.pageTitle', { title: route.title });
  markNav();
  const view = $('view');
  view.replaceChildren();
  view.scrollTop = 0;
  window.scrollTo(0, 0);
  // Einblend-Animation bei jedem Seitenwechsel neu starten
  view.classList.remove('enter');
  pageEnter(view, !route.back);
  void view.offsetWidth;
  view.classList.add('enter');
  current = { route, dispose: route.view(view) };
  if (restore) {
    // Sofort an die alte Stelle, noch vor dem ersten Bild: die Seite bekommt vorübergehend genug Höhe, auch wenn ihre
    // Inhalte erst nachladen (sonst stünde sie kurz oben und spränge dann nach unten)
    view.style.minHeight = `${restore + window.innerHeight}px`;
    window.scrollTo(0, restore);
    setTimeout(() => { if (current?.route === route) view.style.minHeight = ''; }, 1500);
  } else {
    view.style.minHeight = '';
  }
}
// Ziel-Scrollposition beim Zurückgehen im Verlauf (popstate)
let restoreY = null;
// Scrollposition laufend im aktuellen Verlaufseintrag halten (auch für den Zurück-Knopf des Browsers)
let scrollSaveTimer = 0;
window.addEventListener('scroll', () => {
  clearTimeout(scrollSaveTimer);
  scrollSaveTimer = setTimeout(() => {
    if (history.state && typeof history.state === 'object') history.replaceState({ ...history.state, y: window.scrollY }, '');
  }, 200);
}, { passive: true });
if (typeof history.state?.d !== 'number') history.replaceState({ ...(history.state || {}), d: 0, y: 0 }, '');

// Aufgeklappte Kategorie (details.fold): passt sie unterhalb ihres Kopfes nicht mehr auf den Bildschirm, so weit
// hochscrollen, dass der Kopf direkt unter der Kopfleiste steht. Nachgeladener Inhalt wird kurz danach berücksichtigt.
document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (!(d instanceof HTMLDetailsElement) || !d.classList.contains('fold') || !d.open) return;
  const fit = () => {
    const top = (document.querySelector('.topbar')?.getBoundingClientRect().bottom || 64) + 8;
    const nav = $('navbar').getBoundingClientRect();
    const bottom = nav.top > window.innerHeight / 2 ? nav.top : window.innerHeight;
    const r = d.getBoundingClientRect();
    if (r.bottom > bottom && r.top > top) window.scrollBy({ top: Math.min(r.top - top, r.bottom - bottom), behavior: 'smooth' });
  };
  requestAnimationFrame(fit);
  setTimeout(fit, 450);
}, true);
window.addEventListener('popstate', (e) => { restoreY = e.state?.y || null; render(); });

// Leiste neu aufbauen, sobald sich die verfügbaren Seiten ändern (Funktionen, Mühle, Firmware der Maschine erkannt)
let navSig = '';
subscribe(() => {
  if (!window.__authed) return;
  const sig = navChoices().map((r) => r.path).join();
  if (sig === navSig) return;
  navSig = sig;
  buildNav();
});
onPrefs(() => {
  if (!window.__authed) return;
  buildNav();
});

// Verbindungspunkt oben rechts
subscribe(() => {
  const dot = $('conn-dot');
  const m = store.machine;
  dot.className = 'conn-dot ' + (!store.connected ? 'bad' : m && !m.online ? 'warn' : 'ok');
  dot.title = !store.connected ? t('app.conn.noServer') : m && !m.online ? t('app.conn.machineUnreachable') : t('app.conn.connected');
});

// Eingestelltes Modell passt nicht zur Maschine (Erkennung wie beim Verbindungstest): Hinweis oben auf jeder Seite,
// mit Umstellen auf das erkannte Modell
const MODEL_NAME = { get bbs() { return t('app.modelHint.bbs'); }, get classic() { return t('app.modelHint.classic'); } };
let modelHintKey = '';
subscribe(() => {
  const mm = window.__authed ? store.machine?.apiMismatch : null;
  const key = mm ? `${mm.configured}>${mm.detected}` : '';
  if (key === modelHintKey) return;
  modelHintKey = key;
  const box = $('model-hint');
  box.hidden = !mm;
  if (!mm) return box.replaceChildren();
  const fix = directMode ? null : h('button', { class: 'btn tonal', type: 'button', onclick: async () => {
    fix.disabled = true;
    try {
      await api('/api/admin/config', { method: 'PUT', body: { changes: { 'machine.api': mm.detected } } });
      await refreshState();
      snackbar(t('app.modelHint.switched', { model: MODEL_NAME[mm.detected] }));
      render(); // aktuelle Seite mit der richtigen Schnittstelle neu laden
    } catch (e) {
      snackbar(e.message);
      fix.disabled = false;
    }
  } }, t('app.modelHint.switchTo', { model: MODEL_NAME[mm.detected] }));
  box.replaceChildren(h('div', { class: 'note warn' }, icon('warn', 's18'), h('div', { class: 'grow' },
    h('div', {}, t('app.modelHint.mismatch', { configured: MODEL_NAME[mm.configured], detected: MODEL_NAME[mm.detected] })),
    directMode ? h('div', { class: 'small' }, t('app.modelHint.directHint')) : fix)));
});

// Ereignisse aus dem Server als Snackbar; nach einem Bezug mit „Bewerten“ (Einstell-Assistent)
subscribe((part, ev) => {
  if (part !== 'event' || !ev || ev.topic === 'grinder') return;
  if (ev.topic === 'shot' && ev.shotId) snackbar(t('app.events.message', { title: ev.title, body: ev.body }), { action: t('app.events.rate'), onAction: () => quickRate(ev.shotId), duration: 15000 });
  else snackbar(t('app.events.message', { title: ev.title, body: ev.body }));
});

// --- Login --------------------------------------------------------------------
// In der Android-App (WebView mit Brücke „XeniaApp“) meldet sich die App selbst an; dort deren Anmeldung öffnen.
export const inAndroidApp = () => typeof window.XeniaApp?.reauth === 'function';

function showLogin({ offline = false } = {}) {
  window.__authed = false;
  disconnect();
  if (inAndroidApp() && !offline) {
    window.XeniaApp.reauth();
    return;
  }
  $('app').hidden = true;
  $('setup').hidden = true;
  $('login').hidden = false;
  $('splash').classList.add('hide');
  setTimeout(() => $('login-password').focus(), 50);
}

function showSetupScreen() {
  window.__authed = false;
  $('app').hidden = true;
  $('login').hidden = true;
  $('setup').hidden = false;
  $('splash').classList.add('hide');
  showSetup($('setup'), { onDone: () => { $('setup').hidden = true; showApp(); } });
}

async function showApp() {
  window.__authed = true;
  $('login').hidden = true;
  // Erster Start: erst das Design wählen (Vollbild wie Anmeldung und Einrichtung), dann die App gleich im richtigen
  // Design aufbauen – Manometer bzw. flache Anzeigen legt eine Seite beim Aufbau fest
  await chooseDesignOnce();
  $('app').hidden = false;
  buildNav();
  // Erst den Zustand (u. a. Server-Features) holen, sonst fehlen beim direkten Aufruf einer Seite Bedienelemente
  await refreshState().catch(() => {});
  render();
  connect();
  $('splash').classList.add('hide');
  handleShortcut();
}

// --- Erster Start: Design wählen ----------------------------------------------------
// Einmal je Gerät (localStorage „designChosen“), als eigener Bildschirm nach der Anmeldung bzw. Verbindung und vor
// der Startseite. Die Wahl gilt sofort für diesen Bildschirm. Wer schon ein Design gewählt hat, wird nicht gefragt.
const DESIGN_PREVIEW = {
  material: '<svg viewBox="0 0 120 80" aria-hidden="true"><rect width="120" height="80" fill="#f4f3fa"/><rect width="120" height="13" fill="#2f3e74"/>'
    + '<rect x="7" y="18" width="50" height="30" rx="8" fill="#e3e2ec"/><rect x="63" y="18" width="50" height="30" rx="8" fill="#e3e2ec"/>'
    + '<rect x="13" y="26" width="20" height="3" rx="1.5" fill="#9a9bb0"/><rect x="13" y="37" width="38" height="4" rx="2" fill="#c8c8d8"/><rect x="13" y="37" width="26" height="4" rx="2" fill="#4a5891"/>'
    + '<rect x="69" y="26" width="20" height="3" rx="1.5" fill="#9a9bb0"/><rect x="69" y="37" width="38" height="4" rx="2" fill="#c8c8d8"/><rect x="69" y="37" width="14" height="4" rx="2" fill="#4a5891"/>'
    + '<rect x="7" y="52" width="106" height="9" rx="4.5" fill="#4a5891"/><rect y="65" width="120" height="15" fill="#e9e7ef"/>'
    + '<rect x="9" y="67" width="16" height="7" rx="3.5" fill="#dde1ff"/><circle cx="17" cy="70.5" r="2" fill="#2f3e74"/><circle cx="46" cy="70.5" r="2" fill="#5d5e72"/><circle cx="74" cy="70.5" r="2" fill="#5d5e72"/><circle cx="103" cy="70.5" r="2" fill="#5d5e72"/>'
    + '<rect x="11" y="76" width="12" height="1.6" rx=".8" fill="#5d5e72"/><rect x="40" y="76" width="12" height="1.6" rx=".8" fill="#5d5e72"/><rect x="68" y="76" width="12" height="1.6" rx=".8" fill="#5d5e72"/><rect x="97" y="76" width="12" height="1.6" rx=".8" fill="#5d5e72"/></svg>',
  xenia: '<svg viewBox="0 0 120 80" aria-hidden="true"><rect width="120" height="80" fill="#2b2d34"/><rect width="120" height="13" fill="#383c44"/><rect x="8" y="5" width="26" height="3" fill="#c9ccd3"/>'
    + '<circle cx="32" cy="33" r="14" fill="#f2f2f2" stroke="#8b8f98" stroke-width="1.5"/><circle cx="88" cy="33" r="14" fill="#f2f2f2" stroke="#8b8f98" stroke-width="1.5"/>'
    + '<path d="M22 41 A11 11 0 1 1 42 41" fill="none" stroke="#4f9a1c" stroke-width="1.6"/><path d="M78 41 A11 11 0 1 1 98 41" fill="none" stroke="#4f9a1c" stroke-width="1.6"/>'
    + '<line x1="32" y1="33" x2="39" y2="26" stroke="#d0342c" stroke-width="1.4"/><line x1="88" y1="33" x2="83" y2="24" stroke="#d0342c" stroke-width="1.4"/><circle cx="32" cy="33" r="1.8" fill="#333"/><circle cx="88" cy="33" r="1.8" fill="#333"/>'
    + '<rect x="8" y="52" width="50" height="9" rx="2" fill="#f5862f"/><rect x="62" y="52" width="50" height="9" rx="2" fill="#4a4e57"/><rect y="65" width="120" height="15" fill="#383c44"/>'
    + '<circle cx="15" cy="72.5" r="2.4" fill="#f5862f"/><circle cx="37" cy="72.5" r="2.4" fill="#c9ccd3"/><circle cx="60" cy="72.5" r="2.4" fill="#c9ccd3"/><circle cx="83" cy="72.5" r="2.4" fill="#c9ccd3"/><circle cx="105" cy="72.5" r="2.4" fill="#c9ccd3"/></svg>',
};
function chooseDesignOnce() {
  if (localStorageGet('designChosen')) return Promise.resolve();
  if (localStorageGet('uiStyle')) {
    localStorageSet('designChosen', '1');
    return Promise.resolve();
  }
  const opts = [
    ['material', t('app.design.materialTitle'), t('app.design.materialSub')],
    ['xenia', t('app.design.xeniaTitle'), t('app.design.xeniaSub')],
  ];
  return new Promise((resolve) => {
    const cards = opts.map(([id, title, sub]) => {
      const pv = h('span', { class: 'pv' });
      pv.innerHTML = DESIGN_PREVIEW[id]; // feste Grafik aus diesem Modul
      return h('button', { type: 'button', class: 'design-opt', role: 'radio', dataset: { id }, onclick: () => pick(id) },
        pv, h('span', { class: 't' }, title), h('span', { class: 's' }, sub));
    });
    const paint = () => cards.forEach((c) => c.setAttribute('aria-checked', String(c.dataset.id === uiPalette())));
    function pick(id) {
      localStorageSet('uiStyle', id);
      applyTheme();
      paint();
    }
    const screen = $('setup');
    const done = () => {
      localStorageSet('designChosen', '1');
      screen.hidden = true;
      screen.replaceChildren();
      resolve();
    };
    screen.replaceChildren(h('div', { class: 'setup-card design-card' },
      h('img', { src: '/icons/icon.svg', alt: '', class: 'login-icon', width: 56, height: 56 }),
      h('h1', {}, t('app.design.title')),
      h('p', { class: 'muted' }, t('app.design.intro')),
      h('div', { class: 'design-pick', role: 'radiogroup', 'aria-label': t('app.design.group') }, cards),
      h('div', { class: 'setup-nav' }, h('span'), h('button', { type: 'button', class: 'btn filled', onclick: done }, t('common.next')))));
    paint();
    $('app').hidden = true;
    screen.hidden = false;
    $('splash').classList.add('hide');
  });
}

setUnauthorizedHandler(() => showLogin());

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('login-submit');
  const err = $('login-error');
  err.textContent = '';
  btn.disabled = true;
  try {
    await api('/auth/login', { method: 'POST', body: { password: $('login-password').value, remember: $('login-remember').checked } });
    $('login-password').value = '';
    showApp();
  } catch (ex) {
    err.textContent = ex.message;
    $('login-form').classList.remove('shake');
    void $('login-form').offsetWidth;
    $('login-form').classList.add('shake');
  } finally {
    btn.disabled = false;
  }
});

export async function logout() {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  showLogin();
}

// --- App-Shortcuts (Langdruck auf das App-Symbol) ------------------------------
async function handleShortcut() {
  const params = new URLSearchParams(location.search);
  const action = params.get('do');
  if (!action) return;
  history.replaceState({ ...(history.state || {}), d: history.state?.d || 0 }, '', location.pathname);
  try {
    if (action === 'on') {
      const body = powerOnBody();
      await api('/api/machine/power', { method: 'POST', body });
      snackbar(body.steam === false ? t('app.shortcuts.turningOnNoSteam') : t('app.shortcuts.turningOn'));
    } else if (action === 'on-nosteam') {
      await api('/api/machine/power', { method: 'POST', body: { mode: 'on', steam: false } });
      snackbar(t('app.shortcuts.turningOnNoSteam'));
    } else if (action === 'off') {
      await api('/api/machine/power', { method: 'POST', body: { mode: 'off' } });
      snackbar(t('app.shortcuts.off'));
    } else if (action === 'eco') {
      await api('/api/machine/power', { method: 'POST', body: { mode: 'eco' } });
      snackbar(t('app.shortcuts.eco'));
    } else if (action === 'steam') {
      await api('/api/machine/steam', { method: 'POST', body: { on: true } });
      snackbar(t('app.shortcuts.steamOn'));
    }
  } catch (ex) {
    snackbar(ex.message);
  }
}

// --- Service Worker (Offline-Hülle, Push) --------------------------------------
window.addEventListener('xenia-error', (e) => snackbar(e.detail));

// Kein Service Worker im Direkt-Modus der App (Dateien kommen aus der APK)
if ('serviceWorker' in navigator && !directMode) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((e) => console.warn('SW', e));
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'navigate' && e.data.path) navigate(e.data.path);
  });
}

// Android-App: einmal je neuer Version auf ein App-Update hinweisen (die App prüft höchstens einmal am Tag von selbst)
function announceAppUpdate() {
  if (!window.__authed) return;
  let s;
  try { s = JSON.parse(window.XeniaApp.appUpdate()); } catch { return; }
  if (!s.available || s.phase || s.latestBuild === s.announced) return;
  try { window.XeniaApp.appUpdateSeen(s.latestBuild); } catch { /* egal */ }
  snackbar(t('app.android.updateAvailable', { version: s.latest }), { action: t('app.android.updateView'), onAction: () => navigate('/einstellungen'), duration: 10000 });
}
const appUpdates = typeof window.XeniaApp?.appUpdate === 'function';
if (appUpdates) window.addEventListener('xenios-app-update', announceAppUpdate);

// --- Start ------------------------------------------------------------------------
(async () => {
  try {
    const s = await api('/auth/session');
    if (s.authenticated) await showApp();
    else if (s.setup) showSetupScreen();
    else showLogin();
    // Notbetrieb der Android-App: Server weg, die App spricht die Maschine direkt an
    if (window.XeniaApp?.fallback?.()) {
      snackbar(t('app.android.fallback'), { action: t('app.android.fallbackServer'), onAction: () => window.XeniaApp.retryServer(), duration: 10000 });
    } else if (appUpdates) announceAppUpdate();
  } catch {
    // Offline: App-Hülle zeigen, Verbindung wird erneut versucht
    showLogin({ offline: true });
    $('login-error').textContent = t('app.login.serverUnreachable');
  }
})();
