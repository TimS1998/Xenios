// Direkt-Modus der Android-App: Maschine und Mühle ohne Server, nur im Heimnetz.
// Nutzt denselben Geräte-Code wie der Server (public/shared); HTTP läuft über die Brücke der App
// (window.XeniaApp.http), weil Maschine und Mühle keine CORS-Header senden und die Mühle ein selbstsigniertes Zertifikat hat.
import { Machine, httpError } from '../../shared/machine-core.js';
import { Grinder } from '../../shared/grinder-core.js';
import { deviceRoutes, createRouter } from '../../shared/routes.js';

// --- HTTP über die App ----------------------------------------------------------------
let seq = 0;
const pending = new Map();
window.__xeniaHttpDone = (id, json) => {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  let r;
  try { r = JSON.parse(json); } catch { r = { error: 'Ungültige Antwort der App' }; }
  if (r.error) p.reject(new Error(r.error));
  else p.resolve(r);
};

const toB64 = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b64) => Uint8Array.from(atob(b64 || ''), (c) => c.charCodeAt(0));

// → { status, headers: { name: [werte] }, body: Uint8Array, fingerprint }
function bridgeHttp({ method, url, headers = {}, body = null, timeoutMs = 8000, insecureTls = false, pin = null }) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve: (r) => resolve({ ...r, body: fromB64(r.body) }), reject });
    const bytes = body === null || body === undefined ? null : typeof body === 'string' ? new TextEncoder().encode(body) : body;
    window.XeniaApp.http(id, JSON.stringify({ method, url, headers, body: bytes ? toB64(bytes) : null, timeoutMs, insecureTls, pin }));
  });
}

// fetch-Ersatz für den Xenia-Client
function machineFetch(url, init = {}) {
  return bridgeHttp({ method: init.method || 'GET', url, headers: init.headers || {}, body: init.body ?? null, timeoutMs: 6000 })
    .then((r) => new Response(r.body.length ? r.body : null, {
      status: r.status,
      headers: Object.entries(r.headers || {}).map(([k, v]) => [k, [].concat(v).join(', ')]),
    }))
    .catch((e) => { throw Object.assign(new TypeError('fetch failed'), { cause: e }); });
}

// HTTPS-Transport zur Mühle: selbstsigniertes Zertifikat, beim ersten Kontakt gemerkt (Pinning), Cookies für die Sitzung.
class GrinderBridgeHttp {
  constructor(base, timeoutMs) {
    this.base = base.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.cookies = new Map();
  }

  async request(method, path, { body, form, headers = {}, binary = false } = {}) {
    const h = { Accept: '*/*', 'User-Agent': 'xenia-app', ...headers };
    let payload = null;
    if (form) {
      payload = new URLSearchParams(form).toString();
      h['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (body !== undefined) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      h['Content-Type'] = 'application/json';
    }
    if (this.cookies.size) h.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    // Gemerkter Fingerprint geht mit: die App prüft ihn im TLS-Handshake, bevor Cookie oder Passwort gesendet werden
    const pinned = localGet('grinderPin');
    const changed = () => Object.assign(new Error('Zertifikat der Mühle hat sich geändert – möglicher Angriff. In der App unter „Verbindung“ neu einrichten.'), { status: 502 });
    let r;
    try {
      r = await bridgeHttp({ method, url: this.base + path, headers: h, body: payload, timeoutMs: this.timeoutMs, insecureTls: true, pin: pinned });
    } catch (e) {
      if (/Fingerprint/.test(e.message)) throw changed();
      throw e;
    }
    if (r.fingerprint) {
      if (!pinned) localSet('grinderPin', r.fingerprint);
      else if (pinned !== r.fingerprint) throw changed();
    }
    const lower = {};
    for (const [k, v] of Object.entries(r.headers || {})) lower[k.toLowerCase()] = v;
    for (const c of [].concat(lower['set-cookie'] || [])) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (i > 0) {
        const k = pair.slice(0, i).trim();
        const v = pair.slice(i + 1).trim();
        if (/max-age=0|expires=Thu, 01 Jan 1970/i.test(c) || v === 'deleted') this.cookies.delete(k);
        else this.cookies.set(k, v);
      }
    }
    const headersOut = Object.fromEntries(Object.entries(lower).map(([k, v]) => [k, k === 'set-cookie' ? v : [].concat(v).join(', ')]));
    return { status: r.status, headers: headersOut, buffer: r.body, text: binary ? null : new TextDecoder().decode(r.body) };
  }
}

// --- Speicher (Bezüge, Zertifikat) im WebView ----------------------------------------------
function localGet(k) {
  try { return localStorage.getItem(`xenia.${k}`); } catch { return null; }
}
function localSet(k, v) {
  try { localStorage.setItem(`xenia.${k}`, v); } catch { /* voll */ }
}
class LocalStore {
  constructor(key, initial) {
    this.key = key;
    try { this.data = JSON.parse(localGet(key)) || structuredClone(initial); } catch { this.data = structuredClone(initial); }
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 500);
  }

  flush() {
    clearTimeout(this.timer);
    localSet(this.key, JSON.stringify(this.data));
  }
}

// --- Backend ---------------------------------------------------------------------------------
export function createDirectBackend() {
  const conf = JSON.parse(window.XeniaApp.directConfig());
  const cfg = {
    machine: { url: conf.machineUrl, timeoutMs: 6000, pollActiveMs: 1000, pollIdleMs: 4000, pollBackgroundMs: 10000, slowPollMs: 60000 },
    grinder: { enabled: Boolean(conf.grinderUrl), url: conf.grinderUrl || 'https://0.0.0.0', password: conf.grinderPassword || '', timeoutMs: 8000, pollMs: 30000, allowDatabaseDownload: false },
    features: { paddle: true, scriptEditor: true, settings: true, clockSync: true },
  };
  const machine = new Machine(cfg, { fetch: machineFetch, history: new LocalStore('shots', { shots: [] }) });
  const grinder = new Grinder(cfg, { http: new GrinderBridgeHttp(cfg.grinder.url, cfg.grinder.timeoutMs) });
  const info = () => ({
    version: conf.version || 'App',
    mode: 'direct',
    features: cfg.features,
    push: { enabled: false, topics: {} },
    grinder: { enabled: cfg.grinder.enabled, databaseDownload: false },
  });

  const { route, match } = createRouter();
  deviceRoutes(route, { machine, grinder, cfg });
  const serverOnly = async () => { throw httpError(409, 'Nur mit Server verfügbar (Direkt-Modus)'); };
  route('GET', '/auth/session', async () => ({ authenticated: true }));
  route('POST', '/auth/logout', async () => { window.XeniaApp.reauth(); return { ok: true }; });
  route('GET', '/api/state', async () => ({ machine: machine.snapshot(), grinder: grinder.snapshot(), server: info() }));
  route('GET', '/api/sessions', async () => ({ sessions: [] }));
  route('POST', '/api/sessions/revoke-all', async () => ({ ok: true }));
  route('GET', '/api/push/key', async () => ({ enabled: false, topics: {} }));
  for (const [m, p] of [['GET', '/api/schedule'], ['PUT', '/api/schedule'], ['GET', '/api/wake'], ['PUT', '/api/wake'], ['POST', '/api/push/subscribe'], ['GET', '/api/community/shots'], ['GET', '/api/community/shots/:id']]) route(m, p, serverOnly);

  const listeners = new Set();
  const emit = (name, data) => { for (const fn of listeners) fn(name, data); };
  machine.on('state', () => emit('machine', machine.snapshot()));
  grinder.on('state', () => emit('grinder', grinder.snapshot()));
  machine.on('event', (ev) => emit('event', ev));
  grinder.on('event', (ev) => emit('event', ev));
  grinder.on('state', () => machine.linkGrinds(grinder.state.grinds));
  machine.on('event', (ev) => { if (ev.topic === 'shot' && running && cfg.grinder.enabled) grinder.kick(5000); });

  let running = false;
  return {
    info,
    // Wie fetch auf die Server-API: → { status, data } oder { status, download }
    async handle(method, path, body = {}) {
      const { route: r, params, rawMatch, exists } = match(method, path.split('?')[0]);
      if (!r) return { status: exists ? 405 : 404, data: { error: exists ? 'Methode nicht erlaubt' : 'Nicht gefunden' } };
      try {
        const result = await r.handler({ params, body, rawMatch });
        if (result?.download) return { status: 200, download: result.download };
        return { status: 200, data: result ?? {} };
      } catch (e) {
        const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 502;
        return { status, data: { error: e.message } };
      }
    },
    subscribe(fn) {
      listeners.add(fn);
      fn('snapshot', { machine: machine.snapshot(), grinder: grinder.snapshot(), server: info() });
      return () => listeners.delete(fn);
    },
    // Abfragen nur, solange die App sichtbar ist (Akku); Widgets fragen selbst ab.
    resume() {
      if (running) return;
      running = true;
      machine._stopped = false;
      machine.setViewers(1);
      machine.kick();
      if (cfg.grinder.enabled) {
        grinder._stopped = false;
        grinder.setViewers(1);
        grinder.kick();
      }
    },
    pause() {
      running = false;
      machine.setViewers(0);
      machine.stop();
      machine.history.flush();
      grinder.setViewers(0);
      grinder.stop();
    },
  };
}

// Datei aus dem Direkt-Modus speichern (Downloads-Ordner des Handys)
export function saveDownload({ data, filename, type }) {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  window.XeniaApp.saveFile(filename, type, toB64(u8));
}
