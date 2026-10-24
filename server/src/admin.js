// Anmeldung, Ersteinrichtung im Browser und Server-Einstellungen (alles, was früher nur in config.json ging).
import fs from 'node:fs';
import crypto from 'node:crypto';
import { hashPassword, verifyPassword, passwordProblem, sessionCookie } from './auth.js';
import { updateConfigFile, setPath, getPath, applyTimezone, isTimezone } from './config.js';
import { XeniaClient, MA_TYPE, httpError } from './machine.js';
import { GrinderHttp } from './grinder.js';
import { ensureCert, certInfo } from './tls.js';
import { setLogLevel, logger } from './log.js';

const log = logger('admin');

// --- Prüfung der Eingaben ------------------------------------------------------------------------
const bad = (msg) => httpError(400, msg);
const bool = (label) => (v) => {
  if (typeof v !== 'boolean') throw bad(`${label}: an/aus erwartet`);
  return v;
};
const int = (label, min, max) => (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${label}: ganze Zahl von ${min} bis ${max}`);
  return n;
};
const oneOf = (label, list) => (v) => {
  if (!list.includes(v)) throw bad(`${label}: ${list.join(', ')}`);
  return v;
};
const HOST_RE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*|(?:\d{1,3}\.){3}\d{1,3}|[0-9a-fA-F:]{2,39})$/;
const host = (label) => (v) => {
  const s = String(v ?? '').trim();
  if (!HOST_RE.test(s)) throw bad(`${label}: Hostname oder IP erwartet`);
  return s;
};

// Geräte-Adresse: nur http(s)://host[:port], nichts dahinter (verhindert, dass beliebige Pfade/Zugangsdaten angefragt werden)
export function deviceUrl(v, label) {
  let u;
  try {
    u = new URL(String(v ?? '').trim());
  } catch {
    throw bad(`${label}: z. B. http://192.168.178.55`);
  }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) {
    throw bad(`${label}: nur http(s)://Adresse[:Port], ohne Pfad`);
  }
  return u.origin;
}

export const FIELDS = {
  'machine.url': (v) => deviceUrl(v, 'Adresse der Xenia'),
  'grinder.enabled': bool('Mühle'),
  'grinder.url': (v) => deviceUrl(v, 'Adresse der Mühle'),
  'grinder.password': (v) => {
    if (typeof v !== 'string' || v.length > 128) throw bad('Mühlen-Passwort: höchstens 128 Zeichen');
    return v;
  },
  'grinder.allowDatabaseDownload': bool('Datenbank-Download'),
  'features.paddle': bool('Paddle'),
  'features.scriptEditor': bool('Skript-Editor'),
  'features.settings': bool('Einstellungen ändern'),
  'features.clockSync': bool('Uhr stellen'),
  'auth.sessionDays': int('Anmeldedauer', 1, 365),
  'push.subject': (v) => {
    const s = String(v ?? '').trim();
    if (!/^(mailto:[^\s@]+@[^\s@]+\.[^\s@]+|https:\/\/[^\s]+)$/.test(s) || s.length > 200) throw bad('Push-Kontakt: mailto:name@domain.de oder https://…');
    return s;
  },
  timezone: (v) => {
    if (v === null || v === '') return null;
    if (typeof v !== 'string' || !isTimezone(v)) throw bad('Unbekannte Zeitzone');
    return v;
  },
  logLevel: oneOf('Protokoll', ['debug', 'info', 'warn', 'error']),
  trustProxy: oneOf('Vertrauter Proxy', ['loopback', 'private', 'all', 'none']),
  'http.enabled': bool('Tunnel-Port'),
  'http.host': host('Tunnel-Port: Adresse'),
  'http.port': int('Tunnel-Port', 1, 65535),
  'https.enabled': bool('HTTPS'),
  'https.host': host('HTTPS: Adresse'),
  'https.port': int('HTTPS-Port', 1, 65535),
  'https.hosts': (v) => {
    if (!Array.isArray(v) || v.length > 20) throw bad('Zertifikat: höchstens 20 Namen/IPs');
    return [...new Set(v.map((x) => host('Zertifikat')(x)))];
  },
  'lan.enabled': bool('Heimnetz-HTTP'),
  'lan.host': host('Heimnetz-HTTP: Adresse'),
  'lan.port': int('Heimnetz-HTTP-Port', 1, 65535),
};
const SECRET_FIELDS = ['grinder.password'];
const LISTENER_FIELDS = Object.keys(FIELDS).filter((p) => /^(http|https|lan)\.(enabled|host|port)$/.test(p));

// Prüft, ob die Ports nach der Änderung zusammenpassen und mindestens ein Zugang offen bleibt.
function checkListeners(cfg, clean) {
  const v = (p) => (p in clean ? clean[p] : getPath(cfg, p));
  const on = ['http', 'https', 'lan'].filter((k) => v(`${k}.enabled`));
  if (!on.length) throw bad('Mindestens ein Zugang (Tunnel-Port, HTTPS oder Heimnetz-HTTP) muss an bleiben');
  const ports = on.map((k) => v(`${k}.port`));
  if (new Set(ports).size !== ports.length) throw bad('Jeder Zugang braucht einen eigenen Port');
}

// --- Setup-Code ---------------------------------------------------------------------------------
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeSetupCode() {
  const bytes = crypto.randomBytes(8);
  const s = [...bytes].map((b) => CODE_CHARS[b % 32]).join('');
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// --- Geräte testen --------------------------------------------------------------------------------
export async function probeDevice({ kind, url, password }, { pinned = null } = {}) {
  if (kind === 'machine') {
    const base = deviceUrl(url, 'Adresse der Xenia');
    const m = await new XeniaClient({ url: base, timeoutMs: 4000 }).get('/api/v2/machine');
    if (m?.MA_TYPE === undefined) throw httpError(502, 'Unter dieser Adresse antwortet keine Xenia');
    return { ok: true, name: MA_TYPE[m.MA_TYPE] || `Xenia (Typ ${m.MA_TYPE})`, detail: `Firmware ${m.FW_VERSION_MAJOR}.${m.FW_VERSION_MINOR}` };
  }
  if (kind === 'grinder') {
    const base = deviceUrl(url, 'Adresse der Mühle');
    const t = new GrinderHttp({ url: base, timeoutMs: 5000, pinnedFingerprint: pinned });
    let fingerprint = pinned;
    t.onFingerprint = (fp) => { fingerprint = fp; };
    try {
      const r = await t.request('POST', '/rest_api/get_machine_info');
      let info;
      try { info = JSON.parse(r.text); } catch { throw httpError(502, 'Unter dieser Adresse antwortet keine Mahlkönig-Mühle'); }
      let login = null;
      if (password) {
        await t.request('GET', '/login.php');
        await t.request('POST', '/login.php', { form: { userRole: 'Owner', password, login: '' } });
        login = (await t.request('POST', '/rest_api/check_session')).text.trim() === 'session_valid';
      }
      return { ok: true, name: info.grinderTypeName || 'Mühle', fingerprint, login };
    } catch (e) {
      if (e.status) throw e;
      throw httpError(502, `Mühle nicht erreichbar (${e.code || e.message})`);
    } finally {
      t.close();
    }
  }
  throw bad('kind: machine oder grinder');
}

// --- Routen -----------------------------------------------------------------------------------------
// app: { cfg, sessions, limiter, machine, grinder, setup, devicesStarted(), startDevices(), broadcastServer(), hooks, version }
export function authRoutes(route, app) {
  const { cfg, sessions, limiter, machine, grinder, hooks } = app;
  const needsSetup = () => !cfg.auth.passwordHash;

  async function throttle(ctx, ok) {
    const wait = limiter.retryAfter(ctx.ip);
    if (wait > 0) throw Object.assign(httpError(429, `Zu viele Versuche. Bitte in ${Math.ceil(wait / 1000)} s erneut versuchen.`), { retryAfter: Math.ceil(wait / 1000) });
    if (await ok()) {
      limiter.success(ctx.ip);
      return true;
    }
    limiter.fail(ctx.ip);
    await new Promise((r) => setTimeout(r, 400));
    return false;
  }

  async function checkPassword(ctx, password = ctx.body.password) {
    if (needsSetup()) throw httpError(409, 'Der Server ist noch nicht eingerichtet');
    const ok = await throttle(ctx, () => typeof password === 'string' && password.length <= 256 && verifyPassword(password, cfg.auth.passwordHash));
    if (!ok) {
      log.warn(`Falsches Passwort von ${ctx.ip}`);
      throw httpError(401, 'Falsches Passwort');
    }
  }

  async function checkSetupCode(ctx) {
    if (!needsSetup()) throw httpError(409, 'Der Server ist bereits eingerichtet');
    const want = Buffer.from(normCode(app.setup.code));
    const ok = await throttle(ctx, () => {
      const got = Buffer.from(normCode(ctx.body.code));
      return got.length === want.length && crypto.timingSafeEqual(got, want);
    });
    if (!ok) {
      log.warn(`Falscher Einrichtungscode von ${ctx.ip}`);
      throw httpError(401, 'Einrichtungscode stimmt nicht (steht im Server-Log)');
    }
  }

  function login(ctx, remember = true) {
    const token = sessions.create({ ua: ctx.req.headers['user-agent'], ip: ctx.ip });
    ctx.res.setHeader('Set-Cookie', sessionCookie(token, { secure: ctx.secure, maxAgeDays: remember === false ? undefined : cfg.auth.sessionDays }));
    return token;
  }

  // Übernimmt geprüfte Änderungen: in config.json speichern und sofort anwenden.
  function applyChanges(clean) {
    if (!Object.keys(clean).length) return [];
    updateConfigFile(cfg._file, clean, cfg._box);
    for (const [p, v] of Object.entries(clean)) setPath(cfg, p, v);
    const keys = Object.keys(clean);
    const has = (re) => keys.some((k) => re.test(k));
    if (has(/^machine\./)) {
      machine.client.url = cfg.machine.url;
      machine.state.info = null;
      machine._slowAt = 0;
      if (app.devicesStarted()) machine.kick();
    }
    if (has(/^grinder\.(enabled|url|password)$/) && app.devicesStarted()) grinder.reconfigure();
    if ('auth.sessionDays' in clean) sessions.days = cfg.auth.sessionDays;
    if ('timezone' in clean) applyTimezone(cfg.timezone);
    if ('logLevel' in clean) setLogLevel(cfg.logLevel);
    if ('https.hosts' in clean) {
      ensureCert(cfg.https.cert, cfg.https.key, { hosts: cfg.https.hosts });
      hooks.onTls?.();
    }
    if (keys.some((k) => LISTENER_FIELDS.includes(k))) setTimeout(() => hooks.onListeners?.(), 300).unref?.();
    if (has(/^(features|grinder)\./)) app.broadcastServer();
    log.info(`Einstellungen geändert: ${keys.map((k) => (SECRET_FIELDS.includes(k) ? `${k}=***` : k)).join(', ')}`);
    return keys;
  }

  function validate(changes) {
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw bad('changes: Objekt erwartet');
    const clean = {};
    for (const [p, v] of Object.entries(changes)) {
      if (!(p in FIELDS)) throw bad(`Unbekannte Einstellung ${p}`);
      if (cfg._locked.includes(p)) throw httpError(409, `${p} ist per Umgebungsvariable festgelegt`);
      clean[p] = FIELDS[p](v);
    }
    checkListeners(cfg, clean);
    return clean;
  }

  function view(ctx) {
    const values = Object.fromEntries(Object.keys(FIELDS).map((p) => [p, SECRET_FIELDS.includes(p) ? '' : getPath(cfg, p)]));
    let timezones = [];
    try { timezones = Intl.supportedValuesOf('timeZone'); } catch { /* alte Node-Version */ }
    return {
      values,
      secrets: Object.fromEntries(SECRET_FIELDS.map((p) => [p, Boolean(getPath(cfg, p))])),
      locked: cfg._locked.filter((p) => p in FIELDS),
      timezones,
      status: {
        version: app.version,
        node: process.version,
        uptimeS: Math.round(process.uptime()),
        docker: fs.existsSync('/.dockerenv'),
        configFile: cfg._file,
        dataDir: cfg.dataDir,
        secretKey: cfg._box.source(),
        tls: cfg.https.enabled ? certInfo(cfg.https.cert) : null,
        grinderPin: grinder.pinnedFingerprint,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        serverTime: new Date().toISOString(),
        listeners: hooks.listenerStatus?.() || [],
        via: { ip: ctx.ip, secure: ctx.secure },
      },
    };
  }

  // --- Anmeldung ---
  route('GET', '/auth/session', async (ctx) => ({ authenticated: Boolean(ctx.session), setup: needsSetup() }), { auth: false });
  route('POST', '/auth/login', async (ctx) => {
    await checkPassword(ctx);
    login(ctx, ctx.body.remember);
    log.info(`Login von ${ctx.ip}`);
    return { ok: true };
  }, { auth: false });
  // Android-App: Token für WebView-Cookie und Bearer-Aufrufe der Widgets (eine Sitzung pro Gerät).
  route('POST', '/auth/device', async (ctx) => {
    await checkPassword(ctx);
    const device = String(ctx.body.name || 'Android').replace(/[^\p{L}\p{N} ._\-()]/gu, '').slice(0, 60) || 'Android';
    const token = sessions.create({ ua: `Android-App: ${device}`, ip: ctx.ip, device });
    log.info(`Android-App angemeldet: ${device} von ${ctx.ip}`);
    return { token, sessionDays: cfg.auth.sessionDays, cookie: ctx.secure ? '__Host-xs' : 'xs' };
  }, { auth: false });
  route('POST', '/auth/logout', async (ctx) => {
    sessions.destroy(ctx.token);
    ctx.res.setHeader('Set-Cookie', sessionCookie('', { secure: ctx.secure, maxAgeDays: 0 }));
    return { ok: true };
  }, { auth: false });

  // --- Ersteinrichtung im Browser (nur solange kein Passwort gesetzt ist; Code steht im Server-Log) ---
  route('POST', '/auth/setup/check', async (ctx) => {
    await checkSetupCode(ctx);
    return { ok: true, locked: cfg._locked, values: { 'machine.url': cfg.machine.url, 'grinder.enabled': cfg.grinder.enabled, 'grinder.url': cfg.grinder.url, timezone: cfg.timezone } };
  }, { auth: false });
  route('POST', '/auth/setup/probe', async (ctx) => {
    await checkSetupCode(ctx);
    return probeDevice(ctx.body);
  }, { auth: false });
  route('POST', '/auth/setup', async (ctx) => {
    await checkSetupCode(ctx);
    const { password, machineUrl, grinder: g = {}, timezone } = ctx.body;
    const problem = passwordProblem(password);
    if (problem) throw bad(`Passwort: ${problem}`);
    const wanted = { 'machine.url': machineUrl, 'grinder.enabled': g.enabled, 'grinder.url': g.enabled ? g.url : undefined, 'grinder.password': g.enabled && g.password ? g.password : undefined, timezone: timezone || undefined };
    const changes = Object.fromEntries(Object.entries(wanted).filter(([p, v]) => v !== undefined && !cfg._locked.includes(p)));
    const clean = validate(changes);
    clean['auth.passwordHash'] = hashPassword(password);
    applyChanges(clean);
    app.setup.code = null;
    app.startDevices();
    login(ctx, true);
    log.info(`Einrichtung abgeschlossen (von ${ctx.ip})`);
    return { ok: true };
  }, { auth: false });

  // --- Sitzungen ---
  route('GET', '/api/sessions', async ({ session }) => ({
    sessions: sessions.list(session.id).map(({ id, ip, ua, device, created, lastSeen, expires, current }) => ({ id, ip, ua, device, created, lastSeen, expires, current })),
  }));
  route('DELETE', '/api/sessions/:id', async ({ params, session, res, secure }) => {
    const id = sessions.destroyShort(String(params.id));
    if (!id) throw httpError(404, 'Sitzung nicht gefunden');
    if (id === session.id) res.setHeader('Set-Cookie', sessionCookie('', { secure, maxAgeDays: 0 }));
    return { ok: true, self: id === session.id };
  });
  route('POST', '/api/sessions/revoke-all', async (ctx) => {
    sessions.destroyAll();
    ctx.res.setHeader('Set-Cookie', sessionCookie('', { secure: ctx.secure, maxAgeDays: 0 }));
    return { ok: true };
  });

  // --- Server-Einstellungen ---
  route('GET', '/api/admin/config', async (ctx) => view(ctx));
  route('PUT', '/api/admin/config', async (ctx) => {
    const applied = applyChanges(validate(ctx.body.changes));
    return { ...view(ctx), applied };
  });
  route('POST', '/api/admin/password', async (ctx) => {
    await checkPassword(ctx, ctx.body.current);
    const problem = passwordProblem(ctx.body.next);
    if (problem) throw bad(`Neues Passwort: ${problem}`);
    if (ctx.body.next === ctx.body.current) throw bad('Neues Passwort ist gleich dem alten');
    applyChanges({ 'auth.passwordHash': hashPassword(ctx.body.next) });
    sessions.destroyAll(ctx.session.id); // andere Geräte müssen sich neu anmelden
    log.info(`App-Passwort geändert (von ${ctx.ip}); andere Sitzungen beendet`);
    return { ok: true };
  });
  route('POST', '/api/admin/probe', async ({ body }) => {
    const same = body.kind === 'grinder' && deviceUrl(body.url, 'Adresse der Mühle') === cfg.grinder.url;
    return probeDevice({ ...body, password: body.password || (same ? cfg.grinder.password : '') }, { pinned: same ? grinder.pinnedFingerprint : null });
  });
  route('POST', '/api/admin/grinder/unpin', async (ctx) => {
    grinder.unpin();
    if (app.devicesStarted() && cfg.grinder.enabled) grinder.kick(100);
    log.info(`Zertifikat der Mühle vergessen (von ${ctx.ip})`);
    return view(ctx);
  });
  route('POST', '/api/admin/tls/renew', async (ctx) => {
    if (!cfg.https.enabled) throw httpError(409, 'HTTPS ist aus');
    ensureCert(cfg.https.cert, cfg.https.key, { hosts: cfg.https.hosts, force: true });
    hooks.onTls?.();
    log.info(`TLS-Zertifikat neu erzeugt (von ${ctx.ip})`);
    return view(ctx);
  });
}
