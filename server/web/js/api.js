// Server-API, Live-Zustand (Server-Sent Events) und einfacher Store.

const listeners = new Set();
export const store = {
  machine: null,
  grinder: null,
  server: null,
  connected: false,
  lastUpdate: 0,
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(part) {
  store.lastUpdate = Date.now();
  for (const fn of listeners) {
    try { fn(part); } catch (e) { console.error(e); }
  }
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

// Direkt-Modus der Android-App: kein Server, die Geräte-Logik läuft hier im WebView (siehe direct/backend.js).
export const directMode = typeof window.XeniaApp?.mode === 'function' && window.XeniaApp.mode() === 'direct';
const directMod = directMode ? await import('./direct/backend.js') : null;
const backend = directMod ? directMod.createDirectBackend() : null;
let directUnsub = null;

// Downloads im Direkt-Modus: Links auf /api/… abfangen und über die App speichern
if (backend) {
  document.addEventListener('click', async (e) => {
    const a = e.target.closest?.('a[href^="/api/"]');
    if (!a) return;
    e.preventDefault();
    const r = await backend.handle('GET', a.getAttribute('href'));
    if (r.download) directMod.saveDownload(r.download);
    else if (r.data?.error) window.dispatchEvent(new CustomEvent('xenia-error', { detail: r.data.error }));
  });
}

export async function api(path, { method = 'GET', body, raw = false } = {}) {
  if (backend) {
    const r = await backend.handle(method, path, body ?? {});
    if (r.status >= 400) throw new ApiError(r.status, r.data?.error || `Fehler ${r.status}`);
    return r.data;
  }
  const headers = { Accept: 'application/json' };
  if (method !== 'GET') {
    headers['X-Xenia'] = '1';
    headers['Content-Type'] = 'application/json';
  }
  let res;
  try {
    res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : method !== 'GET' ? '{}' : undefined, credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new ApiError(0, 'Keine Verbindung zum Server');
  }
  if (raw && res.ok) return res;
  let data = null;
  try { data = await res.json(); } catch { /* leer */ }
  if (res.status === 401 && !path.startsWith('/auth/')) {
    onUnauthorized();
  }
  if (!res.ok) throw new ApiError(res.status, data?.error || `Fehler ${res.status}`);
  return data;
}

// --- Live-Verbindung ----------------------------------------------------------
let es = null;
let retryTimer = null;

export function connect() {
  if (backend) {
    if (directUnsub || document.visibilityState === 'hidden') return;
    backend.resume();
    directUnsub = backend.subscribe((name, data) => {
      if (name === 'snapshot') {
        Object.assign(store, { machine: data.machine, grinder: data.grinder, server: data.server, connected: true });
        return notify('all');
      }
      if (name === 'event') {
        for (const fn of listeners) {
          try { fn('event', data); } catch { /* ignorieren */ }
        }
        return;
      }
      store[name] = data;
      notify(name);
    });
    return;
  }
  if (es || document.visibilityState === 'hidden') return;
  es = new EventSource('/api/stream', { withCredentials: true });
  es.addEventListener('open', () => {
    store.connected = true;
    notify('conn');
  });
  es.addEventListener('snapshot', (e) => {
    const d = JSON.parse(e.data);
    store.machine = d.machine;
    store.grinder = d.grinder;
    store.server = d.server;
    store.connected = true;
    notify('all');
  });
  es.addEventListener('machine', (e) => {
    store.machine = JSON.parse(e.data);
    notify('machine');
  });
  es.addEventListener('grinder', (e) => {
    store.grinder = JSON.parse(e.data);
    notify('grinder');
  });
  // Server-Einstellungen geändert (Funktionen, Mühle an/aus)
  es.addEventListener('server', (e) => {
    store.server = { ...store.server, ...JSON.parse(e.data) };
    notify('server');
  });
  es.addEventListener('event', (e) => {
    const ev = JSON.parse(e.data);
    for (const fn of listeners) {
      try { fn('event', ev); } catch { /* ignorieren */ }
    }
  });
  es.addEventListener('error', async () => {
    store.connected = false;
    notify('conn');
    if (es && es.readyState === EventSource.CLOSED) {
      es = null;
      // Sitzung abgelaufen?
      try {
        const s = await api('/auth/session');
        if (!s.authenticated) return onUnauthorized();
      } catch { /* offline */ }
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, 4000);
    }
  });
}

export function disconnect() {
  if (backend) {
    directUnsub?.();
    directUnsub = null;
    backend.pause();
  }
  if (es) {
    es.close();
    es = null;
  }
  store.connected = false;
}

document.addEventListener('visibilitychange', () => {
  // Im Hintergrund trennen: der Server fragt die Maschine dann seltener ab.
  if (document.visibilityState === 'hidden') disconnect();
  else if (window.__authed) connect();
});

export async function refreshState() {
  const d = await api('/api/state');
  store.machine = d.machine;
  store.grinder = d.grinder;
  store.server = d.server;
  notify('all');
}

// Maschine erreichbar und eingeschaltet (nicht Aus)? Sonst sind außer „Ein“ alle Bedienelemente gesperrt.
export function machineOn(m = store.machine) {
  return Boolean(m?.online) && m.statusKey !== 'off';
}
