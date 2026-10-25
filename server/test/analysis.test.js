// Bezugs-Analyse: Zielkurve aus Skripten, Kennzahlen, Mahlgrad-Tipp, Bewertung, Zuordnung zur Mühle, Pflege.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Machine, buildScript, parseScript } from '../web/shared/machine-core.js';
import { MemoryStore } from '../web/shared/emitter.js';
import { targetCurve, shotMetrics, grindAdvice, profileSteps, dialIn } from '../web/shared/shot-analysis.js';
import { DEFAULTS } from '../src/config.js';
import { setLogLevel } from '../src/log.js';

setLogLevel('error');

function machine(shots = [], extra = {}) {
  const m = new Machine({ machine: { ...DEFAULTS.machine, url: 'http://127.0.0.1:9' }, features: DEFAULTS.features }, { history: new MemoryStore({ shots, ...extra }) });
  m._stopped = true;
  return m;
}
const iso = (minAgo) => new Date(Date.now() - minAgo * 60e3).toISOString();
// Kurve: 6 s Vorbrühen bei 2 bar, dann 9 bar, ab 8 s Gewicht 1,5 g/s
const curve = Array.from({ length: 31 }, (_, t) => [t, t < 6 ? 2 : 9, t < 8 ? 0 : Math.round((t - 7) * 1.5 * 10) / 10, 0]);

test('Druckprofil-Baukasten: gültiges Skript, Zielkurve passt zu den Schritten', () => {
  const steps = profileSteps({ basket: 'double', preP: 2, preT: 6, pauseT: 4, mainP: 9, mainT: 10, endP: 5, declineT: 8 });
  const script = buildScript(steps);
  assert.match(script, /^1;13;33;4 2000 6000;6;12 4000;4 9000 10000;4 8000 2000;4 7000 2000;4 6000 2000;4 5000 2000;6;7;$/);
  assert.deepEqual(parseScript(script), steps.filter(() => true).map((s) => ({ op: s.op, args: s.args })));
  const tc = targetCurve(steps);
  assert.deepEqual(tc.slice(0, 4), [[0, 2], [6, 2], [6, 0], [10, 0]], 'Vorbrühen, dann drucklose Pause');
  assert.deepEqual(tc.at(-1), [28, 5], 'Abfall endet bei 28 s auf 5 bar');
  assert.equal(targetCurve([{ op: 3, args: [40, 2] }]), null, 'ohne Druckschritte keine Zielkurve');
});

test('Kennzahlen und Mahlgrad-Tipp', () => {
  const shot = { timeMs: 30000, weight: 34.5, maxPressure: 9, curve, dose: { g: 18 } };
  const m = shotMetrics(shot);
  assert.equal(m.preinfusionS, 6);
  assert.equal(m.firstDropS, 8);
  assert.equal(m.ratio, 1.9);
  assert.equal(m.avgFlow, 1.6);
  assert.equal(grindAdvice(shot, m), null, 'im Zielbereich ohne Geschmack kein Tipp');
  assert.equal(grindAdvice({ ...shot, notes: { taste: 'sour' } }).dir, 'finer');
  assert.equal(grindAdvice({ ...shot, notes: { taste: 'bitter' } }).dir, 'coarser');
  assert.equal(grindAdvice({ ...shot, timeMs: 18000 }).dir, 'finer');
  // Zwei Tassen, nur eine auf der Waage: korrigierte Ausbeute zählt
  assert.equal(shotMetrics({ ...shot, notes: { yieldG: 69 } }).ratio, 3.8);
});

test('Bewertung speichern, prüfen und Vergleichskurven wählen', () => {
  const shots = [
    { id: 'c', endedAt: iso(1), timeMs: 30000, weight: 36, curve, script: { id: 12, title: 'Blooming' } },
    { id: 'b', endedAt: iso(30), timeMs: 28000, weight: 35, curve, script: { id: 12, title: 'Blooming' }, notes: { bean: 'Kenia', reference: true } },
    { id: 'a', endedAt: iso(60), timeMs: 25000, weight: 33, curve },
  ];
  const m = machine(shots);
  assert.throws(() => m.annotateShot('c', { rating: 6 }), /1 bis 5/);
  assert.throws(() => m.annotateShot('c', { taste: 'salzig' }), /sour/);
  assert.throws(() => m.annotateShot('nope', {}), /nicht gefunden/);
  const r = m.annotateShot('c', { rating: 4, taste: 'balanced', bean: '  Kenia ', yieldG: 36.04, text: 'gut' });
  assert.deepEqual(r.shot.notes, { rating: 4, taste: 'balanced', bean: 'Kenia', yieldG: 36, text: 'gut' });
  m.annotateShot('c', { text: null });
  assert.equal(m.history.data.shots[0].notes.text, undefined, 'null löscht ein Feld');
  const d = m.shotDetail('c');
  assert.deepEqual(d.compare.map((s) => s.id), ['b', 'a'], 'erst gleiches Skript, dann die übrigen');
  assert.equal(d.reference.id, 'b', 'Referenz zur selben Bohne');
  assert.deepEqual(d.beans, [{ name: 'Kenia', roaster: '' }]);
  assert.match(m.shotsCsv(), /Dosis \(g\);Verhältnis 1:;Rezept Mühle;Skript;Bohne;Mahlgrad;Bewertung;Geschmack;Stärke;Notiz/);
  assert.match(m.shotsCsv(), /"Blooming";"Kenia";;4;ausgewogen;;/);
});

test('Mahlvorgang der Mühle wird dem passenden Bezug zugeordnet', () => {
  const m = machine([
    { id: 'neu', endedAt: iso(0), startedAt: iso(0.5), timeMs: 30000 },
    { id: 'alt', endedAt: iso(120), startedAt: iso(120.5), timeMs: 28000 },
  ]);
  const grinds = [
    { id: 41, at: iso(3), success: true, weightG: 18.1, targetG: 18, recipe: 2, type: 'DoubleShot', durationMs: 8200, gbs: true, ddd: 1761 },
    { id: 40, at: iso(30), success: true, weightG: 9.1, targetG: 9, recipe: 1 }, // zu früh für „neu“, zu spät für „alt“
    { id: 39, at: iso(121), success: false, weightG: 0.4 }, // abgebrochen
  ];
  assert.equal(m.linkGrinds(grinds), 1);
  const [neu, alt] = m.history.data.shots;
  assert.deepEqual({ g: neu.dose.g, recipe: neu.dose.recipe, gbs: neu.dose.gbs, grindId: neu.dose.grindId, ddd: neu.dose.ddd }, { g: 18.1, recipe: 2, gbs: true, grindId: 41, ddd: 1761 });
  assert.equal(m.shotDetail('neu').lastGrind, '1761');
  assert.equal(alt.dose, undefined);
  assert.equal(m.linkGrinds(grinds), 0, 'nicht doppelt zuordnen');
  assert.equal(shotMetrics({ ...neu, weight: 36.2 }).ratio, 2);
});

test('Gestartetes Skript hängt am Bezug (für die Zielkurve)', async () => {
  const m = machine();
  m.client.post = async () => ({});
  m.readScript = async (id) => ({ id, title: 'Blooming', steps: [{ op: 4, args: [9, 20] }] });
  await m.runScript(12);
  await new Promise((r) => setTimeout(r, 0));
  m.state.counters = { extractions: 1 };
  m._applyLive({ MA_STATUS: 1 });
  m._applyLive({ MA_STATUS: 3, EXTRACTION_TIME_MS: 1000, PU_SENS_PRESS: 9 });
  m._applyLive({ MA_STATUS: 4, EXTRACTION_TIME_MS: 25000 });
  const s = m.history.data.shots[0];
  assert.deepEqual(s.script, { id: 12, title: 'Blooming', steps: [{ op: 4, args: [9, 20] }] });
  assert.match(s.id, /^[a-z0-9]{6,}$/);
});

test('Backflush-Erinnerung und IDs für alte Einträge', () => {
  const m = machine([{ endedAt: iso(10), timeMs: 25000 }, { endedAt: iso(5000), timeMs: 25000 }]);
  assert.ok(m.history.data.shots.every((s) => s.id), 'ältere Einträge bekommen eine ID');
  assert.notEqual(m.history.data.shots[0].id, m.history.data.shots[1].id);
  let b = m.maintenance().backflush;
  assert.equal(b.due, true, 'noch nie gemacht = fällig');
  b = m.markBackflush().backflush;
  assert.equal(b.due, false);
  assert.equal(b.daysSince, 0);
  assert.equal(b.shotsSince, 0);
  assert.throws(() => m.setMaintenance({ intervalDays: 0 }), /1 bis 60/);
  assert.equal(m.setMaintenance({ intervalDays: 3 }).backflush.intervalDays, 3);
});

test('Einstell-Assistent: Geschmack × Stärke, Verlauf derselben Bohne', () => {
  const at = (min) => new Date(Date.UTC(2026, 9, 24, 8, 0) + min * 60e3).toISOString();
  const shot = (min, notes, timeMs = 28000) => ({ id: `s${min}`, endedAt: at(min), timeMs, weight: 36, dose: { g: 18 }, notes: { bean: 'Kenia', ...notes } });
  assert.equal(dialIn(shot(0, {})), null, 'ohne Bewertung und im Zeitfenster kein Tipp');
  assert.equal(dialIn(shot(0, {}, 18000)).dir, 'finer', 'zu schnell → feiner, auch ohne Bewertung');

  let a = dialIn(shot(0, { taste: 'sour' }));
  assert.deepEqual([a.dir, a.size, a.title], ['finer', 1, 'Feiner mahlen']);
  assert.equal(dialIn(shot(0, { taste: 'sour', strength: 'strong' })).dir, 'longer', 'sauer + kräftig → mehr Ausbeute');
  assert.equal(dialIn(shot(0, { taste: 'bitter', strength: 'weak' })).dir, 'shorter', 'bitter + dünn → weniger Ausbeute');
  assert.equal(dialIn(shot(0, { taste: 'balanced', strength: 'weak' })).dir, 'shorter');
  assert.equal(dialIn(shot(0, { taste: 'balanced' })).dir, 'keep');
  assert.equal(dialIn(shot(0, { taste: 'bitter' }, 19000)).dir, 'puck', 'bitter trotz schnell → Kanalbildung');
  assert.equal(dialIn(shot(0, { taste: 'sour' }, 40000)).dir, 'puck', 'sauer trotz langsam → Puck/Temperatur');

  // Verlauf: sauer → sauer: größerer Schritt; bitter → sauer: halber Schritt zurück
  const history = [shot(-10, { taste: 'sour', grind: '4' }), shot(-30, { taste: 'balanced', grind: '3,6' })];
  a = dialIn(shot(0, { taste: 'sour', grind: '3,8' }), history);
  assert.deepEqual([a.dir, a.size], ['finer', 2]);
  assert.deepEqual(a.anchor, { grind: '3,6', at: at(-30), timeS: 28 });
  assert.deepEqual(a.trail.map((t) => `${t.grind} ${t.taste}`), ['3,6 balanced', '4 sour', '3,8 sour'], 'älteste zuerst');
  a = dialIn(shot(0, { taste: 'sour' }), [shot(-10, { taste: 'bitter' })]);
  assert.deepEqual([a.dir, a.size, a.title], ['finer', 0, 'Etwas feiner']);
  a = dialIn(shot(0, { taste: 'bitter' }), [shot(-10, { taste: 'sour' })]);
  assert.deepEqual([a.dir, a.size], ['coarser', 0]);
  // andere Bohne oder zu alt zählt nicht
  assert.equal(dialIn(shot(0, { taste: 'sour' }), [{ ...shot(-10, {}), notes: { bean: 'Brasil', taste: 'sour' } }]).size, 1);
  assert.equal(dialIn(shot(0, { taste: 'sour' }), [shot(-20 * 1440, { taste: 'sour' })]).size, 1);
  // langes Profil (Blooming): 62 s sind kein „langsam“
  const bloom = { ...shot(0, { taste: 'sour' }, 62000), script: { steps: [{ op: 4, args: [3, 10] }, { op: 6, args: [] }, { op: 12, args: [25] }, { op: 4, args: [8.5, 26] }] } };
  assert.equal(dialIn(bloom).dir, 'finer');
});

test('Bewertung mit Stärke und Mahlgrad liefert die Empfehlung', () => {
  const m = machine([
    { id: 'b', endedAt: iso(1), timeMs: 27000, weight: 36, curve },
    { id: 'a', endedAt: iso(20), timeMs: 26000, weight: 35, curve, notes: { bean: 'Kenia', taste: 'sour', grind: '4' } },
  ]);
  assert.throws(() => m.annotateShot('b', { strength: 'mittel' }), /weak, ok oder strong/);
  const r = m.annotateShot('b', { taste: 'sour', strength: 'ok', bean: 'Kenia', grind: ' 3,8\n ' });
  assert.deepEqual(r.shot.notes, { taste: 'sour', strength: 'ok', bean: 'Kenia', grind: '3,8' });
  assert.deepEqual([r.advice.dir, r.advice.size], ['finer', 2], 'zweimal sauer');
  const d = m.shotDetail('b');
  assert.equal(d.advice.dir, 'finer');
  assert.equal(d.lastGrind, '4');
  assert.match(m.shotsCsv(), /"Kenia";"3,8";;sauer;passt;/);
});

test('Bohnen anlegen, umbenennen, löschen; Bewertung legt an', () => {
  const m = machine([{ id: 'a', endedAt: iso(1), timeMs: 25000, notes: { bean: 'Alt' } }]);
  assert.deepEqual(m.listBeans(), [{ name: 'Alt', roaster: '' }]);
  m.saveBean({ name: 'Kenia AA', roaster: 'Rösterei X' });
  assert.equal(m.listBeans().length, 2);
  m.saveBean({ name: 'Kenia', rename: 'Kenia AA', roaster: 'Rösterei X' });
  assert.deepEqual(m.listBeans().map((b) => b.name), ['Alt', 'Kenia']);
  m.annotateShot('a', { bean: 'Kenia' });
  assert.equal(m.history.data.shots[0].notes.bean, 'Kenia');
  m.saveBean({ name: 'Kenia Nyeri', rename: 'Kenia' });
  assert.equal(m.history.data.shots[0].notes.bean, 'Kenia Nyeri');
  m.deleteBean('Alt');
  assert.deepEqual(m.listBeans().map((b) => b.name), ['Kenia Nyeri']);
  assert.throws(() => m.saveBean({ name: '' }), /Name fehlt/);
  assert.throws(() => m.deleteBean('gibt-es-nicht'), /nicht gefunden/);
});
