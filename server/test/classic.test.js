// Alte Xenia (DBL-API): Endpunkte weichen von der Brew-by-Sync-Firmware ab.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createMockXenia } from '../mock/mock-devices.js';
import { createApp } from '../src/index.js';
import { DEFAULTS, deepMerge } from '../src/config.js';
import { hashPassword } from '../src/auth.js';
import { setLogLevel } from '../src/log.js';
import { normalizeLive, machineApiId } from '../web/shared/machine-api.js';

setLogLevel('error');
const PW = 'test-passwort-123';
let xenia, app, server, base, dataDir;
let cookie = '';

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

before(async () => {
  xenia = createMockXenia({ speed: 8, api: 'classic' });
  const xp = await listen(xenia.server);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenia-classic-'));
  const cfg = deepMerge(DEFAULTS, {
    auth: { passwordHash: hashPassword(PW) },
    machine: { url: `http://127.0.0.1:${xp}`, api: 'classic', pollActiveMs: 200, pollIdleMs: 300, pollBackgroundMs: 300, slowPollMs: 400 },
    grinder: { enabled: false, url: 'https://127.0.0.1:1' },
    dataDir,
  });
  app = createApp(cfg);
  server = http.createServer((q, s) => app.handle(q, s));
  base = `http://127.0.0.1:${await listen(server)}`;
  app.machine.start();
  await new Promise((r) => setTimeout(r, 500));
  const login = await call('POST', '/auth/login', { password: PW }, { auth: false });
  cookie = login.headers.get('set-cookie').split(';')[0];
});

after(() => {
  app.machine.stop();
  server.close();
  xenia.server.close();
  xenia.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function call(method, p, body, { headers = {}, auth = true } = {}) {
  const h = { ...headers };
  if (auth && cookie) h.Cookie = cookie;
  if (method !== 'GET') {
    h['Content-Type'] = 'application/json';
    if (!('X-Xenia' in h)) h['X-Xenia'] = '1';
  }
  const res = await fetch(base + p, { method, headers: h, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* Text */ }
  return { status: res.status, json, text, headers: res.headers };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await wait(100);
  }
  return false;
}

test('API-Profil: classic vs bbs', () => {
  assert.equal(machineApiId('classic'), 'classic');
  assert.equal(machineApiId('bbs'), 'bbs');
  assert.equal(machineApiId(undefined), 'bbs');
  const live = normalizeLive({ SCALE_WEIGHT: 18.4, PU_SENS_SCALE_RATE: 1.2, MA_STATUS: 3 });
  assert.equal(live.PU_LOADCELL_VOLUME, 18.4);
  assert.equal(live.PU_LOADCELL_RATE, 1.2);
});

test('Probe erkennt die alte API', async () => {
  const r = await call('POST', '/api/admin/probe', { kind: 'machine', url: app.machine.client.url });
  assert.equal(r.status, 200);
  assert.equal(r.json.apiHint, 'classic');
  assert.match(r.json.name, /Dual Boiler|Xenia/);
});

test('Ein/Aus/Eco und Dampf über control-Aktionen', async () => {
  assert.equal((await call('POST', '/api/machine/power', { mode: 'on' })).status, 200);
  assert.ok(await until(() => app.machine.state.status === 1));
  assert.equal(xenia.state.SB_STATUS, 2);
  assert.equal((await call('POST', '/api/machine/steam', { on: false })).status, 200);
  assert.ok(await until(() => xenia.state.SB_STATUS === 1));
  assert.equal((await call('POST', '/api/machine/power', { mode: 'eco' })).status, 200);
  assert.ok(await until(() => app.machine.state.status === 2));
  assert.equal((await call('POST', '/api/machine/power', { mode: 'off' })).status, 200);
  assert.ok(await until(() => app.machine.state.status === 0));
});

test('Temperatur und Dampfdruck über inc_dec', async () => {
  let r = await call('GET', '/api/machine/settings');
  assert.equal(r.status, 200);
  assert.equal(r.json.settings.BG_SET_TEMP, 92);
  r = await call('POST', '/api/machine/settings', { changes: { BG_SET_TEMP: 93.5, BB_SET_TEMP: 94, SB_SET_PRESS: 1.4 } });
  assert.equal(r.status, 200);
  assert.equal(xenia.state.general.BG_SET_TEMP, 93.5);
  assert.equal(xenia.state.general.BB_SET_TEMP, 94);
  assert.equal(xenia.state.general.SB_SET_PRESS, 1.4);
  r = await call('POST', '/api/machine/settings', { changes: { BG_SET_ECO_TEMP: 70 } });
  assert.equal(r.status, 400);
});

test('Skriptliste über /scripts/list, Paddle und Uhr fehlen', async () => {
  const list = await call('GET', '/api/machine/scripts');
  assert.equal(list.status, 200);
  assert.ok(list.json.scripts.some((s) => s.title === 'Blooming Espresso'));
  assert.equal((await call('GET', '/api/machine/paddle')).status, 409);
  assert.equal((await call('POST', '/api/machine/clock/sync', {})).status, 409);
  const t = await call('GET', '/api/machine/timers');
  assert.equal(t.status, 200);
  assert.equal(t.json.weekly, false);
});

test('Live-Daten und Bezug ohne EXTRACTION_TIME_MS', async () => {
  await call('POST', '/api/machine/power', { mode: 'on' });
  assert.ok(await until(() => app.machine.state.status === 1));
  const run = await call('POST', '/api/machine/scripts/12/run');
  assert.equal(run.status, 200);
  assert.ok(await until(() => app.machine.state.shot.running));
  await wait(400);
  assert.ok(app.machine.state.shot.timeMs > 0, 'Bezugszeit kommt von der Uhr, nicht von EXTRACTION_TIME_MS');
  await call('POST', '/api/machine/scripts/stop');
  assert.ok(await until(() => !app.machine.state.shot.running));
});

test('Server-Info: keine Mühle, alte API', async () => {
  const r = await call('GET', '/api/state');
  assert.equal(r.json.server.machine.api, 'classic');
  assert.equal(r.json.server.grinder.enabled, false);
  assert.equal(r.json.machine.api, 'classic');
});
