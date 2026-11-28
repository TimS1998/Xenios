// Anmeldung, Ersteinrichtung im Browser und Server-Einstellungen (alles, was früher nur in config.json ging).
import fs from 'node:fs';
import net from 'node:net';
import crypto from 'node:crypto';
import { hashPassword, verifyPassword, passwordProblem, sessionCookie } from './auth.js';
import { updateConfigFile, setPath, getPath, applyTimezone, isTimezone } from './config.js';
import { XeniaClient, MA_TYPE, CLASSIC_TYPE, machineApiId, httpError } from './machine.js';
import { GrinderHttp } from './grinder.js';
import { ensureCert, certInfo } from './tls.js';
import { setLogLevel, logger } from './log.js';
import { updateInfo, requestUpdate, cancelUpdate, helperAlive, readUpdate } from './update.js';
import { tunnelTokenFromPaste, requestTunnelToken, waitForTunnelApplied } from './tunnel-token.js';
import { t } from '../web/shared/i18n.js';

const log = logger('admin');

// --- Prüfung der Eingaben ------------------------------------------------------------------------
const bad = (msg) => httpError(400, msg);
// Feldnamen als Funktion (Text erst beim Gebrauch) oder fertiger Text
const lbl = (label) => (typeof label === 'function' ? label() : label);
const bool = (label) => (v) => {
  if (typeof v !== 'boolean') throw bad(t('server.validate.bool', { label: lbl(label) }));
  return v;
};
const int = (label, min, max) => (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(t('server.validate.int', { label: lbl(label), min, max }));
  return n;
};
const oneOf = (label, list) => (v) => {
  if (!list.includes(v)) throw bad(t('server.validate.oneOf', { label: lbl(label), list: list.join(', ') }));
  return v;
};
const HOST_RE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*|(?:\d{1,3}\.){3}\d{1,3}|[0-9a-fA-F:]{2,39})$/;
const host = (label) => (v) => {
  const s = String(v ?? '').trim();
  if (!HOST_RE.test(s)) throw bad(t('server.validate.host', { label: lbl(label) }));
  return s;
};

// Geräte-Adresse: nur http(s)://host[:port], nichts dahinter (verhindert, dass beliebige Pfade/Zugangsdaten angefragt werden)
export function deviceUrl(v, label) {
  let u;
  try {
    u = new URL(String(v ?? '').trim());
  } catch {
    throw bad(t('server.validate.urlExample', { label: lbl(label) }));
  }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) {
    throw bad(t('server.validate.urlOnly', { label: lbl(label) }));
  }
  return u.origin;
}

// Öffentliche Adresse über den Cloudflare-Tunnel: nur https://name.domain (Cloudflare liefert das Zertifikat)
export function publicUrl(v) {
  let u;
  try {
    u = new URL(String(v ?? '').trim());
  } catch {
    throw bad(t('server.validate.publicUrlExample'));
  }
  if (u.protocol !== 'https:' || u.port || u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) {
    throw bad(t('server.validate.publicUrlOnly'));
  }
  return u.origin;
}

function hexColor(label) {
  return (v) => {
    const s = String(v ?? '').trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(s)) throw bad(t('server.validate.hexColor', { label: lbl(label) }));
    return s;
  };
}

export const FIELDS = {
  publicUrl: (v) => (v === null || v === '' ? null : publicUrl(v)),
  'machine.url': (v) => deviceUrl(v, t('server.fields.machineUrl')),
  'machine.api': oneOf(() => t('server.fields.machineApi'), ['bbs', 'classic']),
  'machine.look.color': hexColor(() => t('server.fields.machineColor')),
  'machine.look.grip': (v) => (v === null || v === '' ? null : v === 'chrome' ? 'chrome' : hexColor(t('server.fields.gripColor'))(v)),
  'machine.look.tray': (v) => (v === null || v === '' ? null : hexColor(t('server.fields.trayColor'))(v)),
  'machine.look.gauge': hexColor(() => t('server.fields.gaugeColor')),
  'machine.look.style': oneOf(() => t('server.fields.lookStyle'), ['render', 'simple']),
  'machine.look.steamSide': oneOf(() => t('server.fields.steamSide'), ['left', 'right']),
  'machine.look.valves': oneOf(() => t('server.fields.valves'), ['lever', 'rotary']),
  'machine.look.editButton': bool(() => t('server.fields.editButton')),
  'grinder.enabled': bool(() => t('server.fields.grinder')),
  'grinder.url': (v) => deviceUrl(v, t('server.fields.grinderUrl')),
  'grinder.password': (v) => {
    if (typeof v !== 'string' || v.length > 128) throw bad(t('server.validate.grinderPassword'));
    return v;
  },
  'grinder.allowDatabaseDownload': bool(() => t('server.fields.databaseDownload')),
  'features.paddle': bool(() => t('server.fields.paddle')),
  'features.scriptEditor': bool(() => t('server.fields.scriptEditor')),
  'features.settings': bool(() => t('server.fields.settings')),
  'features.clockSync': bool(() => t('server.fields.clockSync')),
  'auth.sessionDays': int(() => t('server.fields.sessionDays'), 1, 365),
  'push.subject': (v) => {
    const s = String(v ?? '').trim();
    if (!/^(mailto:[^\s@]+@[^\s@]+\.[^\s@]+|https:\/\/[^\s]+)$/.test(s) || s.length > 200) throw bad(t('server.validate.pushSubject'));
    return s;
  },
  timezone: (v) => {
    if (v === null || v === '') return null;
    if (typeof v !== 'string' || !isTimezone(v)) throw bad(t('server.validate.timezone'));
    return v;
  },
  logLevel: oneOf(() => t('server.fields.logLevel'), ['debug', 'info', 'warn', 'error']),
  trustProxy: oneOf(() => t('server.fields.trustProxy'), ['loopback', 'private', 'all', 'none']),
  'http.enabled': bool(() => t('server.fields.httpPort')),
  'http.host': host(() => t('server.fields.httpHost')),
  'http.port': int(() => t('server.fields.httpPort'), 1, 65535),
  'https.enabled': bool(() => t('server.fields.https')),
  'https.host': host(() => t('server.fields.httpsHost')),
  'https.port': int(() => t('server.fields.httpsPort'), 1, 65535),
  'https.hosts': (v) => {
    if (!Array.isArray(v) || v.length > 20) throw bad(t('server.validate.certHosts'));
    return [...new Set(v.map((x) => host(t('server.fields.cert'))(x)))];
  },
  'lan.enabled': bool(() => t('server.fields.lan')),
  'lan.host': host(() => t('server.fields.lanHost')),
  'lan.port': int(() => t('server.fields.lanPort'), 1, 65535),
  'gbs.enabled': bool(() => t('server.fields.gbs')),
  'gbs.host': host(() => t('server.fields.gbsHost')),
  'gbs.port': int(() => t('server.fields.gbsPort'), 1, 65535),
  'gbs.grinderIp': (v) => {
    if (v === null || v === '') return null;
    const s = String(v).trim();
    if (!net.isIP(s)) throw bad(t('server.validate.grinderIp'));
    return s;
  },
};
const SECRET_FIELDS = ['grinder.password'];
const LISTENER_FIELDS = Object.keys(FIELDS).filter((p) => /^(http|https|lan|gbs)\.(enabled|host|port)$/.test(p));

// Prüft, ob die Ports nach der Änderung zusammenpassen und mindestens ein Zugang offen bleibt.
function checkListeners(cfg, clean) {
  const v = (p) => (p in clean ? clean[p] : getPath(cfg, p));
  const on = ['http', 'https', 'lan'].filter((k) => v(`${k}.enabled`));
  if (!on.length) throw bad(t('server.validate.noAccess'));
  if (v('gbs.enabled')) on.push('gbs');
  const ports = on.map((k) => v(`${k}.port`));
  if (new Set(ports).size !== ports.length) {
    const lanClash = v('gbs.enabled') && v('lan.enabled') && v('gbs.port') === v('lan.port');
    throw bad(lanClash ? t('server.validate.gbsLanPort') : t('server.validate.portClash'));
  }
  if (v('gbs.enabled') && !v('gbs.grinderIp')) {
    let h = '';
    try { h = new URL(v('grinder.url')).hostname.replace(/^\[|\]$/g, ''); } catch { /* leer */ }
    if (!net.isIP(h)) throw bad(t('server.validate.gbsNeedsIp'));
  }
}

// --- Setup-Code ---------------------------------------------------------------------------------
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeSetupCode() {
  const bytes = crypto.randomBytes(8);
  const s = [...bytes].map((b) => CODE_CHARS[b % 32]).join('');
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// --- Geräte und Tunnel testen ----------------------------------------------------------------------
// Ruft /healthz über die öffentliche Adresse auf; nur wenn dort genau dieser Server antwortet (gleiche Instanz-ID), steht der Tunnel.
export async function probeTunnel(url, instance, { fetchImpl = globalThis.fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(`${url}/healthz`, { redirect: 'manual', headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(8000) });
  } catch (e) {
    const why = e.name === 'TimeoutError' ? t('server.common.timeout') : e.cause?.code === 'ENOTFOUND' ? t('server.tunnel.dnsMissing') : e.cause?.code || e.message;
    throw httpError(502, t('server.tunnel.unreachable', { why }));
  }
  const id = res.headers.get('x-xenios-instance');
  if (res.status === 200 && id === instance) return { ok: true, name: t('server.tunnel.works'), detail: t('server.tunnel.worksDetail', { host: new URL(url).host }) };
  if (id) throw httpError(502, t('server.tunnel.otherServer'));
  if ([502, 503, 530].includes(res.status)) throw httpError(502, t('server.tunnel.cloudflareNoServer', { status: res.status }));
  throw httpError(502, t('server.tunnel.unexpected', { status: res.status }));
}

export async function probeDevice({ kind, url, password }, { pinned = null, instance = null } = {}) {
  if (kind === 'tunnel') return probeTunnel(publicUrl(url), instance);
  if (kind === 'machine') {
    const base = deviceUrl(url, t('server.fields.machineUrl'));
    const client = new XeniaClient({ url: base, timeoutMs: 4000 });
    const m = await client.get('/api/v2/machine');
    if (m?.MA_TYPE === undefined) throw httpError(502, t('server.probe.noXenia'));
    let apiHint = 'classic';
    try { await client.get('/api/v2/general'); apiHint = 'bbs'; } catch { /* alte API hat /general nicht */ }
    return {
      ok: true,
      name: (apiHint === 'classic' ? CLASSIC_TYPE : MA_TYPE)[m.MA_TYPE] || t('server.probe.xeniaType', { type: m.MA_TYPE }),
      detail: t('server.probe.firmware', { major: m.FW_VERSION_MAJOR, minor: m.FW_VERSION_MINOR }),
      apiHint,
    };
  }
  if (kind === 'grinder') {
    const base = deviceUrl(url, t('server.fields.grinderUrl'));
    const gh = new GrinderHttp({ url: base, timeoutMs: 5000, pinnedFingerprint: pinned });
    let fingerprint = pinned;
    gh.onFingerprint = (fp) => { fingerprint = fp; };
    try {
      const r = await gh.request('POST', '/rest_api/get_machine_info');
      let info;
      try { info = JSON.parse(r.text); } catch { throw httpError(502, t('server.probe.noGrinder')); }
      let login = null;
      if (password) {
        await gh.request('GET', '/login.php');
        await gh.request('POST', '/login.php', { form: { userRole: 'Owner', password, login: '' } });
        login = (await gh.request('POST', '/rest_api/check_session')).text.trim() === 'session_valid';
      }
      return { ok: true, name: info.grinderTypeName || t('server.probe.grinderName'), fingerprint, login };
    } catch (e) {
      if (e.status) throw e;
      throw httpError(502, t('server.probe.grinderUnreachable', { why: e.code || e.message }));
    } finally {
      gh.close();
    }
  }
  throw bad(t('server.probe.badKind'));
}

// --- Routen -----------------------------------------------------------------------------------------
// app: { cfg, sessions, limiter, machine, grinder, setup, instance, devicesStarted(), startDevices(), broadcastServer(), hooks, version }
export function authRoutes(route, app) {
  const { cfg, sessions, limiter, machine, grinder, hooks } = app;
  const needsSetup = () => !cfg.auth.passwordHash;

  async function throttle(ctx, ok) {
    const wait = limiter.retryAfter(ctx.ip);
    if (wait > 0) throw Object.assign(httpError(429, t('server.auth.tooManyAttempts', { s: Math.ceil(wait / 1000) })), { retryAfter: Math.ceil(wait / 1000) });
    if (await ok()) {
      limiter.success(ctx.ip);
      return true;
    }
    limiter.fail(ctx.ip);
    await new Promise((r) => setTimeout(r, 400));
    return false;
  }

  async function checkPassword(ctx, password = ctx.body.password) {
    if (needsSetup()) throw httpError(409, t('server.auth.notSetUp'));
    const ok = await throttle(ctx, () => typeof password === 'string' && password.length <= 256 && verifyPassword(password, cfg.auth.passwordHash));
    if (!ok) {
      log.warn(`Falsches Passwort von ${ctx.ip}`);
      throw httpError(401, t('server.auth.wrongPassword'));
    }
  }

  async function checkSetupCode(ctx) {
    if (!needsSetup()) throw httpError(409, t('server.auth.alreadySetUp'));
    const want = Buffer.from(normCode(app.setup.code));
    const ok = await throttle(ctx, () => {
      const got = Buffer.from(normCode(ctx.body.code));
      // Ohne Code keine Einrichtung: Zwei leere Werte wären sonst gleich.
      return want.length > 0 && got.length === want.length && crypto.timingSafeEqual(got, want);
    });
    if (!ok) {
      log.warn(`Falscher Einrichtungscode von ${ctx.ip}`);
      throw httpError(401, t('server.auth.wrongSetupCode'));
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
    if (clean.publicUrl && /@example\.com$/.test(cfg.push.subject) && !cfg._locked.includes('push.subject') && !('push.subject' in clean)) {
      clean['push.subject'] = clean.publicUrl;
    }
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
    if (has(/^(features|grinder|machine)\./)) app.broadcastServer();
    log.info(`Einstellungen geändert: ${keys.map((k) => (SECRET_FIELDS.includes(k) ? `${k}=***` : k)).join(', ')}`);
    return keys;
  }

  function validate(changes) {
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw bad(t('server.validate.changesObject'));
    const clean = {};
    for (const [p, v] of Object.entries(changes)) {
      if (!(p in FIELDS)) throw bad(t('server.validate.unknownSetting', { path: p }));
      if (cfg._locked.includes(p)) throw httpError(409, t('server.validate.locked', { path: p }));
      clean[p] = FIELDS[p](v);
    }
    checkListeners(cfg, clean);
    return clean;
  }

  // Service URL für die Published Application in Cloudflare: im Container der Compose-Dienstname, sonst Loopback
  function tunnelEnv() {
    const docker = fs.existsSync('/.dockerenv');
    const helper = helperAlive(readUpdate(cfg.dataDir).helper);
    return { docker, helper, service: `http://${docker ? 'xenios' : '127.0.0.1'}:${cfg.http.port}`, httpEnabled: cfg.http.enabled };
  }

  // Der Token bleibt im Datenordner, bis install.sh ihn in docker/.env schreibt und cloudflared startet.
  async function storeTunnelToken(pasted, ip) {
    const token = tunnelTokenFromPaste(pasted);
    if (token === '') throw bad(t('server.tunnel.tokenMissing'));
    if (!token) throw bad(t('server.tunnel.notAToken'));
    if (!helperAlive(readUpdate(cfg.dataDir).helper)) {
      throw httpError(409, t('server.tunnel.helperNotRunning'));
    }
    requestTunnelToken(cfg.dataDir, token);
    log.info(`Tunnel-Token für den Host hinterlegt (von ${ip})`);
    const applied = await waitForTunnelApplied(cfg.dataDir);
    if (!applied) throw httpError(504, t('server.tunnel.notApplied'));
    log.info(`Tunnel-Token vom Host übernommen (von ${ip})`);
    return { ok: true };
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
        tunnel: tunnelEnv(),
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
    return {
      ok: true,
      locked: cfg._locked,
      values: { 'machine.url': cfg.machine.url, 'machine.api': machineApiId(cfg.machine.api), 'grinder.enabled': cfg.grinder.enabled, 'grinder.url': cfg.grinder.url, timezone: cfg.timezone, publicUrl: cfg.publicUrl },
      env: tunnelEnv(),
    };
  }, { auth: false });
  route('POST', '/auth/setup/tunnel', async (ctx) => {
    await checkSetupCode(ctx);
    return storeTunnelToken(ctx.body.token, ctx.ip);
  }, { auth: false });
  route('POST', '/auth/setup/probe', async (ctx) => {
    await checkSetupCode(ctx);
    return probeDevice(ctx.body, { instance: app.instance });
  }, { auth: false });
  route('POST', '/auth/setup', async (ctx) => {
    await checkSetupCode(ctx);
    const { password, machineUrl, machineApi, grinder: g = {}, timezone, publicUrl: pub, tunnelToken } = ctx.body;
    const token = tunnelTokenFromPaste(tunnelToken);
    if (token === null) throw bad(t('server.tunnel.notAToken'));
    const problem = passwordProblem(password);
    if (problem) throw bad(t('server.auth.passwordProblem', { problem }));
    const wanted = { 'machine.url': machineUrl, 'machine.api': machineApi, 'grinder.enabled': g.enabled, 'grinder.url': g.enabled ? g.url : undefined, 'grinder.password': g.enabled && g.password ? g.password : undefined, timezone: timezone || undefined, publicUrl: pub || undefined };
    const changes = Object.fromEntries(Object.entries(wanted).filter(([p, v]) => v !== undefined && !cfg._locked.includes(p)));
    const clean = validate(changes);
    clean['auth.passwordHash'] = hashPassword(password);
    applyChanges(clean);
    app.setup.code = null;
    app.startDevices();
    if (token) requestTunnelToken(cfg.dataDir, token);
    login(ctx, true);
    log.info(`Einrichtung abgeschlossen (von ${ctx.ip})${token ? ', Tunnel-Token hinterlegt' : ''}`);
    return { ok: true };
  }, { auth: false });

  // --- Sitzungen ---
  route('GET', '/api/sessions', async ({ session }) => ({
    sessions: sessions.list(session.id).map(({ id, ip, ua, device, created, lastSeen, expires, current }) => ({ id, ip, ua, device, created, lastSeen, expires, current })),
  }));
  route('DELETE', '/api/sessions/:id', async ({ params, session, res, secure }) => {
    const id = sessions.destroyShort(String(params.id));
    if (!id) throw httpError(404, t('server.auth.sessionNotFound'));
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
    const clean = validate(ctx.body.changes);
    // Nicht den Zugang abschalten, über den diese Anfrage gerade kommt (sonst sperrt man sich aus)
    const sock = ctx.req?.socket;
    const kind = sock?.encrypted ? 'https' : ctx.req?.lanPort ? 'lan' : 'http';
    if (ctx.req && clean[`${kind}.enabled`] === false) {
      throw bad({ https: () => t('server.auth.accessInUse.https'), lan: () => t('server.auth.accessInUse.lan'), http: () => t('server.auth.accessInUse.http') }[kind]());
    }
    const applied = applyChanges(clean);
    return { ...view(ctx), applied };
  });
  route('POST', '/api/admin/password', async (ctx) => {
    await checkPassword(ctx, ctx.body.current);
    const problem = passwordProblem(ctx.body.next);
    if (problem) throw bad(t('server.auth.newPasswordProblem', { problem }));
    if (ctx.body.next === ctx.body.current) throw bad(t('server.auth.samePassword'));
    applyChanges({ 'auth.passwordHash': hashPassword(ctx.body.next) });
    sessions.destroyAll(ctx.session.id); // andere Geräte müssen sich neu anmelden
    log.info(`App-Passwort geändert (von ${ctx.ip}); andere Sitzungen beendet`);
    return { ok: true };
  });
  route('POST', '/api/admin/probe', async ({ body }) => {
    const same = body.kind === 'grinder' && deviceUrl(body.url, t('server.fields.grinderUrl')) === cfg.grinder.url;
    return probeDevice({ ...body, password: body.password || (same ? cfg.grinder.password : '') }, { pinned: same ? grinder.pinnedFingerprint : null, instance: app.instance });
  });
  route('POST', '/api/admin/grinder/unpin', async (ctx) => {
    grinder.unpin();
    if (app.devicesStarted() && cfg.grinder.enabled) grinder.kick(100);
    log.info(`Zertifikat der Mühle vergessen (von ${ctx.ip})`);
    return view(ctx);
  });
  route('POST', '/api/admin/tls/renew', async (ctx) => {
    if (!cfg.https.enabled) throw httpError(409, t('server.auth.httpsOff'));
    ensureCert(cfg.https.cert, cfg.https.key, { hosts: cfg.https.hosts, force: true });
    hooks.onTls?.();
    log.info(`TLS-Zertifikat neu erzeugt (von ${ctx.ip})`);
    return view(ctx);
  });
  route('GET', '/api/admin/update', async () => updateInfo({ dataDir: cfg.dataDir, version: app.version, fetchImpl: app.fetchImpl }));
  route('POST', '/api/admin/tunnel-token', async (ctx) => storeTunnelToken(ctx.body.token, ctx.ip));
  route('POST', '/api/admin/update', async ({ ip }) => {
    // Ohne Update-Dienst auf dem Rechner holt niemand die Anforderung ab – nicht endlos warten lassen
    if (!readUpdate(cfg.dataDir).helperAlive) {
      throw httpError(409, t('server.auth.noUpdateHelper'));
    }
    const info = await updateInfo({ dataDir: cfg.dataDir, version: app.version, fetchImpl: app.fetchImpl });
    requestUpdate(cfg.dataDir);
    log.info(`Aktualisierung angefordert (von ${ip})`);
    return { ...info, requested: true, job: { state: 'queued', at: Date.now(), version: null, error: null } };
  });
  route('DELETE', '/api/admin/update', async ({ ip }) => {
    cancelUpdate(cfg.dataDir);
    log.info(`Aktualisierung abgebrochen (von ${ip})`);
    return updateInfo({ dataDir: cfg.dataDir, version: app.version, fetchImpl: app.fetchImpl });
  });
  route('GET', '/api/admin/backup', async () => app.takeBackup());
  route('POST', '/api/admin/backup', async ({ body, session, ip }) => {
    const result = await app.restoreBackup(body, session);
    log.info(`Sicherung eingespielt (von ${ip}): ${(result.files || []).join(', ')}`);
    return result;
  }, { body: 'raw' });
}
