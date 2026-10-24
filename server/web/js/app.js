// App-Start: Login, Navigation, Live-Verbindung, Service Worker, Shortcuts.
import { h, icon, snackbar } from './ui.js';
import { api, store, subscribe, connect, disconnect, setUnauthorizedHandler, refreshState, directMode } from './api.js';
import { homeView } from './views/home.js';
import { dashboardView } from './views/dashboard.js';
import { scriptsView } from './views/scripts.js';
import { controlsView } from './views/controls.js';
import { shotsView } from './views/shots.js';
import { timerView } from './views/timer.js';
import { grinderView } from './views/grinder.js';
import { settingsView } from './views/settings.js';
import { serverView } from './views/server.js';
import { showSetup } from './setup.js';
import { quickRate } from './views/shot-detail.js';

const ROUTES = [
  { path: '/dashboard', label: 'Dashboard', icon: 'dashboard', view: dashboardView, title: 'Dashboard', wide: true },
  { path: '/', label: 'Home', icon: 'home', view: homeView, title: 'Xenios' },
  { path: '/skripte', label: 'Skripte', icon: 'list', view: scriptsView, title: 'Skripte' },
  { path: '/steuerung', label: 'Steuerung', icon: 'tune', view: controlsView, title: 'Steuerung' },
  { path: '/timer', label: 'Timer', icon: 'event', view: timerView, title: 'Timer' },
  { path: '/muehle', label: 'Mühle', icon: 'grinder', view: grinderView, title: 'Mühle' },
  { path: '/bezuege', label: 'Bezüge', icon: 'coffee', view: shotsView, title: 'Bezüge', nav: false },
  // Einstellungen über das Zahnrad oben rechts, nicht in der unteren Leiste
  { path: '/einstellungen', label: 'Einstellungen', icon: 'settings', view: settingsView, title: 'Einstellungen', nav: false },
  { path: '/server', label: 'Server', icon: 'shield', view: serverView, title: 'Server & Sicherheit', nav: false, back: '/einstellungen' },
];

const $ = (id) => document.getElementById(id);
let current = null;      // { route, dispose }

// --- Darstellung --------------------------------------------------------------
export function applyTheme(theme = localStorageGet('theme') || 'system') {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#121318' : '#fbf8ff'));
}
export function localStorageGet(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}
export function localStorageSet(k, v) {
  try { localStorage.setItem(k, v); } catch { /* privat */ }
}
applyTheme();

// --- Navigation ---------------------------------------------------------------
function buildNav() {
  $('settings-btn').replaceChildren(icon('settings'));
  $('back-btn').replaceChildren(icon('left'));
  $('settings-btn').onclick = () => navigate('/einstellungen');
  const inner = h('div', { class: 'navbar-inner' }, ROUTES.filter((r) => r.nav !== false).map((r) =>
    h('button', { class: 'nav-item', dataset: { path: r.path }, onclick: () => navigate(r.path) },
      h('span', { class: 'pill' }, icon(r.icon)), r.label)));
  $('navbar').replaceChildren(inner);
}

export function navigate(path, { replace = false } = {}) {
  if (location.pathname !== path) history[replace ? 'replaceState' : 'pushState']({}, '', path);
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
  const route = ROUTES.find((r) => r.path === location.pathname) || ROUTES.find((r) => r.path === '/');
  current?.dispose?.();
  $('app').classList.toggle('wide', Boolean(route.wide));
  setTopActions();
  setTabs(null);
  $('title').textContent = route.title;
  $('back-btn').hidden = !route.back;
  $('back-btn').onclick = () => navigate(route.back);
  document.title = route.title === 'Xenios' ? 'Xenios' : `${route.title} · Xenios`;
  $('settings-btn').setAttribute('aria-pressed', String(route.path === '/einstellungen' || route.path === '/server'));
  document.querySelectorAll('.nav-item').forEach((b) => (b.dataset.path === route.path ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  const view = $('view');
  view.replaceChildren();
  view.scrollTop = 0;
  window.scrollTo(0, 0);
  // Einblend-Animation bei jedem Seitenwechsel neu starten
  view.classList.remove('enter');
  void view.offsetWidth;
  view.classList.add('enter');
  current = { route, dispose: route.view(view) };
}
window.addEventListener('popstate', render);

// Verbindungspunkt oben rechts
subscribe(() => {
  const dot = $('conn-dot');
  const m = store.machine;
  dot.className = 'conn-dot ' + (!store.connected ? 'bad' : m && !m.online ? 'warn' : 'ok');
  dot.title = !store.connected ? 'Keine Verbindung zum Server' : m && !m.online ? 'Maschine nicht erreichbar' : 'Verbunden';
});

// Ereignisse aus dem Server als Snackbar; nach einem Bezug mit „Bewerten“ (Einstell-Assistent)
subscribe((part, ev) => {
  if (part !== 'event' || !ev || ev.topic === 'grinder') return;
  if (ev.topic === 'shot' && ev.shotId) snackbar(`${ev.title} – ${ev.body}`, { action: 'Bewerten', onAction: () => quickRate(ev.shotId), duration: 15000 });
  else snackbar(`${ev.title} – ${ev.body}`);
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
  $('app').hidden = false;
  buildNav();
  // Erst den Zustand (u. a. Server-Features) holen, sonst fehlen beim direkten Aufruf einer Seite Bedienelemente
  await refreshState().catch(() => {});
  if (location.pathname === '/' && !location.search && localStorageGet('startPage') === '/dashboard') history.replaceState({}, '', '/dashboard');
  render();
  connect();
  $('splash').classList.add('hide');
  handleShortcut();
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
  history.replaceState({}, '', location.pathname);
  try {
    if (action === 'on') {
      await api('/api/machine/power', { method: 'POST', body: { mode: 'on' } });
      snackbar('Xenia wird eingeschaltet …');
    } else if (action === 'off') {
      await api('/api/machine/power', { method: 'POST', body: { mode: 'off' } });
      snackbar('Xenia ausgeschaltet');
    } else if (action === 'eco') {
      await api('/api/machine/power', { method: 'POST', body: { mode: 'eco' } });
      snackbar('Eco-Modus aktiv');
    } else if (action === 'steam') {
      await api('/api/machine/steam', { method: 'POST', body: { on: true } });
      snackbar('Dampfkessel an');
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

// --- Start ------------------------------------------------------------------------
(async () => {
  try {
    const s = await api('/auth/session');
    if (s.authenticated) await showApp();
    else if (s.setup) showSetupScreen();
    else showLogin();
  } catch {
    // Offline: App-Hülle zeigen, Verbindung wird erneut versucht
    showLogin({ offline: true });
    $('login-error').textContent = 'Server nicht erreichbar.';
  }
})();
