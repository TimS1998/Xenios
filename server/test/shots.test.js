// Bezugs-Protokoll: Abgleich mit dem Bezugszähler der Maschine (MA_EXTRACTIONS) ohne doppelte Einträge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Machine } from '../web/shared/machine-core.js';
import { MemoryStore } from '../web/shared/emitter.js';
import { DEFAULTS } from '../src/config.js';
import { setLogLevel } from '../src/log.js';

setLogLevel('error');

function machine(shots = []) {
  const m = new Machine({ machine: { ...DEFAULTS.machine, url: 'http://127.0.0.1:9' }, features: DEFAULTS.features }, { history: new MemoryStore({ shots }) });
  m._stopped = true; // keine echten Abfragen
  return m;
}
const diag = (status, ms = 0, extra = {}) => ({ MA_STATUS: status, EXTRACTION_TIME_MS: ms, PU_SENS_PRESS: status === 3 ? 9 : 0, ...extra });

test('Zählerabgleich mitten im Bezug: ein Eintrag mit Kurve und richtiger Nummer', () => {
  const m = machine();
  m._checkCounter(354);
  m.state.counters = { extractions: 354 };
  m._applyLive(diag(1));
  m._applyLive(diag(3, 1000));
  m._applyLive(diag(3, 15000, { PU_LOADCELL_VOLUME: 20 }));
  m._checkCounter(354); // Abgleich während des Bezugs: die Maschine hat noch nicht gezählt
  m._applyLive(diag(3, 28500, { PU_LOADCELL_VOLUME: 39.5 }));
  m._applyLive(diag(4, 28500, { PU_LOADCELL_VOLUME: 39.5 }));
  m._checkCounter(355); // jetzt zählt die Maschine
  m.state.counters = { extractions: 355 };
  m._checkCounter(355);
  const shots = m.history.data.shots;
  assert.equal(shots.length, 1, 'kein „nachträglicher“ Doppeleintrag');
  assert.equal(shots[0].no, 355);
  assert.equal(shots[0].estimated, undefined);
  assert.ok(shots[0].curve.length >= 3);
  assert.equal(m.state.lastShot, shots[0]);
});

test('Wirklich verpasster Bezug: Eintrag ohne Werte eines schon protokollierten Bezugs', () => {
  const m = machine();
  m._checkCounter(10);
  m.state.counters = { extractions: 10 };
  m._applyLive(diag(1));
  m._applyLive(diag(3, 1000));
  m._applyLive(diag(4, 27000, { PU_LOADCELL_VOLUME: 36 }));
  m._checkCounter(11);
  m._checkCounter(12, '42'); // Zähler steigt, ohne dass ein Bezug live zu sehen war
  const [missed, live] = m.history.data.shots;
  assert.equal(m.history.data.shots.length, 2);
  assert.equal(live.no, 11);
  assert.equal(missed.estimated, true);
  assert.equal(missed.no, 12);
  assert.equal(missed.timeMs, null, 'keine Zeit des vorigen Bezugs übernehmen');
  assert.equal(missed.weight, null);
  assert.equal(missed.volumeMl, null);
});

test('Kurzes Spülen, das die Maschine nicht zählt, verfälscht spätere Abgleiche nicht dauerhaft', () => {
  const m = machine();
  m._checkCounter(5);
  m.state.counters = { extractions: 5 };
  m._applyLive(diag(1));
  m._applyLive(diag(3, 500));
  m._applyLive(diag(1, 1500)); // 1,5 s: wird nicht protokolliert
  assert.equal(m.history.data.shots.length, 0);
  m._liveStarts[0] -= 4 * 60e3; // vier Minuten später …
  m._checkCounter(6); // … ein ungesehener Bezug
  assert.equal(m.history.data.shots.length, 1);
  assert.equal(m.history.data.shots[0].estimated, true);
});

test('Doppelte Einträge aus älteren Versionen werden beim Start zusammengeführt', () => {
  const live = { endedAt: '2026-10-24T12:07:40.000Z', timeMs: 28500, weight: 39.5, no: 354, curve: [[1, 2, 0, 0], [2, 9, 1, 1]] };
  const dup = { endedAt: '2026-10-24T12:08:20.000Z', timeMs: 28500, weight: 39.5, no: 355, estimated: true };
  const older = { endedAt: '2026-10-23T08:00:00.000Z', timeMs: 30000, no: 353 };
  const m = machine([dup, live, older]);
  const shots = m.history.data.shots;
  assert.equal(shots.length, 2);
  assert.ok(shots[0].curve, 'der live erfasste mit Kurve bleibt');
  assert.equal(shots[0].no, 355);
  assert.equal(shots[1].no, 353);
  assert.equal(m.state.lastShot, shots[0]);
  // ein echter nachträglicher Bezug Stunden später bleibt
  const later = { endedAt: '2026-10-24T18:00:00.000Z', timeMs: 28500, no: 356, estimated: true };
  assert.equal(machine([later, live]).history.data.shots.length, 2);
});
