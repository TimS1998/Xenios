// Grind-by-Sync-Vermittler: Mühle (simuliert per HTTP) → Xenios → simulierte Xenia.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { createMockXenia } from '../mock/mock-devices.js';
import { createApp, Listeners } from '../src/index.js';
import { DEFAULTS, deepMerge } from '../src/config.js';
import { hashPassword } from '../src/auth.js';
import { generateVapidKeys } from '../src/push.js';
import { setLogLevel } from '../src/log.js';
import { gbsSteps, parseBody, HELPER_NAME } from '../src/gbs.js';

setLogLevel('error');
const PW = 'test-passwort-123';
let xenia, app, cfg, listeners, gbsPort, server, base, dataDir;

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await wait(50);
  }
  return false;
}

// Wie die Mühle: einfache HTTP-Anfrage ohne Browser-Header
function grinder(method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: gbsPort, method, path: p, headers: body ? { 'Content-Type': 'application/json', ...headers } : headers }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

before(async () => {
  xenia = createMockXenia({ speed: 8 });
  const xp = await listen(xenia.server);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenia-gbs-'));
  cfg = deepMerge(DEFAULTS, {
    auth: { passwordHash: hashPassword(PW) },
    machine: { url: `http://127.0.0.1:${xp}`, pollActiveMs: 200, pollIdleMs: 300, pollBackgroundMs: 300, slowPollMs: 2000 },
    grinder: { enabled: false, url: 'https://127.0.0.1:1' },
    push: { ...generateVapidKeys(), subject: 'mailto:test@example.com' },
    http: { enabled: false }, https: { enabled: false }, lan: { enabled: false },
    gbs: { enabled: true, host: '127.0.0.1', port: 0 },
    dataDir,
  });
  app = createApp(cfg);
  listeners = new Listeners(cfg, () => {}, app.gbs);
  listeners.apply();
  const entry = listeners.servers.get('gbs');
  if (!entry.server.listening) await once(entry.server, 'listening');
  gbsPort = entry.server.address().port;
  server = http.createServer((q, s) => app.handle(q, s));
  base = `http://127.0.0.1:${await listen(server)}`;
  xenia.state.MA_STATUS = 1;
});

after(() => {
  listeners.close();
  server.close();
  xenia.server.close();
  xenia.stop();
  app.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('Ersatz-Skript: Stopp beim Zielgewicht vorn, letzte Druckstufe verlängert', () => {
  const steps = [{ op: 13, args: [] }, { op: 27, args: [50] }, { op: 4, args: [9, 6] }, { op: 4, args: [6, 18] }, { op: 6, args: [] }];
  assert.deepEqual(gbsSteps(steps, 36.5), [
    { op: 27, args: [37] }, { op: 13, args: [] }, { op: 4, args: [9, 6] }, { op: 4, args: [6, 18] }, { op: 4, args: [6, 30] }, { op: 6, args: [] },
  ]);
  assert.deepEqual(gbsSteps(steps, 40, { extend: false }).map((s) => s.op), [27, 13, 4, 4, 6]);
  assert.deepEqual(gbsSteps([{ op: 3, args: [60, 20] }], 40).map((s) => s.op), [27, 3]); // ohne Druckstufe nichts anhängen
  assert.deepEqual(parseBody('{"ID":9}'), { ID: 9 });
  assert.deepEqual(parseBody('ID=9'), { ID: '9' });
  assert.deepEqual(parseBody('[1]'), {});
});

test('Mühle: Abfragen werden durchgereicht, nur Freigegebenes', async () => {
  const r = await grinder('GET', '/api/v2/mako');
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.text).MA_STATUS, 1);
  assert.equal(JSON.parse((await grinder('GET', '/api/v2/machine/')).text).MA_TYPE, 3);
  assert.equal((await grinder('GET', '/api/v2/scripts/alldelete')).status, 404);
  assert.equal((await grinder('POST', '/api/v2/general', { BG_SET_TEMP: 60 })).status, 404);
  assert.equal(xenia.state.dangerous || 0, 0);
  assert.equal(xenia.state.general.BG_SET_TEMP, 92);
  assert.equal((await grinder('POST', '/api/v2/scripts/execute', { ID: 7 })).status, 403);
  assert.equal((await grinder('GET', '/api/v2/mako', undefined, { Origin: 'http://evil.example' })).status, 403);
  assert.equal(xenia.state.MA_STATUS, 1);
  assert.ok(app.gbs.view().lastContact);
});

test('ohne gewähltes Profil: Skript 9 unverändert', async () => {
  assert.equal((await grinder('POST', '/api/v2/brewratio', { SYNC_BEVERAGE_WEIGHT: 36.5, SYNC_FILTER: '2' })).status, 200);
  assert.deepEqual(xenia.state.lastBrewRatio, { SYNC_BEVERAGE_WEIGHT: 36.5, SYNC_FILTER: '2' });
  assert.equal(app.gbs.view().lastGrind.weight, 36.5);
  assert.equal((await grinder('POST', '/api/v2/scripts/execute', { ID: 9 })).status, 200);
  assert.equal(xenia.state.brewing?.id, 9);
  assert.equal(app.gbs.view().lastStart.swapped, false);
  assert.ok(await until(() => xenia.state.MA_STATUS === 1));
});

test('mit Profil: Drehknopf startet das Profil mit Stopp am Zielgewicht', async () => {
  const before = xenia.state.log.filter((l) => l.startsWith('POST /api/v2/scripts/create')).length;
  await grinder('POST', '/api/v2/brewratio', { SYNC_BEVERAGE_WEIGHT: 20, SYNC_FILTER: '2' });
  const v = app.gbs.setChoice({ scriptId: 17 });
  assert.equal(v.scriptId, 17);
  assert.ok(await until(() => app.gbs.view().helperId !== null));
  const id = app.gbs.view().helperId;
  assert.deepEqual(xenia.state.scripts[id], { title: HELPER_NAME, content: '1;27 20;13;4 6000 30000;4 6000 30000;6;7;' });

  assert.equal((await grinder('POST', '/api/v2/scripts/execute', { ID: 9 })).status, 200);
  assert.equal(xenia.state.brewing?.id, id);
  assert.equal(xenia.state.brewing.stopAt, 20);
  const start = app.gbs.view().lastStart;
  assert.equal(start.swapped, true);
  assert.equal(start.title, '6 Bar');
  assert.equal(start.weight, 20);
  assert.equal(app.machine._pendingScript.id, id);
  assert.equal(app.machine._pendingScript.title, 'GbS: 6 Bar');
  // Bezug endet am Gewicht, nicht nach der festen Zeit (Mock: 27 s)
  assert.ok(await until(() => xenia.state.MA_STATUS !== 3));
  assert.ok(xenia.state.scale >= 20);
  assert.ok(xenia.state.extractionMs < 27000, `endete nach ${xenia.state.extractionMs} ms`);
  assert.ok(await until(() => xenia.state.MA_STATUS === 1));

  // Gleiches Rezept noch einmal: kein erneutes Schreiben des Skripts
  assert.equal((await grinder('POST', '/api/v2/scripts/execute', { ID: 9 })).status, 200);
  const after = xenia.state.log.filter((l) => l.startsWith('POST /api/v2/scripts/create')).length;
  assert.equal(after - before, 1);
  await grinder('GET', '/api/v2/mako');
  assert.ok(await until(() => xenia.state.MA_STATUS === 1, 12000));

  // Anderes Zielgewicht: Hilfsskript wird überschrieben, nicht neu angelegt
  await grinder('POST', '/api/v2/brewratio', { SYNC_BEVERAGE_WEIGHT: '42' });
  assert.ok(await until(() => xenia.state.scripts[id].content.startsWith('1;27 42;')));
  assert.equal(Object.values(xenia.state.scripts).filter((s) => s.title === HELPER_NAME).length, 1);
});

test('Profil fehlt: Rückfall auf Skript 9', async () => {
  app.gbs.setChoice({ scriptId: 99 });
  assert.equal((await grinder('POST', '/api/v2/scripts/execute', { ID: 9 })).status, 200);
  assert.equal(xenia.state.brewing?.id, 9);
  assert.equal(app.gbs.view().lastStart.swapped, false);
  assert.match(app.gbs.view().lastError, /99/);
  app.gbs.setChoice({ scriptId: null });
  assert.ok(await until(() => xenia.state.MA_STATUS === 1, 12000));
});

test('Auswahl prüfen', () => {
  assert.throws(() => app.gbs.setChoice({ scriptId: 9 }), /ID 10–199/);
  assert.throws(() => app.gbs.setChoice({ scriptId: 'x' }), /ID 10–199/);
  assert.throws(() => app.gbs.setChoice({ scriptId: app.gbs.view().helperId }), /Hilfsskript/);
  assert.throws(() => app.gbs.setChoice({ extend: 'ja' }), /an\/aus/);
});

test('andere IP als die Mühle: Verbindung wird getrennt', async () => {
  cfg.gbs.grinderIp = '192.0.2.7';
  await assert.rejects(grinder('GET', '/api/v2/mako'), /socket hang up|ECONNRESET/);
  assert.equal(app.gbs.view().refused.ip, '127.0.0.1');
  cfg.gbs.grinderIp = '127.0.0.1';
  assert.equal((await grinder('GET', '/api/v2/mako')).status, 200);
});

test('API: nur angemeldet, Einstellungen geprüft', async () => {
  assert.equal((await fetch(`${base}/api/gbs`)).status, 401);
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Xenia': '1' }, body: JSON.stringify({ password: PW }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const call = (method, p, body) => fetch(base + p, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Xenia': '1' }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json() }));
  let r = await call('PUT', '/api/gbs', { scriptId: 12, extend: false });
  assert.equal(r.status, 200);
  assert.equal(r.json.scriptId, 12);
  assert.equal(r.json.extend, false);
  r = await call('GET', '/api/gbs');
  assert.equal(r.json.grinderIp, '127.0.0.1');
  // Port 80 für beide geht nicht, IP muss eine IP sein
  r = await call('PUT', '/api/admin/config', { changes: { 'https.enabled': true, 'https.port': 8443, 'lan.enabled': true, 'lan.port': 80, 'gbs.port': 80 } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /Grind-by-Sync und Heimnetz-HTTP/);
  r = await call('PUT', '/api/admin/config', { changes: { 'gbs.grinderIp': 'muehle.fritz.box' } });
  assert.equal(r.status, 400);
  r = await call('PUT', '/api/admin/config', { changes: { 'https.enabled': true, 'gbs.grinderIp': null, 'grinder.url': 'https://hemro-muehle' } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /IP der Mühle/);
});
