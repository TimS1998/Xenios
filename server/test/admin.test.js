// Ersteinrichtung im Browser, Server-Einstellungen, Verschlüsselung der Geheimnisse, Zertifikats-Pinning, Deep-Link-Schutz.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createMockXenia, createMockGrinder } from '../mock/mock-devices.js';
import { createApp, prepare } from '../src/index.js';
import { loadConfig, secretBox, readConfigFile, migrateSecrets } from '../src/config.js';
import { GrinderHttp } from '../src/grinder.js';
import { isPushEndpoint } from '../src/push.js';
import { passwordProblem } from '../src/auth.js';
import { probeTunnel } from '../src/admin.js';
import { setLogLevel } from '../src/log.js';

setLogLevel('error');
const PW = 'Erster-Espresso-42';
let xenia, grinder, app, server, base, dir, cfgFile;
const jar = {};

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

before(async () => {
  xenia = createMockXenia({ speed: 8 });
  grinder = createMockGrinder({ password: 'mockpass' });
  const xp = await listen(xenia.server);
  const gp = await listen(grinder.server);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenia-admin-'));
  cfgFile = path.join(dir, 'config.json');
  // Wie ein frischer Container: nur Adressen vorgegeben, kein Passwort
  fs.writeFileSync(cfgFile, JSON.stringify({ machine: { url: `http://127.0.0.1:${xp}`, pollIdleMs: 300, pollActiveMs: 200, pollBackgroundMs: 300 }, grinder: { url: `https://127.0.0.1:${gp}` }, dataDir: '.' }));
  const cfg = loadConfig(cfgFile);
  prepare(cfg);
  app = createApp(cfg);
  server = http.createServer((q, s) => app.handle(q, s));
  base = `http://127.0.0.1:${await listen(server)}`;
});

after(() => {
  app.stop();
  server.close();
  xenia.server.close();
  xenia.stop();
  grinder.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function call(method, p, body, { headers = {}, who = 'a' } = {}) {
  const h = { ...headers };
  if (jar[who]) h.Cookie = jar[who];
  if (method !== 'GET') {
    h['Content-Type'] = 'application/json';
    h['X-Xenia'] ??= '1';
  }
  const res = await fetch(base + p, { method, headers: h, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}), redirect: 'manual' });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) jar[who] = setCookie.split(';')[0];
  let json = null;
  try { json = await res.json(); } catch { /* kein JSON */ }
  return { status: res.status, json, headers: res.headers };
}

test('Erststart: Push-Schlüssel erzeugt und verschlüsselt, Einrichtungsmodus aktiv', async () => {
  const raw = readConfigFile(cfgFile);
  assert.match(raw.push.privateKey, /^enc:v1:/);
  assert.ok(raw.push.publicKey.length > 60);
  assert.ok(fs.existsSync(path.join(dir, 'secret.key')));
  assert.match(app.setup.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  let r = await call('GET', '/auth/session');
  assert.deepEqual(r.json, { authenticated: false, setup: true });
  r = await call('POST', '/auth/login', { password: PW });
  assert.equal(r.status, 409);
  r = await call('GET', '/api/state');
  assert.equal(r.status, 401);
});

test('Einrichtung: falscher Code, schwaches Passwort, ungültige Adresse, dann Erfolg', async () => {
  let r = await call('POST', '/auth/setup/check', { code: 'AAAA-BBBB' });
  assert.equal(r.status, 401);
  r = await call('POST', '/auth/setup/check', { code: app.setup.code.toLowerCase().replace('-', ' ') });
  assert.equal(r.status, 200);
  r = await call('POST', '/auth/setup/probe', { code: app.setup.code, kind: 'machine', url: app.machine.client.url });
  assert.equal(r.json.ok, true);
  assert.match(r.json.name, /Xenia/);
  r = await call('POST', '/auth/setup/probe', { code: app.setup.code, kind: 'grinder', url: readConfigFile(cfgFile).grinder.url, password: 'mockpass' });
  assert.equal(r.json.login, true);
  assert.match(r.json.fingerprint, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  r = await call('POST', '/auth/setup', { code: app.setup.code, password: 'kurz' });
  assert.equal(r.status, 400);
  r = await call('POST', '/auth/setup', { code: app.setup.code, password: PW, machineUrl: 'http://x/../admin?y' });
  assert.equal(r.status, 400);
  r = await call('POST', '/auth/setup', { code: app.setup.code, password: PW, grinder: { enabled: true, password: 'mockpass' }, timezone: 'Europe/Berlin' });
  assert.equal(r.status, 200);
  assert.equal(app.setup.code, null);
  const raw = readConfigFile(cfgFile);
  assert.match(raw.auth.passwordHash, /^scrypt\$/);
  assert.match(raw.grinder.password, /^enc:v1:/, 'Mühlen-Passwort liegt verschlüsselt in config.json');
  assert.ok(!fs.readFileSync(cfgFile, 'utf8').includes('mockpass'));
  r = await call('GET', '/auth/session');
  assert.deepEqual(r.json, { authenticated: true, setup: false });
  r = await call('POST', '/auth/setup', { code: 'XXXX-XXXX', password: PW });
  assert.equal(r.status, 409, 'zweite Einrichtung nicht möglich');
});

test('Server-Einstellungen: lesen, ändern, sofort wirksam; Prüfungen', async () => {
  let r = await call('GET', '/api/admin/config');
  assert.equal(r.status, 200);
  assert.equal(r.json.values['grinder.password'], '', 'Passwort wird nie ausgeliefert');
  assert.equal(r.json.secrets['grinder.password'], true);
  assert.ok(r.json.timezones.includes('Europe/Berlin'));
  r = await call('PUT', '/api/admin/config', { changes: { 'features.paddle': false, 'auth.sessionDays': 30, logLevel: 'error' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.applied.sort(), ['auth.sessionDays', 'features.paddle', 'logLevel']);
  assert.equal(app.machine.features.paddle, false);
  assert.equal(app.sessions.days, 30);
  assert.equal(readConfigFile(cfgFile).features.paddle, false);
  r = await call('GET', '/api/machine/paddle');
  assert.equal(r.status, 403);
  for (const changes of [{ 'nope.key': 1 }, { 'machine.url': 'ftp://1.2.3.4' }, { 'http.port': 70000 }, { 'http.enabled': false, 'https.enabled': false }, { 'https.port': 8080 }, { timezone: 'Mars/Olympus' }]) {
    r = await call('PUT', '/api/admin/config', { changes });
    assert.equal(r.status, 400, JSON.stringify(changes));
  }
  r = await call('PUT', '/api/admin/config', { changes: { 'features.paddle': true } }, { headers: { 'X-Xenia': '0' } });
  assert.equal(r.status, 403, 'CSRF-Schutz gilt auch hier');
});

test('Per Umgebungsvariable festgelegte Werte sind gesperrt und landen nicht in der Datei', () => {
  process.env.XENIOS_HTTP_PORT = '9999';
  try {
    const cfg = loadConfig(cfgFile);
    assert.equal(cfg.http.port, 9999);
    assert.ok(cfg._locked.includes('http.port'));
    assert.notEqual(readConfigFile(cfgFile).http?.port, 9999);
  } finally {
    delete process.env.XENIOS_HTTP_PORT;
  }
});

test('Passwort ändern: altes Passwort nötig, andere Geräte abgemeldet', async () => {
  let r = await call('POST', '/auth/login', { password: PW }, { who: 'b' });
  assert.equal(r.status, 200);
  r = await call('POST', '/api/admin/password', { current: 'falsch-falsch', next: 'Neues-Passwort-77' });
  assert.equal(r.status, 401);
  r = await call('POST', '/api/admin/password', { current: PW, next: '1234567890' });
  assert.equal(r.status, 400);
  r = await call('POST', '/api/admin/password', { current: PW, next: 'Neues-Passwort-77' });
  assert.equal(r.status, 200);
  assert.equal((await call('GET', '/api/state')).status, 200, 'eigene Sitzung bleibt');
  assert.equal((await call('GET', '/api/state', undefined, { who: 'b' })).status, 401, 'andere Sitzung beendet');
  assert.equal((await call('POST', '/auth/login', { password: PW }, { who: 'c' })).status, 401);
  assert.equal((await call('POST', '/auth/login', { password: 'Neues-Passwort-77' }, { who: 'c' })).status, 200);
});

test('Einzelnes Gerät abmelden', async () => {
  let r = await call('GET', '/api/sessions');
  const other = r.json.sessions.find((s) => !s.current);
  assert.ok(other && r.json.sessions.some((s) => s.current));
  r = await call('DELETE', `/api/sessions/${other.id}`);
  assert.deepEqual(r.json, { ok: true, self: false });
  assert.equal((await call('GET', '/api/state', undefined, { who: 'c' })).status, 401);
  assert.equal((await call('DELETE', '/api/sessions/zzzzzzzz')).status, 404);
});

test('Zertifikat der Mühle vergessen und neu lernen', async () => {
  app.grinder.pinStore.data.fingerprint = 'AA:BB';
  let r = await call('POST', '/api/admin/grinder/unpin');
  assert.equal(r.status, 200);
  assert.equal(r.json.status.grinderPin, null);
  await app.grinder.sync();
  assert.match(app.grinder.pinnedFingerprint, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
});

test('App-Shortcut per Link von fremder Seite schaltet nicht', async () => {
  let r = await fetch(`${base}/?do=on`, { headers: { 'Sec-Fetch-Site': 'cross-site' }, redirect: 'manual' });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/');
  r = await fetch(`${base}/?do=on`, { headers: { 'Sec-Fetch-Site': 'none' }, redirect: 'manual' });
  assert.equal(r.status, 200);
  r = await fetch(`${base}/%E0%A4%A`);
  assert.equal(r.status, 200, 'kaputte %-Kodierung führt nicht zu 500 (App-Route)');
});

test('Pinning: bei fremdem Zertifikat geht kein einziges Byte an die Gegenstelle', async () => {
  const own = createMockGrinder({ password: 'mockpass' }); // eigene Mühle: der Server fragt die andere im Hintergrund ab
  const port = await listen(own.server);
  try {
    const t = new GrinderHttp({ url: `https://127.0.0.1:${port}`, pinnedFingerprint: 'AA:BB:CC' });
    await assert.rejects(t.request('POST', '/login.php', { form: { userRole: 'Owner', password: 'geheim' } }), /Zertifikat der Mühle hat sich geändert/);
    t.close();
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(own.state.requests, 0, 'Mühle hat keine Anfrage (und kein Passwort) erhalten');
    // Gegenprobe: mit dem richtigen Fingerprint klappt es
    const ok = new GrinderHttp({ url: `https://127.0.0.1:${port}` });
    await ok.request('POST', '/rest_api/get_machine_info');
    ok.close();
    assert.equal(own.state.requests, 1);
  } finally {
    own.server.close();
  }
});

test('Geheimnisse: AES-256-GCM, an den Feldnamen gebunden, falscher Schlüssel scheitert', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'xenia-box-'));
  try {
    const box = secretBox(d);
    const c = box.encrypt('geheim', 'grinder.password');
    assert.match(c, /^enc:v1:/);
    assert.notEqual(c, box.encrypt('geheim', 'grinder.password'), 'zufälliger IV');
    assert.equal(box.decrypt(c, 'grinder.password'), 'geheim');
    assert.throws(() => box.decrypt(c, 'push.privateKey'), /entschlüsseln/);
    process.env.XENIOS_SECRET_KEY = 'ein-anderer-schluessel';
    try {
      assert.throws(() => secretBox(d).decrypt(c, 'grinder.password'), /falscher Schlüssel/);
    } finally {
      delete process.env.XENIOS_SECRET_KEY;
    }
    // Klartext aus älteren Versionen wird beim Start verschlüsselt
    const f = path.join(d, 'config.json');
    fs.writeFileSync(f, JSON.stringify({ grinder: { password: 'alt-klartext' }, dataDir: '.' }));
    const cfg = loadConfig(f);
    assert.deepEqual(migrateSecrets(cfg), ['grinder.password']);
    assert.match(readConfigFile(f).grinder.password, /^enc:v1:/);
    assert.equal(loadConfig(f).grinder.password, 'alt-klartext');
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('Cloudflare-Tunnel: öffentliche Adresse prüfen, Test erkennt genau diesen Server', async () => {
  // /healthz nennt die Instanz, der Test vergleicht sie
  const hz = await fetch(`${base}/healthz`);
  assert.equal(hz.headers.get('x-xenios-instance'), app.instance);
  assert.deepEqual(await probeTunnel(base, app.instance).then((r) => r.ok), true);
  await assert.rejects(probeTunnel(base, 'andere-instanz'), /anderer Xenios-Server/);
  await assert.rejects(probeTunnel(app.machine.client.url, app.instance), /Unerwartete Antwort/);
  await assert.rejects(probeTunnel('http://127.0.0.1:1', app.instance), /Nicht erreichbar/);
  // Nur https://name.domain; Setzen der Adresse übernimmt sie als Push-Kontakt, solange dort der Platzhalter steht
  for (const v of ['http://xenios.example.org', 'https://xenios.example.org:8443', 'https://xenios.example.org/app']) {
    assert.equal((await call('PUT', '/api/admin/config', { changes: { publicUrl: v } })).status, 400, v);
  }
  let r = await call('PUT', '/api/admin/config', { changes: { publicUrl: 'https://xenios.example.org/' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.values.publicUrl, 'https://xenios.example.org');
  assert.equal(r.json.values['push.subject'], 'https://xenios.example.org');
  assert.match(r.json.status.tunnel.service, /^http:\/\/(xenios|127\.0\.0\.1):\d+$/);
  r = await call('POST', '/api/admin/probe', { kind: 'tunnel', url: 'ftp://x' });
  assert.equal(r.status, 400);
  r = await call('PUT', '/api/admin/config', { changes: { publicUrl: null } });
  assert.equal(r.json.values.publicUrl, null);
});

test('Push-Abos nur bei echten Push-Diensten, Passwort-Regeln', () => {
  assert.ok(isPushEndpoint('https://fcm.googleapis.com/fcm/send/abc'));
  assert.ok(isPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x'));
  assert.ok(isPushEndpoint('https://web.push.apple.com/QK'));
  assert.ok(!isPushEndpoint('https://192.168.178.1/admin'));
  assert.ok(!isPushEndpoint('https://evilgoogleapis.com/x'));
  assert.ok(!isPushEndpoint('http://fcm.googleapis.com/x'));
  assert.ok(!isPushEndpoint('https://fcm.googleapis.com:8443/x'));
  assert.equal(passwordProblem('Kaffee-und-Kuchen'), null);
  assert.ok(passwordProblem('aaaaaaaaaaaa'));
  assert.ok(passwordProblem('Password123'));
  assert.ok(passwordProblem('kurz'));
});
