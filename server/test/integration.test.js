// Ende-zu-Ende: echter Server gegen simulierte Xenia + Mühle.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createMockXenia, createMockGrinder } from '../mock/mock-devices.js';
import { createApp } from '../src/index.js';
import { DEFAULTS, deepMerge } from '../src/config.js';
import { hashPassword } from '../src/auth.js';
import { generateVapidKeys } from '../src/push.js';
import { setLogLevel } from '../src/log.js';

setLogLevel('error');
const PW = 'test-passwort-123';
let xenia, grinder, app, server, base, dataDir;
let cookie = '';

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

before(async () => {
  xenia = createMockXenia({ speed: 8 });
  grinder = createMockGrinder({ password: 'mockpass' });
  const xp = await listen(xenia.server);
  const gp = await listen(grinder.server);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenia-test-'));
  const cfg = deepMerge(DEFAULTS, {
    auth: { passwordHash: hashPassword(PW) },
    machine: { url: `http://127.0.0.1:${xp}`, pollActiveMs: 200, pollIdleMs: 300, pollBackgroundMs: 300, slowPollMs: 2000 },
    grinder: { enabled: true, url: `https://127.0.0.1:${gp}`, password: 'mockpass' },
    push: { ...generateVapidKeys(), subject: 'mailto:test@example.com' },
    dataDir,
  });
  app = createApp(cfg);
  server = http.createServer((q, s) => app.handle(q, s));
  base = `http://127.0.0.1:${await listen(server)}`;
  app.machine.start();
  app.grinder.start();
  await new Promise((r) => setTimeout(r, 800));
});

after(() => {
  app.machine.stop();
  app.grinder.stop();
  server.close();
  xenia.server.close();
  xenia.stop();
  grinder.server.close();
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

test('ohne Anmeldung: kein Zugriff, Sicherheits-Header gesetzt', async () => {
  const r = await call('GET', '/api/state', undefined, { auth: false });
  assert.equal(r.status, 401);
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  const stream = await fetch(base + '/api/stream');
  assert.equal(stream.status, 401);
});

test('Login: CSRF-Header nötig, falsches Passwort, dann Erfolg', async () => {
  let r = await call('POST', '/auth/login', { password: PW }, { headers: { 'X-Xenia': '0' }, auth: false });
  assert.equal(r.status, 403);
  r = await call('POST', '/auth/login', { password: 'falsch' }, { auth: false });
  assert.equal(r.status, 401);
  r = await call('POST', '/auth/login', { password: PW }, { auth: false });
  assert.equal(r.status, 200);
  cookie = r.headers.get('set-cookie').split(';')[0];
  assert.match(cookie, /^xs=/);
  r = await call('GET', '/auth/session');
  assert.equal(r.json.authenticated, true);
});

test('Cloudflare-Tunnel: sicheres Cookie nur über vertrauten Proxy', async () => {
  const r = await call('POST', '/auth/login', { password: PW }, { auth: false, headers: { 'X-Forwarded-Proto': 'https', 'CF-Connecting-IP': '198.51.100.7' } });
  assert.match(r.headers.get('set-cookie'), /^__Host-xs=.*; Secure/);
  assert.ok(r.headers.get('strict-transport-security'));
  const r2 = await call('POST', '/api/machine/power', { mode: 'on' }, { headers: { Origin: 'https://evil.example' } });
  assert.equal(r2.status, 403);
});

test('Heimnetz-HTTP: Proxy-Header werden nie ausgewertet', async () => {
  const lan = http.createServer((q, s) => { q.lanPort = true; app.handle(q, s); });
  const port = await listen(lan);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Xenia': '1', 'X-Forwarded-Proto': 'https', 'CF-Connecting-IP': '198.51.100.8' },
      body: JSON.stringify({ password: PW }),
    });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('set-cookie'), /^xs=/);
    assert.doesNotMatch(r.headers.get('set-cookie'), /Secure/);
  } finally {
    lan.close();
  }
});

test('Zustand, Einschalten, Dampf, Temperatur', async () => {
  let r = await call('GET', '/api/state');
  assert.equal(r.status, 200);
  assert.equal(r.json.machine.online, true);
  assert.equal(r.json.machine.statusKey, 'off');
  r = await call('POST', '/api/machine/power', { mode: 'on' });
  assert.deepEqual(r.json, { ok: true });
  assert.equal(xenia.state.MA_STATUS, 1);
  assert.equal(xenia.state.SB_STATUS, 2, 'Startmodus 1 → Dampfkessel an');
  const ctl = xenia.state.log.find((l) => l.startsWith('POST /api/v2/machine/control'));
  assert.equal(ctl, 'POST /api/v2/machine/control {"action":"1"}', 'exakt wie die Original-UI');
  r = await call('POST', '/api/machine/steam', { on: false });
  assert.equal(xenia.state.SB_STATUS, 1);
  r = await call('POST', '/api/machine/temperature', { group: 93.5 });
  assert.equal(r.status, 200);
  assert.equal(xenia.state.general.BG_SET_TEMP, 93.5);
  assert.equal(xenia.state.general.BB_SET_TEMP, 93.5);
  assert.equal(xenia.state.general.SB_SET_PRESS, 1.6, 'andere Werte bleiben unverändert');
  r = await call('POST', '/api/machine/temperature', { group: 120 });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /Brühgruppe/);
  r = await call('POST', '/api/machine/settings', { changes: { NOPE: 1 } });
  assert.equal(r.status, 400);
});

test('Skripte: Liste, Lesen, Anlegen, Bearbeiten, Löschen', async () => {
  let r = await call('GET', '/api/machine/scripts');
  assert.equal(r.json.scripts.length, 2);
  r = await call('GET', '/api/machine/scripts/12');
  assert.equal(r.json.title, 'Blooming Espresso');
  assert.deepEqual(r.json.steps[1], { op: 3, args: [40, 2] });
  r = await call('POST', '/api/machine/scripts', { name: 'Test 9bar', steps: [{ op: 13, args: [] }, { op: 4, args: [9, 25] }, { op: 6, args: [] }] });
  assert.equal(r.status, 200);
  assert.equal(r.json.instruction, '1;13;4 9000 25000;6;7;');
  const id = Object.keys(xenia.state.scripts).map(Number).find((k) => xenia.state.scripts[k].title === 'Test 9bar');
  assert.ok(id >= 10);
  r = await call('PUT', `/api/machine/scripts/${id}`, { name: 'Test 8bar', steps: [{ op: 4, args: [8, 20] }] });
  assert.equal(r.status, 200);
  assert.equal(xenia.state.scripts[id].title, 'Test 8bar');
  assert.equal(xenia.state.scripts[id].content, '1;4 8000 20000;7;');
  r = await call('POST', '/api/machine/scripts', { name: 'ungültig ä', steps: [{ op: 6 }] });
  assert.equal(r.status, 400);
  r = await call('DELETE', `/api/machine/scripts/${id}`);
  assert.equal(r.status, 200);
  assert.equal(xenia.state.scripts[id], undefined);
  r = await call('DELETE', '/api/machine/scripts/7');
  assert.equal(r.status, 400, 'eingebaute Skripte nicht löschbar');
});

test('Timer: Minuten ↔ Firmware-Format', async () => {
  let r = await call('GET', '/api/machine/timers');
  const sat = r.json.days.find((d) => d.day === 'SATURDAY');
  assert.deepEqual(sat, { day: 'SATURDAY', on: 480, off: 690, brew: true, steam: true, enabled: true });
  const days = r.json.days.map((d) => (d.day === 'MONDAY' ? { ...d, enabled: true, on: 390, off: 540, brew: true, steam: false } : d));
  r = await call('PUT', '/api/machine/timers', { days, ecoAfterMin: 25, offAfterMin: 0 });
  assert.equal(r.status, 200);
  const post = xenia.state.log.filter((l) => l.startsWith('POST /api/v2/timer2 ')).at(-1);
  const body = JSON.parse(post.slice('POST /api/v2/timer2 '.length));
  assert.equal(body.TI_MONDAY_ON1, 390 * 60, 'POST erwartet Sekunden');
  assert.equal(body.TI_MONDAY_ON1_STATUS, 1);
  assert.equal(body.TI_THUSRDAY_ON1, 0, 'Firmware-Schreibweise THUSRDAY');
  r = await call('GET', '/api/machine/timers');
  const mon = r.json.days[0];
  assert.deepEqual([mon.on, mon.off, mon.brew, mon.steam, mon.enabled], [390, 540, true, false, true]);
  assert.equal(r.json.ecoAfterMin, 25);
  assert.equal(r.json.offAfterMin, 0);
});

test('Bezug: Erkennung, Verlauf, Ereignis', async () => {
  const events = [];
  app.machine.on('event', (e) => events.push(e));
  await until(async () => (await call('GET', '/api/state')).json.machine.heated, 10000);
  const r = await call('POST', '/api/machine/scripts/8/run');
  assert.equal(r.status, 200);
  assert.ok(await until(async () => (await call('GET', '/api/state')).json.machine.shot.running, 4000), 'Bezug läuft');
  assert.ok(await until(async () => events.some((e) => e.topic === 'shot'), 12000), 'Ereignis "Bezug fertig"');
  const shots = (await call('GET', '/api/shots')).json.shots;
  assert.ok(shots.length >= 1);
  assert.ok(shots[0].timeMs >= 20000);
  assert.ok(shots[0].curve.length > 3);
});

test('Uhr stellen, Paddle, Diagnose', async () => {
  let r = await call('POST', '/api/machine/clock/sync');
  assert.equal(r.status, 200);
  assert.equal(xenia.state.lastSync.TZ_STR, 'CET-1CEST,M3.5.0,M10.5.0/3');
  assert.ok(Math.abs(xenia.state.lastSync.UTC_EPOCH - Date.now() / 1000) < 5);
  await until(async () => xenia.state.MA_STATUS === 1, 6000);
  r = await call('POST', '/api/machine/paddle', { level: 40 });
  assert.equal(r.status, 200);
  assert.equal(xenia.state.pumpPw, 40);
  r = await call('GET', '/api/machine/paddle');
  assert.ok(r.json.pressure > 0);
  r = await call('POST', '/api/machine/paddle/stop');
  assert.equal(xenia.state.pumpPw, 0);
  r = await call('GET', '/api/raw/machine/scripts/alldelete');
  assert.equal(r.status, 403);
  r = await call('GET', '/api/raw/machine/network/forget');
  assert.equal(r.status, 403);
  r = await call('GET', '/api/machine/details');
  assert.match(r.json.machine.MA_SN, /^…\d{4}$/, 'Seriennummer gekürzt');
});

test('Mühle: Login, Statistik, Downloads; DB-Download standardmäßig gesperrt', async () => {
  const ok = await until(async () => (await call('GET', '/api/grinder')).json.stats !== null, 8000);
  assert.ok(ok);
  const g = (await call('GET', '/api/grinder')).json;
  assert.equal(g.info.typeName, 'E64 WS');
  assert.equal(g.stats.totalGrinds, 180);
  assert.equal(g.recipes.filter((r) => r.active).length, 2);
  assert.equal(g.settings.coffeeMachine.manufacturer, 'Xenia');
  assert.ok(!JSON.stringify(g).includes('mock-secret-not-real'), 'WLAN-Passwort der Mühle darf nie herausgegeben werden');
  let r = await fetch(base + '/api/grinder/grinds.csv', { headers: { Cookie: cookie } });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /^grind_id,grind_uuid/);
  r = await fetch(base + '/api/grinder/logs.zip', { headers: { Cookie: cookie } });
  assert.equal(r.status, 200);
  r = await fetch(base + '/api/grinder/database', { headers: { Cookie: cookie } });
  assert.equal(r.status, 403);
  // Sitzung bei der Mühle abgelaufen → automatisch neu anmelden
  app.grinder.http.cookies.clear();
  r = await call('POST', '/api/grinder/refresh');
  assert.equal(r.status, 200);
});

test('Skript exportieren und importieren, Zeitzone wählen', async () => {
  const list = (await call('GET', '/api/machine/scripts')).json.scripts;
  const src = list.find((s) => s.id > 9);
  let r = await fetch(`${base}/api/machine/scripts/${src.id}/export`, { headers: { Cookie: cookie } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /Xenia-.*\.script/);
  const file = await r.text();
  assert.equal(Object.keys(JSON.parse(file)).length, 1);
  r = await call('POST', '/api/machine/scripts/import', { file, name: 'Importiert' });
  assert.equal(r.status, 200);
  assert.ok((await call('GET', '/api/machine/scripts')).json.scripts.some((s) => s.title === 'Importiert'));
  r = await call('POST', '/api/machine/scripts/import', { file: '{"a":"kein skript"}' });
  assert.equal(r.status, 400);
  r = await call('GET', '/api/machine/timezones');
  assert.equal(r.json.current, 322);
  assert.equal(r.json.list[0].name, 'Europe/Berlin');
  r = await call('POST', '/api/machine/clock/sync', { tz: 322 });
  assert.equal(r.status, 200);
  assert.equal(xenia.state.lastSync.TZ_IND, '322');
});

test('Bezugs-Protokoll: nachträglich erkannte Bezüge, CSV, bleibt nach Neustart', async () => {
  const m = app.machine;
  const before = m.history.data.shots.length;
  const counter = m.history.data.counter ?? 100;
  m.history.data.counter = counter;
  m._liveShots = 0;
  m._lastDiag = { EXTRACTION_TIME_MS: 27500, PU_LOADCELL_VOLUME: 36.2 };
  m._checkCounter(counter + 2, '');
  assert.equal(m.history.data.shots.length, before + 2);
  const newest = m.history.data.shots[0];
  assert.equal(newest.estimated, true);
  assert.equal(newest.timeMs, 27500);
  assert.equal(newest.weight, 36.2);
  assert.equal(newest.no, counter + 2);
  // Live erkannte Bezüge werden nicht doppelt gezählt
  m._liveShots = 1;
  m._checkCounter(counter + 3, '');
  assert.equal(m.history.data.shots.length, before + 2);
  let r = await call('GET', '/api/shots');
  assert.ok(r.json.total >= before + 2);
  r = await fetch(`${base}/api/shots.csv`, { headers: { Cookie: cookie } });
  assert.equal(r.status, 200);
  const csv = await r.text();
  assert.match(csv, /Nr;Ende;Dauer/);
  assert.match(csv, /;27,5;36,2;/);
  // Neustart: Protokoll aus der Datei, letzter Bezug sofort sichtbar
  m.history.flush();
  const { Machine } = await import('../src/machine.js');
  const again = new Machine(deepMerge(DEFAULTS, { dataDir }));
  assert.equal(again.shots(1)[0].no, counter + 2);
  assert.equal(again.snapshot().lastShot.no, counter + 2);
});

test('Tastenbelegung ändern', async () => {
  let r = await call('PUT', '/api/machine/switches', { buttons: { RIGHT_RIGHT: { long: 8 } } });
  assert.equal(r.status, 200);
  r = await call('GET', '/api/machine/switches');
  assert.equal(r.json.buttons.RIGHT_RIGHT.long, 8);
  assert.equal(r.json.buttons.RIGHT_RIGHT.short, 7);
  r = await call('PUT', '/api/machine/switches', { buttons: { LEFT_LEFT: { short: 555 } } });
  assert.equal(r.status, 400);
  await call('PUT', '/api/machine/switches', { buttons: { RIGHT_RIGHT: { long: 0 } } });
});

test('Server-Zeitplan: speichern, prüfen, zur passenden Minute schalten', async () => {
  let r = await call('PUT', '/api/schedule', { rules: [{ time: '25:00', days: [0], action: 'on' }] });
  assert.equal(r.status, 400);
  r = await call('PUT', '/api/schedule', { rules: [{ time: '06:30', days: [0, 1, 2, 3, 4], action: 'on', label: 'Werktags' }, { time: '07:45', days: [5, 6], action: 'eco' }] });
  assert.equal(r.status, 200);
  assert.equal(r.json.rules.length, 2);
  assert.equal((await call('GET', '/api/schedule')).json.rules[0].label, 'Werktags');
  await call('POST', '/api/machine/power', { mode: 'off' });
  const before = xenia.state.log.length;
  // Montag 06:30 → einschalten, zweiter Durchlauf in derselben Minute schaltet nicht erneut
  await app.scheduler.tick(new Date(2026, 9, 19, 6, 30, 5));
  await app.scheduler.tick(new Date(2026, 9, 19, 6, 30, 40));
  const sent = xenia.state.log.slice(before).filter((l) => l.includes('machine/control'));
  assert.equal(sent.length, 1);
  // Dienstag 07:45 → nichts (Regel nur Sa/So)
  await app.scheduler.tick(new Date(2026, 9, 20, 7, 45));
  assert.equal(xenia.state.log.slice(before).filter((l) => l.includes('machine/control')).length, 1);
  await call('PUT', '/api/schedule', { rules: [] });
});

test('Wecker: Handys melden, frühester Wecker zählt, Einschalten mit Vorlauf', async () => {
  const dev = async (name) => ({ Authorization: `Bearer ${(await call('POST', '/auth/device', { password: PW, name }, { auth: false })).json.token}` });
  const a = await dev('Handy A');
  const b = await dev('Handy B');
  // Ein Montag in der Zukunft: A um 06:30, B um 05:50; 14:00-Wecker (außerhalb des Fensters) zählt nicht
  const mon = new Date();
  mon.setDate(mon.getDate() + 7 + ((8 - mon.getDay()) % 7));
  const at = (h, m) => new Date(mon.getFullYear(), mon.getMonth(), mon.getDate(), h, m).getTime();
  let r = await call('POST', '/api/wake/alarm', { next: at(6, 30) }, { auth: false, headers: a });
  assert.equal(r.status, 200);
  await call('POST', '/api/wake/alarm', { next: at(5, 50) }, { auth: false, headers: b });
  r = await call('PUT', '/api/wake', { config: { enabled: true, leadMin: 20, from: '04:00', to: '10:00' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.plan.device, 'Handy B');
  assert.equal(r.json.plan.at, at(5, 30));
  // Handy B abwählen → A zählt
  const idB = r.json.devices.find((d) => d.name === 'Handy B').id;
  r = await call('PUT', '/api/wake', { devices: { [idB]: false } });
  assert.equal(r.json.plan.device, 'Handy A');
  assert.equal((await call('PUT', '/api/wake', { config: { leadMin: 500 } })).status, 400);
  await call('POST', '/api/wake/alarm', { next: at(14, 0) }, { auth: false, headers: a });
  assert.equal(app.wake.plan(at(4, 0)), null);
  // zurück auf 06:30, Maschine aus → um 06:10 einschalten, nur einmal
  await call('POST', '/api/wake/alarm', { next: at(6, 30) }, { auth: false, headers: a });
  await call('POST', '/api/machine/power', { mode: 'off' });
  await until(() => app.machine.snapshot().statusKey === 'off');
  const before = xenia.state.log.length;
  await app.wake.tick(at(6, 5));
  assert.equal(xenia.state.log.slice(before).filter((l) => l.includes('machine/control')).length, 0);
  await app.wake.tick(at(6, 10));
  await app.wake.tick(at(6, 11));
  assert.equal(xenia.state.log.slice(before).filter((l) => l.includes('machine/control')).length, 1);
  // Widget zeigt das nächste geplante Einschalten
  await call('PUT', '/api/wake', { config: { enabled: true } });
  const w = await call('GET', '/api/widget', undefined, { auth: false, headers: a });
  assert.equal(w.json.next.at, at(6, 10));
  assert.match(w.json.next.reason, /Wecker Handy A/);
  await call('PUT', '/api/wake', { config: { enabled: false } });
});

test('Android-App: Geräte-Token, Bearer-Zugriff, Widget-Zustand', async () => {
  let r = await call('POST', '/auth/device', { password: 'falsch', name: 'Pixel' }, { auth: false });
  assert.equal(r.status, 401);
  r = await call('POST', '/auth/device', { password: PW, name: 'Pixel 8' }, { auth: false });
  assert.equal(r.status, 200);
  const bearer = { Authorization: `Bearer ${r.json.token}` };
  r = await call('GET', '/api/widget', undefined, { auth: false, headers: bearer });
  assert.equal(r.status, 200);
  assert.equal(typeof r.json.online, 'boolean');
  assert.ok('status' in r.json && 'group' in r.json);
  // Schalten per Bearer braucht wie jede Änderung den X-Xenia-Header
  r = await call('POST', '/api/machine/power', { mode: 'on' }, { auth: false, headers: { ...bearer, 'X-Xenia': '0' } });
  assert.equal(r.status, 403);
  r = await call('POST', '/api/machine/power', { mode: 'on' }, { auth: false, headers: bearer });
  assert.equal(r.status, 200);
  r = await call('GET', '/api/sessions');
  assert.ok(r.json.sessions.some((s) => s.ua === 'Android-App: Pixel 8'));
  r = await call('GET', '/api/widget', undefined, { auth: false, headers: { Authorization: 'Bearer ungueltig' } });
  assert.equal(r.status, 401);
});

test('Keine gefährlichen Aufrufe an die Geräte', () => {
  assert.equal(xenia.state.dangerous || 0, 0);
  assert.equal(grinder.state.dangerous, 0);
  const gets = xenia.state.log.filter((l) => l.startsWith('GET'));
  assert.ok(!gets.some((l) => /alldelete|forget|tara|get_time|forcescan/.test(l)));
});

test('Abmelden entwertet die Sitzung', async () => {
  let r = await call('POST', '/auth/logout');
  assert.equal(r.status, 200);
  r = await call('GET', '/api/state');
  assert.equal(r.status, 401);
});
