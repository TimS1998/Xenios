#!/usr/bin/env node
// Xenios – sicherer Web-Server für Xenia-Espressomaschine + Mahlkönig E64 WS mit installierbarer Web-App.
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, loadConfig, updateConfigFile, migrateSecrets, applyTimezone, secretBox } from './config.js';
import { logger, setLogLevel } from './log.js';
import { Sessions, LoginLimiter, tokenFromRequest } from './auth.js';
import { authRoutes, makeSetupCode } from './admin.js';
import { communityRoutes } from './community.js';
import { PushService, PUSH_TOPICS, normalizePrefs, generateVapidKeys } from './push.js';
import { Machine, httpError } from './machine.js';
import { deviceRoutes, createRouter } from '../web/shared/routes.js';
import { Grinder } from './grinder.js';
import { Scheduler, SCHEDULE_ACTIONS } from './schedule.js';
import { Wake } from './wake.js';
import { JsonStore } from './store.js';
import { securityHeaders, sendJson, readJson, makeStatic } from './http-util.js';
import { ensureCert, certFingerprint } from './tls.js';

const log = logger('server');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const MAX_STREAMS = 50;

// Erststart: Datenordner, Push-Schlüssel, Verschlüsselung alter Klartext-Geheimnisse, Zeitzone.
export function prepare(cfg) {
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  if (!cfg.push.publicKey || !cfg.push.privateKey) {
    Object.assign(cfg.push, generateVapidKeys());
    updateConfigFile(cfg._file, { 'push.publicKey': cfg.push.publicKey, 'push.privateKey': cfg.push.privateKey }, cfg._box);
    log.info('Schlüssel für Push-Benachrichtigungen erzeugt');
  }
  const migrated = migrateSecrets(cfg);
  if (migrated.length) log.info(`Verschlüsselt gespeichert: ${migrated.join(', ')}`);
  applyTimezone(cfg.timezone);
}

// hooks (vom Start-Code gesetzt): onListeners(), onTls(), listenerStatus()
export function createApp(cfg, hooks = {}) {
  // Auch mit einer von Hand gebauten Konfiguration (Tests) lauffähig
  cfg._locked ??= [];
  cfg._file ??= path.join(cfg.dataDir, 'config.json');
  cfg._box ??= secretBox(cfg.dataDir);
  const sessions = new Sessions(cfg);
  const limiter = new LoginLimiter();
  const push = new PushService(cfg);
  const machine = new Machine(cfg);
  const grinder = new Grinder(cfg, { pinStore: new JsonStore(path.join(cfg.dataDir, 'grinder-pin.json'), {}) });
  const serveStatic = makeStatic(path.join(ROOT, 'web'));
  const streams = new Set();
  const setup = { code: cfg.auth.passwordHash ? null : makeSetupCode() };
  // Zufällige Kennung dieses Prozesses: der Tunnel-Test erkennt daran, dass unter der öffentlichen Adresse genau dieser Server antwortet
  const instance = crypto.randomBytes(12).toString('base64url');

  // --- Live-Updates per Server-Sent Events ----------------------------------
  function send(stream, event, data) {
    try {
      stream.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch { /* Verbindung weg */ }
  }
  function broadcast(event, data) {
    for (const s of streams) send(s, event, data);
  }
  let lastMachineJson = '';
  machine.on('state', () => {
    const snap = machine.snapshot();
    const json = JSON.stringify(snap);
    if (json !== lastMachineJson) {
      lastMachineJson = json;
      broadcast('machine', snap);
    }
  });
  grinder.on('state', () => broadcast('grinder', grinder.snapshot()));
  const onEvent = (ev) => {
    broadcast('event', ev);
    if (!ev.silent || ev.topic !== 'grinder') {
      push.notify(ev.topic, { title: ev.title, body: ev.body, tag: ev.tag, at: ev.at }).catch(() => {});
    }
  };
  machine.on('event', onEvent);
  grinder.on('event', onEvent);
  // Mahlvorgang der Mühle dem Bezug zuordnen (Dosis, Rezept): nach jedem Abgleich mit der Mühle,
  // und nach einem Bezug die Mühle bald neu einlesen, damit der Mahlvorgang davor schon bekannt ist
  grinder.on('state', () => machine.linkGrinds(grinder.state.grinds));
  machine.on('event', (ev) => { if (ev.topic === 'shot' && cfg.grinder.enabled && started) grinder.kick(5000); });
  const scheduler = new Scheduler(cfg, machine, { onEvent });
  const wake = new Wake(cfg, machine, { onEvent });
  const updateViewers = () => {
    machine.setViewers(streams.size);
    grinder.setViewers(streams.size);
  };

  // Geräte erst nach der Einrichtung abfragen
  let started = false;
  function startDevices() {
    if (started || !cfg.auth.passwordHash) return;
    started = true;
    machine.start();
    grinder.start();
    scheduler.start();
    wake.start();
  }
  function stop() {
    sessions.store.flush();
    machine.history.flush();
    machine.stop();
    grinder.stop();
    scheduler.stop();
    wake.stop();
    wake.store.flush();
    for (const s of streams) s.end();
  }

  // --- Routing ----------------------------------------------------------------
  const { route, match } = createRouter();

  const serverInfo = () => ({
    version: VERSION,
    features: cfg.features,
    push: { enabled: push.enabled, publicKey: cfg.push.publicKey, topics: PUSH_TOPICS },
    grinder: { enabled: cfg.grinder.enabled, databaseDownload: Boolean(cfg.grinder.allowDatabaseDownload) },
  });

  // Anmeldung, Einrichtung, Sitzungen, Server-Einstellungen
  authRoutes(route, {
    cfg, sessions, limiter, machine, grinder, setup, hooks, instance, version: VERSION,
    devicesStarted: () => started,
    startDevices,
    broadcastServer: () => broadcast('server', serverInfo()),
  });

  // Zustand
  route('GET', '/api/state', async () => ({ machine: machine.snapshot(), grinder: grinder.snapshot(), server: serverInfo() }));
  // Kompakter Zustand für Android-Widgets und Schnelleinstellungs-Kachel.
  route('GET', '/api/widget', async () => {
    const m = machine.snapshot();
    return {
      online: m.online, status: m.statusKey ?? null, label: m.statusLabel ?? null,
      heated: Boolean(m.heated), steamOn: Boolean(m.steamOn), steamReady: Boolean(m.steamReady), tankOk: m.tankOk !== false,
      group: m.temp?.group ?? null, groupSet: m.temp?.groupSet ?? null, steam: m.pressure?.steam ?? null,
      boiler: m.temp?.boiler ?? null, boilerSet: m.temp?.boilerSet ?? null, steamSet: m.pressure?.steamSet ?? null,
      shot: Boolean(m.shot?.running), at: Date.now(),
      next: nextPlannedOn(),
    };
  });
  // Nächstes geplantes Einschalten: Wecker-Automatik oder Server-Zeitplan, was früher kommt
  function nextPlannedOn() {
    const w = wake.state().plan;
    const candidates = [w ? { at: w.at, reason: `Wecker ${w.device}` } : null, scheduler.nextOn()].filter((c) => c && c.at > Date.now());
    candidates.sort((a, b) => a.at - b.at);
    return candidates[0] || null;
  }

  // Maschine und Mühle (gemeinsam mit dem Direkt-Modus der App)
  deviceRoutes(route, { machine, grinder, cfg });
  // Profile aus der Community von visualizer.coffee
  communityRoutes(route, { version: VERSION, fetchImpl: hooks.fetch });

  // Zusätzliche Schaltzeiten (führt der Server aus)
  route('GET', '/api/schedule', async () => ({ rules: scheduler.list(), actions: SCHEDULE_ACTIONS }));
  route('PUT', '/api/schedule', async ({ body }) => ({ rules: scheduler.save(body.rules) }));
  // Wecker-Automatik: Android-App meldet den nächsten Wecker, Server schaltet vorher ein
  route('GET', '/api/wake', async () => wake.state());
  route('PUT', '/api/wake', async ({ body }) => wake.setConfig(body.config, body.devices));
  route('POST', '/api/wake/alarm', async ({ body, session }) => {
    const next = body.next === null || body.next === undefined ? null : Number(body.next);
    return { plan: wake.report(session.id.slice(0, 12), session.device || session.ua || 'Handy', next) };
  });
  route('DELETE', '/api/wake/devices/:id', async ({ params }) => wake.removeDevice(params.id));

  // Push
  route('GET', '/api/push/key', async () => ({ enabled: push.enabled, publicKey: cfg.push.publicKey, topics: PUSH_TOPICS }));
  route('POST', '/api/push/subscribe', async ({ body, session }) => {
    if (!push.enabled) throw httpError(409, 'Push ist nicht eingerichtet');
    push.subscribe(body.subscription, body.prefs, session.id);
    return { ok: true, prefs: normalizePrefs(body.prefs) };
  });
  route('POST', '/api/push/prefs', async ({ body }) => ({ prefs: push.prefsFor(String(body.endpoint || '')) }));
  route('POST', '/api/push/unsubscribe', async ({ body }) => {
    push.unsubscribe(String(body.endpoint || ''));
    return { ok: true };
  });
  route('POST', '/api/push/test', async ({ body }) => {
    const sub = push.store.data.subs.find((s) => s.endpoint === body.endpoint);
    if (!sub) throw httpError(404, 'Dieses Gerät hat keine Benachrichtigungen abonniert');
    const ok = await push.sendToSub(sub, { topic: 'test', title: 'Xenios', body: 'Test-Benachrichtigung ☕', tag: 'test' });
    return { ok };
  });

  function download(res, { data, filename, type }) {
    const buf = Buffer.from(data.buffer ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : data);
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': buf.length,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    });
    res.end(buf);
  }

  // --- Anfrage-Verarbeitung -----------------------------------------------------
  function clientInfo(req) {
    const remote = req.socket.remoteAddress || '';
    const plain = remote.replace(/^::ffff:/, '');
    const loopback = plain === '127.0.0.1' || plain === '::1';
    const privateNet = loopback || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|fc|fd)/i.test(plain);
    // Proxy-Header (cloudflared) nur auf dem unverschlüsselten Tunnel-Port auswerten, nie auf den Heimnetz-Ports (HTTPS, LAN-HTTP).
    const tunnelPort = !req.socket.encrypted && !req.lanPort;
    const trusted = tunnelPort && (cfg.trustProxy === 'all' || (cfg.trustProxy === 'private' && privateNet) || (cfg.trustProxy === 'loopback' && loopback));
    let ip = plain;
    let secure = Boolean(req.socket.encrypted);
    if (trusted) {
      const fwd = req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (fwd) ip = fwd.slice(0, 64);
      const proto = String(req.headers['x-forwarded-proto'] || '');
      const visitor = String(req.headers['cf-visitor'] || '');
      if (proto === 'https' || visitor.includes('"https"')) secure = true;
    }
    return { ip, secure, trusted };
  }

  function originOk(req, secure, trusted) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      const o = new URL(origin);
      const hosts = [req.headers.host];
      if (trusted && req.headers['x-forwarded-host']) hosts.push(String(req.headers['x-forwarded-host']).split(',')[0].trim());
      return hosts.includes(o.host) && (o.protocol === 'https:' || !secure);
    } catch {
      return false;
    }
  }

  async function handle(req, res) {
    const { ip, secure, trusted } = clientInfo(req);
    securityHeaders(res, { secure });
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    try {
      if (p === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store', 'X-Xenios-Instance': instance });
        return res.end('ok');
      }
      if (p === '/api/stream' && req.method === 'GET') return stream(req, res, ip);
      if (p.startsWith('/api/') || p.startsWith('/auth/')) {
        const { route: r, params, rawMatch, exists } = match(req.method, p);
        if (!r) return sendJson(res, exists ? 405 : 404, { error: exists ? 'Methode nicht erlaubt' : 'Nicht gefunden' });
        const token = tokenFromRequest(req);
        const session = sessions.check(token);
        if (r.auth && !session) return sendJson(res, 401, { error: 'Nicht angemeldet' });
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          // CSRF-Schutz: eigener Header (nur per fetch setzbar) + Origin-Prüfung
          if (req.headers['x-xenia'] !== '1' || !originOk(req, secure, trusted)) return sendJson(res, 403, { error: 'Ungültige Anfrage-Herkunft' });
        }
        const body = req.method === 'GET' || req.method === 'HEAD' ? {} : await readJson(req);
        const result = await r.handler({ req, res, ip, secure, session, token, params, body, rawMatch, query: url.searchParams });
        if (result?.download) return download(res, result.download);
        if (result !== undefined && !res.headersSent) sendJson(res, 200, result);
        return;
      }
      // App-Shortcuts (/?do=on …) schalten die Maschine. Kommt der Aufruf von einer fremden Seite (Link),
      // die Aktion verwerfen – sonst könnte jede Webseite die Maschine per Link ein- oder ausschalten.
      if (url.searchParams.has('do') && req.method === 'GET') {
        const site = req.headers['sec-fetch-site'];
        if (site && site !== 'none' && site !== 'same-origin') {
          res.writeHead(303, { Location: p, 'Cache-Control': 'no-store' });
          return res.end();
        }
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && serveStatic(req, res, p)) return;
      if (req.method === 'GET' && !path.extname(p)) {
        // App-Routen (z. B. /timer) liefern die App aus
        if (serveStatic(req, res, '/index.html')) return;
      }
      sendJson(res, 404, { error: 'Nicht gefunden' });
    } catch (e) {
      const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
      const upstream = !e.expose && /Maschine|Mühle|fetch failed|Zeitüberschreitung|ECONN|timeout|aborted/i.test(e.message + (e.cause?.message || ''));
      const code = e.expose ? status : upstream ? 502 : status;
      if (code >= 500) log.warn(`${req.method} ${p}: ${e.message}`);
      if (!res.headersSent) {
        const headers = e.retryAfter ? { 'Retry-After': String(e.retryAfter) } : {};
        sendJson(res, code, { error: e.expose || upstream || code < 500 ? e.message : 'Interner Fehler' }, headers);
      }
    }
  }

  function stream(req, res, ip) {
    const session = sessions.check(tokenFromRequest(req));
    if (!session) return sendJson(res, 401, { error: 'Nicht angemeldet' });
    if (streams.size >= MAX_STREAMS) return sendJson(res, 503, { error: 'Zu viele offene Verbindungen' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    send(res, 'snapshot', { machine: machine.snapshot(), grinder: grinder.snapshot(), server: serverInfo() });
    streams.add(res);
    updateViewers();
    const ping = setInterval(() => {
      if (!sessions.check(tokenFromRequest(req))) {
        res.end();
        return;
      }
      res.write(`: ping ${Date.now()}\n\n`);
    }, 20000);
    req.on('close', () => {
      clearInterval(ping);
      streams.delete(res);
      updateViewers();
    });
    log.debug(`Stream geöffnet von ${ip} (${streams.size} aktiv)`);
  }

  return { handle, machine, grinder, push, sessions, streams, scheduler, wake, setup, instance, startDevices, stop };
}

// --- Zugänge (Ports) ------------------------------------------------------------
// Werden beim Start geöffnet und nach Änderungen in den Server-Einstellungen ohne Neustart neu gebunden.
class Listeners {
  constructor(cfg, handler) {
    this.cfg = cfg;
    this.handler = handler;
    this.servers = new Map();
  }

  _tls() {
    return { cert: fs.readFileSync(this.cfg.https.cert), key: fs.readFileSync(this.cfg.https.key) };
  }

  apply() {
    for (const kind of ['http', 'lan', 'https']) {
      const c = this.cfg[kind];
      const spec = c?.enabled ? `${c.host}|${c.port}` : null;
      const cur = this.servers.get(kind);
      if (cur && cur.spec === spec && !cur.error) continue; // unverändert (fehlgeschlagene Zugänge neu versuchen)
      if (cur) {
        cur.server.close();
        cur.server.closeAllConnections?.();
        this.servers.delete(kind);
        log.info(`${kind.toUpperCase()} auf Port ${cur.port} geschlossen`);
      }
      if (spec) this._start(kind, spec);
    }
  }

  _start(kind, spec) {
    const c = this.cfg[kind];
    let server;
    if (kind === 'https') {
      const { created } = ensureCert(c.cert, c.key, { hosts: c.hosts });
      if (created) log.info('Selbstsigniertes TLS-Zertifikat erzeugt');
      server = https.createServer({ ...this._tls(), minVersion: 'TLSv1.2' }, this.handler);
    } else if (kind === 'lan') {
      server = http.createServer((req, res) => {
        req.lanPort = true;
        this.handler(req, res);
      });
    } else {
      server = http.createServer(this.handler);
      if (!['127.0.0.1', '::1', 'localhost'].includes(c.host)) {
        log.warn(`Unverschlüsseltes HTTP (Tunnel-Port) lauscht auf ${c.host}:${c.port} – nur in Docker oder hinter einer Firewall sinnvoll.`);
      }
    }
    server.headersTimeout = 20000;
    server.requestTimeout = 60000;
    server.keepAliveTimeout = 30000;
    const entry = { kind, spec, port: c.port, host: c.host, server, ok: false, error: null };
    server.on('error', (e) => {
      entry.error = e.code === 'EADDRINUSE' ? `Port ${c.port} ist belegt` : e.code === 'EACCES' ? `Keine Berechtigung für Port ${c.port}` : e.message;
      log.error(`${kind.toUpperCase()} auf ${c.host}:${c.port} nicht möglich: ${entry.error}`);
    });
    server.listen(c.port, c.host, () => {
      entry.ok = true;
      const scheme = kind === 'https' ? 'https' : 'http';
      const what = { http: 'für Cloudflare-Tunnel', lan: 'Heimnetz, unverschlüsselt', https: `Heimnetz, Zertifikat SHA-256 ${certFingerprint(c.cert)}` }[kind];
      log.info(`${scheme.toUpperCase()} (${what}) auf ${scheme}://${c.host}:${c.port}`);
    });
    this.servers.set(kind, entry);
  }

  reloadTls() {
    const e = this.servers.get('https');
    if (e) e.server.setSecureContext({ ...this._tls(), minVersion: 'TLSv1.2' });
  }

  status() {
    return [...this.servers.values()].map(({ kind, host, port, ok, error }) => ({ kind, host, port, ok, error }));
  }

  close() {
    for (const { server } of this.servers.values()) {
      server.close();
      server.closeAllConnections?.();
    }
  }
}

function printSetupBanner(cfg, code) {
  const docker = fs.existsSync('/.dockerenv');
  const urls = [];
  if (cfg.https.enabled) urls.push(`https://<IP-dieses-Rechners>:${docker ? 'veröffentlichter Port (Standard 8443)' : cfg.https.port}`);
  // Im Container ist der Tunnel-Port nicht veröffentlicht
  if (cfg.http.enabled && !docker) urls.push(`http://${['0.0.0.0', '::'].includes(cfg.http.host) ? '127.0.0.1' : cfg.http.host}:${cfg.http.port}`);
  const lines = [
    'ERSTEINRICHTUNG',
    '',
    'Im Browser öffnen:',
    ...urls.map((u) => `  ${u}`),
    '',
    `Einrichtungscode:  ${code}`,
    '',
    'Der Code gilt bis zur Einrichtung bzw. bis zum Neustart.',
  ];
  const w = Math.max(...lines.map((l) => l.length)) + 4;
  console.log(`\n┌${'─'.repeat(w)}┐\n${lines.map((l) => `│  ${l.padEnd(w - 2)}│`).join('\n')}\n└${'─'.repeat(w)}┘\n`);
}

// --- Start --------------------------------------------------------------------
async function main() {
  let cfg;
  try {
    cfg = loadConfig();
    setLogLevel(cfg.logLevel);
    prepare(cfg);
  } catch (e) {
    console.error(`\nKonfiguration fehlerhaft: ${e.message}\n`);
    process.exit(1);
  }
  const hooks = {};
  const app = createApp(cfg, hooks);
  const handler = (req, res) => {
    app.handle(req, res).catch((e) => {
      log.error(e.stack || e.message);
      try { res.end(); } catch { /* egal */ }
    });
  };
  const listeners = new Listeners(cfg, handler);
  hooks.onListeners = () => listeners.apply();
  hooks.onTls = () => listeners.reloadTls();
  hooks.listenerStatus = () => listeners.status();
  listeners.apply();

  if (app.setup.code) printSetupBanner(cfg, app.setup.code);
  else app.startDevices();
  log.info(`Xenios ${VERSION} · Konfiguration: ${cfg._file} · Xenia: ${cfg.machine.url} · Mühle: ${cfg.grinder.enabled ? cfg.grinder.url : 'aus'}`);

  const shutdown = () => {
    log.info('Beende …');
    app.stop();
    listeners.close();
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
