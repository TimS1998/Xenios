// Direkt-Modus der Android-App: Web-Backend (public/js/direct/backend.js) gegen die simulierte Xenia + Mühle.
// Die App-Brücke (window.XeniaApp) wird hier mit Node-HTTP nachgebaut, so wie sie die Kotlin-Seite bereitstellt.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { createMockXenia, createMockGrinder } from '../mock/mock-devices.js';
import { setLogLevel } from '../src/log.js';

setLogLevel('error');
let xenia, grinder, backend, saved;
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

function bridgeHttp(id, json) {
  const req = JSON.parse(json);
  const url = new URL(req.url);
  const lib = url.protocol === 'https:' ? https : http;
  const body = req.body ? Buffer.from(req.body, 'base64') : null;
  const r = lib.request(url, { method: req.method, headers: { ...req.headers, ...(body ? { 'Content-Length': body.length } : {}) }, rejectUnauthorized: !req.insecureTls, timeout: req.timeoutMs }, (res) => {
    const cert = res.socket?.getPeerCertificate?.();
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => {
      const headers = {};
      for (const [k, v] of Object.entries(res.headers)) headers[k] = [].concat(v);
      globalThis.window.__xeniaHttpDone(id, JSON.stringify({
        status: res.statusCode, headers, body: Buffer.concat(chunks).toString('base64'),
        fingerprint: cert?.raw ? crypto.createHash('sha256').update(cert.raw).digest('hex') : null,
      }));
    });
  });
  r.on('timeout', () => r.destroy(new Error('Zeitüberschreitung')));
  r.on('error', (e) => globalThis.window.__xeniaHttpDone(id, JSON.stringify({ error: e.message })));
  if (body) r.write(body);
  r.end();
}

before(async () => {
  xenia = createMockXenia({ speed: 8 });
  grinder = createMockGrinder({ password: 'mockpass' });
  const xp = await listen(xenia.server);
  const gp = await listen(grinder.server);
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
  globalThis.document = { addEventListener() {} };
  globalThis.window = {
    XeniaApp: {
      mode: () => 'direct',
      directConfig: () => JSON.stringify({ machineUrl: `http://127.0.0.1:${xp}`, grinderUrl: `https://127.0.0.1:${gp}`, grinderPassword: 'mockpass', version: 'test' }),
      http: bridgeHttp,
      saveFile: (name, type, b64) => { saved = { name, type, data: Buffer.from(b64, 'base64') }; },
      reauth() {},
    },
  };
  const { createDirectBackend } = await import('../web/js/direct/backend.js');
  backend = createDirectBackend();
});

after(() => {
  backend.pause();
  xenia.server.close();
  xenia.stop();
  grinder.server.close();
});

const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
};

test('Direkt-Modus: Zustand, Schalten, Skripte, Timer über die App-Brücke', async () => {
  const events = [];
  const unsub = backend.subscribe((name, data) => events.push([name, data]));
  backend.resume();
  const online = await until(() => events.some(([n, d]) => n === 'machine' && d.online));
  assert.ok(online, JSON.stringify((await backend.handle('GET', '/api/state')).data.machine.error));
  let r = await backend.handle('GET', '/api/state');
  assert.equal(r.status, 200);
  assert.equal(r.data.server.mode, 'direct');
  assert.equal((await backend.handle('GET', '/auth/session')).data.authenticated, true);
  r = await backend.handle('POST', '/api/machine/power', { mode: 'on' });
  assert.equal(r.status, 200);
  assert.ok(await until(async () => (await backend.handle('GET', '/api/state')).data.machine.statusKey === 'on'));
  r = await backend.handle('GET', '/api/machine/scripts');
  assert.ok(r.data.scripts.length > 0);
  r = await backend.handle('GET', `/api/machine/scripts/${r.data.scripts[0].id}/export`);
  assert.match(r.download.filename, /\.script$/);
  r = await backend.handle('GET', '/api/machine/timers');
  assert.equal(r.data.days.length, 7);
  r = await backend.handle('GET', '/api/schedule');
  assert.equal(r.status, 409);
  r = await backend.handle('GET', '/api/raw/machine/network/forget');
  assert.equal(r.status, 403);
  unsub();
});

test('Direkt-Modus: Mühle mit Login, Zertifikat gemerkt, CSV-Download', async () => {
  let r = await backend.handle('POST', '/api/grinder/refresh');
  assert.equal(r.status, 200, r.data?.error);
  assert.ok(r.data.online);
  assert.ok(r.data.recipes.length > 0);
  assert.ok(localStorage.getItem('xenia.grinderPin'));
  r = await backend.handle('GET', '/api/grinder/grinds.csv');
  assert.equal(r.status, 200, r.data?.error);
  assert.match(r.download.filename, /GrindLogs/);
  r = await backend.handle('GET', '/api/grinder/database');
  assert.equal(r.status, 403);
});
