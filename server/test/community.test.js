// Profile von visualizer.coffee: Umrechnung des gemessenen Drucks in Skript-Schritte, Suche und Abruf über den Server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scriptName, pressureSteps, profileFromShot, summarize } from '../web/shared/visualizer.js';
import { buildScript } from '../web/shared/machine-core.js';
import { communityRoutes } from '../src/community.js';

const ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
// Bezug mit 8 s Vorbrühen bei 3 bar, 5 s Pause ohne Druck, 20 s bei 9 bar, Abfall auf 6 bar
const t = Array.from({ length: 81 }, (_, i) => i * 0.5);
const p = t.map((x) => (x < 8 ? 3 : x < 13 ? 0.2 : x < 33 ? 9 : 9 - (x - 33) * 0.4));
const shot = {
  id: ID, profile_title: 'Blooming Espresso (Rao) ✓', user_name: 'Anna', bean_brand: 'Röstwerk', bean_type: 'Kenia',
  bean_weight: '18.0', drink_weight: '40.5', duration: '40.1', espresso_enjoyment: 85, roast_level: 'light',
  timeframe: t.map(String), data: { espresso_pressure: p.map(String), espresso_weight: t.map((x) => String(x < 14 ? 0 : (x - 14) * 1.5)) },
};

test('Skriptnamen: Umlaute umschreiben, nur erlaubte Zeichen, höchstens 40', () => {
  assert.equal(scriptName('Röstwerk Süß & Spaß'), 'Roestwerk Suess Spass');
  assert.equal(scriptName('Café crème – 1:2'), 'Cafe creme 1 2');
  assert.equal(scriptName('!!!', 'Fallback'), 'Fallback');
  assert.equal(scriptName('x'.repeat(60)).length, 40);
});

test('Gemessener Druck wird zu Stufen mit Pause', () => {
  const steps = pressureSteps(t, p);
  assert.deepEqual(steps[0], { op: 13, args: [] }, 'Brühventil zuerst');
  assert.deepEqual(steps.at(-1), { op: 6, args: [] }, 'Pumpe am Ende aus');
  const pre = steps[1];
  assert.equal(pre.op, 4);
  assert.ok(Math.abs(pre.args[0] - 3) < 0.3 && Math.abs(pre.args[1] - 8) <= 1, `Vorbrühen ~3 bar/8 s: ${pre.args}`);
  const pause = steps.findIndex((s) => s.op === 12);
  assert.ok(pause > 0 && steps[pause - 1].op === 6, 'Pause = Pumpe aus + Warten');
  assert.ok(Math.abs(steps[pause].args[0] - 5) <= 1);
  const main = steps.slice(pause + 1).filter((s) => s.op === 4);
  assert.ok(main.some((s) => s.args[0] >= 8.5), 'Hauptdruck um 9 bar');
  assert.ok(main.at(-1).args[0] < 7.5, 'Abfall am Ende');
  assert.ok(steps.filter((s) => s.op === 4).length <= 14);
  assert.match(buildScript(steps), /^1;13;4 \d+ \d+;.*;6;7;$/, 'gültiges Skript für die Maschine');
  assert.equal(pressureSteps([0, 1], [1, 2]), null, 'zu wenig Messpunkte');
});

test('Visualizer-Bezug → Profil mit Eckdaten', () => {
  const prof = profileFromShot(shot);
  assert.equal(prof.name, 'Blooming Espresso Rao');
  assert.equal(prof.info.ratio, 2.3);
  assert.equal(prof.info.bean, 'Röstwerk · Kenia');
  assert.equal(prof.info.url, `https://visualizer.coffee/shots/${ID}`);
  assert.ok(prof.curve.length > 70 && prof.curve.every((c) => c.length === 4));
  assert.equal(profileFromShot({ id: ID, timeframe: [], data: {} }), null);
  assert.deepEqual(summarize(shot), { id: ID, title: 'Blooming Espresso (Rao) ✓', user: 'Anna', bean: 'Röstwerk · Kenia', roast: 'light', dose: 18, yield: 40.5, ratio: 2.3, time: 40.1, enjoyment: 85 });
});

function routes(fetchImpl) {
  const r = {};
  communityRoutes((m, path, fn) => { r[`${m} ${path}`] = fn; }, { version: 'test', fetchImpl });
  return r;
}
const reply = (status, data) => ({ ok: status < 300, status, text: async () => JSON.stringify(data) });

test('Suche: Parameter, Zwischenspeicher, Fehler von visualizer.coffee', async () => {
  const calls = [];
  const r = routes(async (url, opts) => {
    calls.push({ url, opts });
    return reply(200, { data: [shot], paging: { page: 1 } });
  });
  const search = r['GET /api/community/shots'];
  const q = new URLSearchParams({ profile: ' Blooming ', bean: 'Kenia', min: '80', page: '2', evil: 'x' });
  const res = await search({ query: q });
  assert.equal(res.items[0].ratio, 2.3);
  assert.equal(res.more, false);
  const u = new URL(calls[0].url);
  assert.equal(u.origin + u.pathname, 'https://visualizer.coffee/api/shots');
  assert.deepEqual(Object.fromEntries(u.searchParams), { items: '20', page: '2', full: 'true', profile_title: 'Blooming', bean_type: 'Kenia', min_enjoyment: '80' });
  assert.equal(calls[0].opts.redirect, 'error');
  assert.match(calls[0].opts.headers['User-Agent'], /^Xenios\/test/);
  await search({ query: q });
  assert.equal(calls.length, 1, 'zweite gleiche Suche aus dem Zwischenspeicher');

  const busy = routes(async () => reply(429, {}));
  await assert.rejects(busy['GET /api/community/shots']({ query: new URLSearchParams() }), (e) => e.status === 429 && /bremst/.test(e.message));
  const down = routes(async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }); });
  await assert.rejects(down['GET /api/community/shots']({ query: new URLSearchParams() }), (e) => e.status === 502 && /ENOTFOUND/.test(e.message));
});

test('Abruf eines Bezugs: nur gültige IDs, Profil mit Zielkurve', async () => {
  const urls = [];
  const r = routes(async (url) => { urls.push(url); return reply(200, shot); });
  const get = r['GET /api/community/shots/:id'];
  await assert.rejects(get({ params: { id: '../../admin' } }), (e) => e.status === 400);
  assert.equal(urls.length, 0, 'ungültige ID erreicht visualizer.coffee nie');
  const prof = await get({ params: { id: ID } });
  assert.equal(urls[0], `https://visualizer.coffee/api/shots/${ID}`);
  assert.ok(prof.steps.length > 3);
  assert.deepEqual(prof.target[0], [0, prof.steps[1].args[0]]);
  const empty = routes(async () => reply(200, { id: ID, timeframe: [], data: {} }));
  await assert.rejects(empty['GET /api/community/shots/:id']({ params: { id: ID } }), (e) => e.status === 422);
});
