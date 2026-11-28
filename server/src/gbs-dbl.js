// Grind-by-Sync mit der alten Xenia (DBL): Sie kennt weder /api/v2/mako noch Skript 9 noch den Stopp am Gewicht
// (Befehl 27). Xenios spielt der Mahlkönig E64 WS deshalb die neue Xenia vor: Identität und Status kommen aus den
// Daten der DBL, der Drehknopf startet an der DBL einen Bezug, und Xenios stoppt ihn am Gewicht der Bluetooth-Waage,
// die an der DBL hängt. Danach meldet die „Xenia“ einige Sekunden Status 4 mit der Bezugszeit – daraus lernt die Mühle.
// Eigene Umsetzung nach der Protokollbeschreibung in docs/API-Xenia.md (Abschnitt 14) und docs/API-Muehle-E64WS.md.
import { httpError } from './machine.js';
import { logger } from './log.js';
import { t } from '../web/shared/i18n.js';

const log = logger('gbs');

// DBL: „Espresso endlos“ – läuft, bis Xenios stoppt (spätestens nach der Max. Bezugszeit der Maschine)
export const DBL_DEFAULT_SCRIPT = 2;
// So lange meldet die „Xenia“ nach dem Bezug Status 4. Die Mühle fragt alle 2 s und übernimmt die Bezugszeit nur
// aus einer Abfrage, die Status 4 sieht.
export const FINISH_HOLD_MS = 6000;
// Nachlauf: so viele Sekunden Durchfluss vor dem Zielgewicht stoppen (Abfrage-Takt, Stopp-Befehl, Nachtropfen)
export const LEAD_S = 1;
// Frühestens nach so vielen ms am Gewicht stoppen (Tarieren, Tasse zurechtrücken)
const MIN_BREW_MS = 3000;
// Sicherheitsgrenzen: Bezüge über 80 s wertet die Mühle ohnehin nicht; ohne Gewicht nach 15 s abbrechen
const MAX_MS = 75000;
const NO_WEIGHT_MS = 15000;
const START_TIMEOUT_MS = 10000;
// Sprung nach oben zwischen zwei Messungen, der kein Durchfluss sein kann (Tasse aufgestellt): neu ansetzen
const JUMP_G = 8;

// Identität der neuen Xenia gegenüber der Mühle. Mit dieser Firmware arbeitet die Mühle nachweislich; ob sie die
// ältere der DBL (4.1xx) annimmt, ist unbekannt. Typ und Seriennummer kommen von der DBL.
const NEW_FIRMWARE = { FW_VERSION_MAJOR: 4, FW_VERSION_MINOR: 226, ESP_FW_MAJOR: 3, ESP_FW_MINOR: 87 };

const num = (v) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const r1 = (v) => Math.round(v * 10) / 10;
const pad = (n) => String(n).padStart(2, '0');
const stamp = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

export class DblBrew {
  constructor(machine, { now = () => Date.now(), leadS = LEAD_S } = {}) {
    this.machine = machine;
    this.now = now;
    this.leadS = leadS;
    this.brew = null; // laufender Bezug über den Drehknopf
    this.last = null; // letzter beendeter: { endAt, timeMs, weightG, target, stoppedBy, aborted }
    this._identity = null;
    machine.on('state', () => this._tick());
  }

  // Ausbeute seit dem Start: Gewicht über dem niedrigsten Wert (so egal, ob und wann die Waage tariert)
  _weigh(b, t) {
    const w = num(this.machine.state.scale?.weight);
    if (w === null) return;
    if (b.prevW !== null && w - b.prevW > JUMP_G) b.base += w - b.prevW;
    b.prevW = w;
    b.base = b.base === null ? w : Math.min(b.base, w);
    const y = w - b.base;
    b.yieldG = y;
    if (y > 0.5) b.sawWeight = true;
    b.samples.push([t, y]);
    while (b.samples.length > 2 && t - b.samples[0][0] > 1500) b.samples.shift();
  }

  _rate(b) {
    const s = b.samples;
    if (s.length < 2) return 0;
    const [t0, y0] = s[0];
    const [t1, y1] = s[s.length - 1];
    return t1 - t0 >= 400 ? Math.max(0, (y1 - y0) / ((t1 - t0) / 1000)) : 0;
  }

  _tick() {
    const b = this.brew;
    if (!b) return;
    const s = this.machine.state;
    const t = this.now();
    if (b.phase === 'starting') {
      if (s.shot?.running) b.phase = 'brewing';
      else if (t - b.at > START_TIMEOUT_MS) return this._end(t, 'nostart');
      else return;
    }
    if (b.phase === 'brewing') {
      if (!s.shot?.running) return this._end(t, 'machine');
      this._weigh(b, t);
      const ms = t - b.at;
      if (ms >= MIN_BREW_MS && b.yieldG !== null && b.yieldG + this._rate(b) * this.leadS >= b.target) return this._stop(t, 'weight');
      if (ms >= MAX_MS) return this._stop(t, 'max');
      if (ms >= NO_WEIGHT_MS && !b.sawWeight) return this._stop(t, 'noweight');
      return;
    }
    if (b.phase === 'stopping') {
      if (!s.shot?.running) return this._end(t, b.stoppedBy);
      this._weigh(b, t);
      if (t - b.stopAt > 4000 && !b.retried) {
        b.retried = true;
        this._sendStop();
      }
    }
  }

  _stop(t, reason) {
    const b = this.brew;
    b.phase = 'stopping';
    b.stopAt = t;
    b.stoppedBy = reason;
    log.info(`Bezug gestoppt (${reason}): ${r1(b.yieldG ?? 0)} g von ${b.target} g nach ${r1((t - b.at) / 1000)} s`);
    this._sendStop();
  }

  // Skript stoppen; nimmt die DBL das nicht an, die Pumpe über die direkte Pumpensteuerung abschalten
  _sendStop() {
    this.machine.stopScript()
      .then((r) => (r.stopped ? null : this.machine.client.get('/api/v2/paddle/stop')))
      .catch((e) => {
        log.warn(`Stopp nicht angenommen: ${e.message}`);
        return this.machine.client.get('/api/v2/paddle/stop').catch(() => {});
      });
  }

  _end(t, how) {
    const b = this.brew;
    this.brew = null;
    const end = b.stopAt ?? t;
    // Abbruch für die Mühle (MA_EXTRACTION_STATUS 2): Bezug lief nicht an, ohne Gewicht oder zu lang
    const aborted = ['nostart', 'noweight', 'max'].includes(how);
    this.last = { endAt: t, timeMs: Math.max(0, end - b.at), weightG: b.yieldG !== null ? r1(b.yieldG) : null, target: b.target, stoppedBy: how, aborted, title: b.title };
    log.info(`Grind-by-Sync-Bezug beendet (${how}): ${r1(this.last.timeMs / 1000)} s, ${this.last.weightG ?? '–'} g`);
  }

  // Drehknopf: Bezug an der DBL starten. Wiederholte Knopfdrücke während des Bezugs (die Mühle sendet erneut, wenn
  // der Status nicht schnell genug 3 wird) werden übergangen.
  async start({ scriptId, weight, title }) {
    if (this.brew) return { repeat: true };
    const target = Number(weight);
    if (!(target >= 1 && target <= 400)) throw httpError(409, t('server.gbs.noTarget'));
    const s = this.machine.state;
    if (!s.online) throw httpError(502, t('server.gbs.machineOffline'));
    if (s.scaleLink && s.scaleLink.connected === false) throw httpError(409, t('server.gbs.noScale'));
    const at = this.now();
    this.brew = { phase: 'starting', at, target, scriptId, title, base: null, prevW: null, yieldG: null, samples: [], sawWeight: false };
    try {
      await this.machine.runScript(scriptId);
    } catch (e) {
      this.brew = null;
      throw e;
    }
    this.machine.noteScript(scriptId, { title: `GbS: ${title}` });
    this.brew.at = this.now(); // Bezugszeit ab dem angenommenen Start, wie bei der Xenia
    log.info(`Drehknopf: „${title}“ (Skript ${scriptId}) an der DBL gestartet, Stopp bei ${target} g`);
    return { repeat: false };
  }

  // GET /api/v2/mako, wie ihn die neue Xenia liefert
  mako() {
    const s = this.machine.state;
    const t = this.now();
    const b = this.brew;
    const l = this.last;
    let status = s.status ?? 0;
    let ext = 0;
    let timeMs = l?.timeMs ?? 0;
    let weight = l?.weightG ?? 0;
    if (b) {
      status = 3;
      ext = 1;
      timeMs = t - b.at;
      weight = 0;
    } else if (l && t - l.endAt < FINISH_HOLD_MS) {
      status = 4;
      ext = l.aborted ? 2 : 1;
    }
    return {
      MA_STATUS: status,
      PU_SENS_FLOW_METER_VOLUME: r1(weight || 0),
      PU_SENS_FLOW_METER_FLOWRATE: 0,
      MA_EXTRACTION_STATUS: ext,
      BG_SET_TEMP: s.temp?.groupSet ?? 0,
      BG_SENS_TEMP: s.temp?.group ?? 0,
      REAL_EXTRACTION_TIME_MS: Math.round(timeMs),
      TANK_LEVEL: s.tankOk === false ? 0 : 1,
      TIMESTAMP: stamp(t),
      script: '',
    };
  }

  // GET /api/v2/machine: Typ und Seriennummer der DBL (höchstens einmal pro Minute gelesen), Firmware der neuen Xenia
  async identity() {
    const t = this.now();
    if (!this._identity || t - this._identity.at > 60_000) {
      try {
        this._identity = { at: t, m: await this.machine.client.get('/api/v2/machine') };
      } catch (e) {
        if (!this._identity) throw e;
      }
    }
    const m = this._identity.m || {};
    return {
      MA_TYPE: num(m.MA_TYPE) ?? 3, MA_SUBTYPE: num(m.MA_SUBTYPE) ?? 0, MA_SN: String(m.MA_SN || '0000000000'),
      ...NEW_FIRMWARE,
      MA_MAX_AMPERE: num(m.MA_MAX_AMPERE) ?? 10, MA_FIX_WATER_SUPPLY: num(m.MA_FIX_WATER_SUPPLY) ?? 0, BLE: 0, MA_DELAY: -1,
    };
  }

  view() {
    const b = this.brew;
    return {
      brewing: b ? { phase: b.phase, target: b.target, yieldG: b.yieldG !== null ? r1(b.yieldG) : null, title: b.title } : null,
      last: this.last,
      leadS: this.leadS,
    };
  }
}
