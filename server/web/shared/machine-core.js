// Xenia-Client: serielle Anfragen an den ESP32, Polling, Zustandsmodell, Ereignisse (für Push) und Bezugs-Historie.
// Läuft im Server (Node) und in der Android-App im Direkt-Modus (Browser): Speicher, Logger und fetch werden übergeben.
import { Emitter, MemoryStore } from './emitter.js';
import { logger } from './log.js';
import { dialIn, STRENGTH, shotPhases, taredCurve, curveYield } from './shot-analysis.js';
import { MACHINE_API, CLASSIC_SETTING_FIELDS, machineApiId, normalizeLive } from './machine-api.js';

export { MACHINE_API, CLASSIC_SETTING_FIELDS, machineApiId } from './machine-api.js';

let log = logger('xenia');

export const MA_STATUS = {
  0: { key: 'off', label: 'Aus' },
  1: { key: 'on', label: 'An' },
  2: { key: 'eco', label: 'Eco' },
  3: { key: 'brewing', label: 'Bezug läuft' },
  4: { key: 'draining', label: 'Nachlauf' },
  5: { key: 'paddle', label: 'Paddle' },
  6: { key: 'fault', label: 'Störung' },
};

export const MA_TYPE = {
  0: 'Undefiniert', 1: 'Xenia 2K', 2: 'Xenia Dual Boiler', 3: 'Xenia Brew-by-Sync', 4: 'Xenia 303', 5: 'Xenia 2K + L',
};

// MA_TYPE aus /api/v2/machine bei der alten Firmware (so benennt die Startseite der Original-Oberfläche
// die Modelle; an einer „Xenia DB + L“ mit Firmware 4.159 geprüft: MA_TYPE 3)
export const CLASSIC_TYPE = { 1: 'Xenia 2K', 2: 'Xenia Dual Boiler', 3: 'Xenia Dual Boiler + L', 4: 'Xenia 303', 5: 'Xenia 2K + L' };

// Grenzen wie in der offiziellen Web-Oberfläche (general.html).
export const SETTING_LIMITS = {
  BG_SET_TEMP: [60, 96], BG_SET_ECO_TEMP: [40, 95], BG_SET_TEMP_HYST: [2, 5],
  BB_SET_TEMP: [60, 96], BB_SET_ECO_TEMP: [40, 95], BB_SET_TEMP_HYST: [2, 5],
  PU_SET_MAX_TIMER: [30, 120],
  SB_SET_PRESS: [0, 1.8], SB_SET_ECO_PRESS: [0, 1], SB_SET_PRESS_HYST: [0.1, 0.3],
  MA_BOILER_START_MODE: [1, 2], MA_FAST_HEATUP_TYPE: [0, 1], MA_HEATUP_FLUSH_DURATION: [1, 20],
  MA_START_EXTRACTIONCOUNTER_EVENT: [0, 2],
  // Alte Xenia mit Seiten-API (DBL, Firmware 4.1xx): Werte der Original-Seiten „Pumpe“ und „Maschine“
  PU_SET_BREW_TIMER_1: [15, 60], MA_SET_TIMER_ECO_MA: [1, 240], MA_SET_TIMER_POWERDOWN: [1, 240],
  MA_FIX_WATER_SUPPLY: [0, 1], MA_EXTENDED_THERMAL_STABILITY: [0, 1],
};
export const SETTING_LABELS = {
  BG_SET_TEMP: 'Brühgruppe', BG_SET_ECO_TEMP: 'Brühgruppe Eco', BG_SET_TEMP_HYST: 'Hysterese Brühgruppe',
  BB_SET_TEMP: 'Brühkessel', BB_SET_ECO_TEMP: 'Brühkessel Eco', BB_SET_TEMP_HYST: 'Hysterese Brühkessel',
  PU_SET_MAX_TIMER: 'Max. Bezugszeit', SB_SET_PRESS: 'Dampfdruck', SB_SET_ECO_PRESS: 'Dampfdruck Eco', SB_SET_PRESS_HYST: 'Hysterese Dampf',
  MA_BOILER_START_MODE: 'Startmodus', MA_FAST_HEATUP_TYPE: 'Aufheiz-Spülung', MA_HEATUP_FLUSH_DURATION: 'Spüldauer',
  MA_START_EXTRACTIONCOUNTER_EVENT: 'Start Bezugszähler',
  PU_SET_BREW_TIMER_1: 'Bezugszeit Espresso', MA_SET_TIMER_ECO_MA: 'Eco-Timer', MA_SET_TIMER_POWERDOWN: 'Abschalt-Timer',
  MA_FIX_WATER_SUPPLY: 'Wasserversorgung', MA_EXTENDED_THERMAL_STABILITY: 'Thermische Stabilität',
};

// Alte Xenia mit Seiten-API: je Seite der Original-Oberfläche ein Endpunkt, der immer alle Felder der Seite erwartet.
// „keep“ sind Felder, die Xenios nicht ändert (Heizleistung, Pumpenmodus, Stromgrenze), aber unverändert mitsendet.
export const CLASSIC_PAGES = [
  { path: '/api/v2/brewgroup', read: '/api/v2/boilerandbrewgroup', fields: ['BG_SET_TEMP', 'BG_SET_ECO_TEMP', 'BG_SET_TEMP_HYST'], keep: ['BG_SET_POWER'] },
  { path: '/api/v2/brewboiler', read: '/api/v2/boilerandbrewgroup', fields: ['BB_SET_TEMP', 'BB_SET_ECO_TEMP', 'BB_SET_TEMP_HYST'], keep: ['BB_MODE', 'BB_SET_POWER'] },
  { path: '/api/v2/steamboiler', read: '/api/v2/boilerandbrewgroup', fields: ['SB_SET_PRESS', 'SB_SET_ECO_PRESS', 'SB_SET_PRESS_HYST'], keep: ['SB_SET_POWER'] },
  { path: '/api/v2/pump', read: '/api/v2/pump', fields: ['PU_SET_BREW_TIMER_1', 'PU_SET_MAX_TIMER'], keep: ['PU_MODE'] },
  { path: '/api/v2/machine', read: '/api/v2/machine', fields: ['MA_HEATUP_FLUSH_DURATION', 'MA_SET_TIMER_ECO_MA', 'MA_SET_TIMER_POWERDOWN', 'MA_FIX_WATER_SUPPLY', 'MA_BOILER_START_MODE', 'MA_EXTENDED_THERMAL_STABILITY'], keep: ['MA_MAX_AMPERE'] },
];
// Reihenfolge/Felder, die die offizielle Oberfläche beim Speichern sendet.
export const GENERAL_FIELDS = [
  'BB_SET_TEMP', 'BB_SET_ECO_TEMP', 'BB_SET_TEMP_HYST', 'BG_SET_TEMP', 'BG_SET_ECO_TEMP', 'BG_SET_TEMP_HYST',
  'PU_SET_MAX_TIMER', 'SB_SET_PRESS', 'SB_SET_ECO_PRESS', 'SB_SET_PRESS_HYST', 'MA_BOILER_START_MODE',
  'MA_FAST_HEATUP_TYPE', 'MA_HEATUP_FLUSH_DURATION', 'MA_START_EXTRACTIONCOUNTER_EVENT',
];

function checkLimit(k, value) {
  const [min, max] = SETTING_LIMITS[k];
  const v = Number(value);
  if (!Number.isFinite(v) || v < min || v > max) throw httpError(400, `${SETTING_LABELS[k] || k} muss zwischen ${min} und ${max} liegen`);
}

export const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THUSRDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']; // "THUSRDAY" ist so in der Firmware

// Skript-Befehle (Opcode -> Name, Parameter). Zeiten werden in ms übertragen.
export const SCRIPT_OPS = {
  1: { name: 'Start', internal: true },
  2: { name: 'Pumpe an' },
  3: { name: 'Pumpenleistung', args: [{ name: 'Leistung', unit: '%', min: 1, max: 100, step: 1 }, { name: 'Dauer', unit: 's', min: 0.1, max: 45, step: 0.1, scale: 1000 }] },
  4: { name: 'Pumpendruck', args: [{ name: 'Druck', unit: 'bar', min: 0, max: 10, step: 0.1, scale: 1000 }, { name: 'Dauer', unit: 's', min: 0.1, max: 45, step: 0.1, scale: 1000 }] },
  5: { name: 'Durchfluss (Waage)', args: [{ name: 'Durchfluss', unit: 'ml/s', min: 1, max: 100, step: 0.1 }, { name: 'Dauer', unit: 's', min: 0.1, max: 45, step: 0.1, scale: 1000 }] },
  6: { name: 'Pumpe aus' },
  7: { name: 'Ende', internal: true },
  8: { name: 'Brühkessel-Leistung', args: [{ name: 'Leistung', unit: '%', min: 1, max: 400, step: 1 }] },
  9: { name: 'Brühgruppen-Leistung', args: [{ name: 'Leistung', unit: '%', min: 1, max: 400, step: 1 }] },
  12: { name: 'Warten', args: [{ name: 'Dauer', unit: 's', min: 0.1, max: 120, step: 0.1, scale: 1000 }] },
  13: { name: 'Brühventil öffnen' },
  14: { name: 'Brühventil schließen' },
  15: { name: 'Ablassventil öffnen' },
  16: { name: 'Ablassventil schließen' },
  17: { name: 'Ablassen & beenden' },
  20: { name: 'Piepton', args: [{ name: 'Töne', unit: '', min: 1, max: 3, step: 1 }, { name: 'Dauer', unit: 'ms', min: 1, max: 5000, step: 1 }] },
  25: { name: 'Auf Zieltemperatur warten', args: [{ name: 'Temperatur', unit: '°C', min: 88, max: 96, step: 1 }] },
  26: { name: 'Warten bis Druck', args: [{ name: 'Druck', unit: 'bar', min: 0, max: 10, step: 0.1 }] },
  27: { name: 'Bezug stoppen bei', args: [{ name: 'Menge', unit: 'g/ml', min: 1, max: 400, step: 1 }] },
  28: { name: 'Eco-Modus' },
  29: { name: 'Druck begrenzen', args: [{ name: 'Druck', unit: 'bar', min: 0, max: 10, step: 0.1 }] },
  30: { name: 'Durchfluss begrenzen', args: [{ name: 'Durchfluss', unit: 'ml/s', min: 0, max: 5, step: 0.1 }] },
  31: { name: 'Zieltemperatur wiederherstellen' },
  32: { name: 'Vorgabe: Einfaches Sieb' },
  33: { name: 'Vorgabe: Doppeltes Sieb' },
};

// Eingebaute Skripte (IDs < 10), z. B. für die Tastenbelegung.
// Skript 9 (Bezug per Drehknopf der Mühle, Grind-by-Sync) ist bewusst nicht dabei: an einem Taster funktioniert es nicht.
export const BUILTIN_SCRIPTS = { 0: 'Keine', 2: 'Dauerbezug', 7: 'Einfache Dosis', 8: 'Doppelte Dosis' };
// Alte Xenia (DBL): so heißen die festen Abläufe auf der Schalter-Seite der Original-Oberfläche.
// „Espresso“ läuft die eingestellte Bezugszeit (PU_SET_BREW_TIMER_1).
export const CLASSIC_BUILTIN_SCRIPTS = { 0: 'Keine', 1: 'Espresso (Bezugszeit)', 2: 'Espresso endlos', 7: 'Single', 8: 'Double' };

// Kürzere Pumpvorgänge sind kein Bezug (Spülen, Rückspülen von Hand) und kommen nicht ins Protokoll.
// Standardwert; einstellbar unter Bezüge → Filter (history.data.settings.minShotS, 0–60 s).
export const MIN_SHOT_MS = 15000;
export const MIN_SHOT_LIMITS = { min: 0, max: 60 };

// Antwortet die Maschine einmal nicht, wird so bald erneut gefragt; erst der zweite Fehlschlag in Folge gilt als offline.
const RETRY_AFTER_FAIL_MS = 1500;

// Rückspülen mit Blindsieb über die direkte Pumpensteuerung (Paddle). Skripte bricht die Xenia mit Blindsieb sofort ab
// (Status 4, Pumpe aus). Paddle-Pumpe läuft nur, solange laufend Befehle kommen; an der Maschine gemessen (01.11.2026):
// mit 35 % in ~12 s auf 8,5 bar, Spitze ~9,5 bar, beim Halten bis ~10 bar; bei 0 % bleibt er stehen, paddle/stop entlastet.
export const BACKFLUSH = { cycles: 10, level: 35, bar: 8, holdMs: 5000, restMs: 5000, maxPumpMs: 30000 };

// Geschmack in der Bewertung eines Bezugs
export const TASTE = { sour: 'sauer', balanced: 'ausgewogen', bitter: 'bitter' };

const shotId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function scriptType(id) {
  if (id >= 10 && id < 150) return 'standard';
  if (id >= 150 && id < 200) return 'pressure';
  if (id >= 200 && id < 250) return 'paddle';
  return 'builtin';
}

// "1;13;4 9000 25000;12 3000;7;" <-> [{op:13,args:[]},{op:4,args:[9,25]},...]  (Anzeigeeinheiten)
export function parseScript(content) {
  const steps = [];
  for (const raw of String(content || '').split(';')) {
    const parts = raw.trim().split(/\s+/).filter(Boolean).map(Number);
    if (!parts.length || parts.some((n) => !Number.isFinite(n))) continue;
    const [op, ...vals] = parts;
    if (op === 1 || op === 7) continue;
    const def = SCRIPT_OPS[op];
    const args = vals.map((v, i) => {
      const scale = def?.args?.[i]?.scale || 1;
      return Math.round((v / scale) * 1000) / 1000;
    });
    steps.push({ op, args });
  }
  return steps;
}

export function buildScript(steps) {
  let s = '1;';
  for (const st of steps) {
    const op = Number(st.op);
    const def = SCRIPT_OPS[op];
    if (!def || def.internal) throw new Error(`Unbekannter Skript-Befehl ${st.op}`);
    const args = (def.args || []).map((a, i) => {
      let v = Number(st.args?.[i]);
      if (!Number.isFinite(v)) throw new Error(`${def.name}: ${a.name} fehlt`);
      v = Math.min(a.max, Math.max(a.min, v));
      return Math.round(v * (a.scale || 1) * 1000) / 1000;
    });
    s += [op, ...args].join(' ') + ';';
  }
  return s + '7;';
}

export const isScriptNameValid = (str) => /^(?! )[A-Za-z0-9\-_# ]{1,40}(?<! )$/.test(str);

// Zeit-Codierungen der Firmware
export const unpackClock = (v) => ({ h: (v >> 16) & 0xff, m: (v >> 8) & 0xff, s: v & 0xff });
export const unpackDate = (v) => ({ d: (v >>> 24) & 0xff, mo: (v >> 16) & 0xff, y: v & 0xffff });
export function clockToIso(clock, cal) {
  const t = unpackClock(clock);
  const d = unpackDate(cal);
  if (!d.y) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.y}-${p(d.mo)}-${p(d.d)}T${p(t.h)}:${p(t.m)}:${p(t.s)}`;
}
export function timerToMinutes(v) {
  const n = Number(v) || 0;
  if (!n) return null;
  const t = unpackClock(n);
  return t.h * 60 + t.m;
}

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
const round = (v, d = 1) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

export class XeniaClient {
  constructor({ url, timeoutMs = 6000, fetch: fetchImpl }) {
    this.fetch = fetchImpl || ((...a) => globalThis.fetch(...a));
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.chain = Promise.resolve();
    this.pending = 0;
  }

  // Alle Anfragen nacheinander (der ESP32 verträgt keine parallelen Zugriffe gut).
  request(method, apiPath, body) {
    if (this.pending > 20) return Promise.reject(new Error('Maschine überlastet (Warteschlange voll)'));
    this.pending++;
    const run = () => this._do(method, apiPath, body).finally(() => { this.pending--; });
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }

  async _do(method, apiPath, body) {
    const headers = { Accept: 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest' };
    let payload;
    if (body !== undefined) {
      // Genau wie die offizielle Oberfläche (jQuery $.post): JSON-Text mit Formular-Content-Type.
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    }
    let res;
    try {
      res = await this.fetch(this.url + apiPath, {
        method,
        headers,
        body: payload,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      const why = e.name === 'TimeoutError' ? 'Zeitüberschreitung' : e.cause?.code || e.message;
      throw Object.assign(new Error(`Maschine nicht erreichbar (${why})`), { status: 502, expose: true });
    }
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`Maschine antwortet HTTP ${res.status} auf ${apiPath}`);
      err.status = res.status;
      err.body = text.slice(0, 300);
      throw err;
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('text/html')) {
      // Unbekannte Pfade liefern die HTML-Startseite mit HTTP 200.
      const err = new Error(`Unbekannter Endpunkt ${apiPath} – passt das Modell (neue/alte Xenia) unter Einstellungen → Modell & Aussehen?`);
      err.status = 404;
      throw err;
    }
    if (!text.trim()) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  get(p) { return this.request('GET', p); }
  post(p, body) { return this.request('POST', p, body ?? {}); }

  // Unveränderte Weitergabe (Grind-by-Sync-Vermittler), in derselben Warteschlange wie alle anderen Anfragen.
  raw(method, apiPath, body, contentType) {
    if (this.pending > 20) return Promise.reject(new Error('Maschine überlastet (Warteschlange voll)'));
    this.pending++;
    const run = async () => {
      try {
        const res = await this.fetch(this.url + apiPath, {
          method,
          headers: body !== undefined && contentType ? { 'Content-Type': contentType } : {},
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        return { status: res.status, type: res.headers.get('content-type'), body: new Uint8Array(await res.arrayBuffer()) };
      } finally {
        this.pending--;
      }
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }
}

export class Machine extends Emitter {
  // opts: { history: Speicher für Bezüge ({data, save, flush}), fetch, log }
  constructor(cfg, opts = {}) {
    super();
    this.cfg = cfg.machine;
    this.features = cfg.features;
    this.client = new XeniaClient({ ...cfg.machine, fetch: opts.fetch });
    this.history = opts.history || new MemoryStore({ shots: [] });
    if (opts.log) log = opts.log;
    this.viewers = 0;
    this.state = {
      online: false, lastSeen: null, error: null,
      status: null, statusKey: 'unknown', statusLabel: 'Unbekannt',
      steamOn: false,
      temp: { group: null, boiler: null, groupSet: null, boilerSet: null, groupRaw: null, boilerRaw: null },
      pressure: { pump: null, steam: null, steamSet: null, pumpSet: null },
      power: { group: null, boiler: null, pump: null },
      scale: { weight: null, rate: null },
      // Bluetooth-Waage an der alten Xenia (DBL): verbunden? (BLE in /api/v2/machine); null = unbekannt
      scaleLink: null,
      // Eingestelltes Modell passt nicht zur Maschine: { configured, detected } ('bbs' | 'classic'); null = passt/unbekannt
      apiMismatch: null,
      flow: { volume: null, rate: null, ml: null },
      shot: { running: false, timeMs: 0, startedAt: null, curve: [] },
      lastShot: null,
      tankOk: null,
      heated: false,
      steamReady: false,
      settings: null,
      switches: null,
      info: null,
      counters: null,
      clock: null,
    };
    this._offsets = { bg: 0, bb: 0 };
    this._timer = null;
    this._slowAt = 0;
    this._failSince = null;
    this._offlineNotified = false;
    this._lastAppAction = 0;
    this._burstUntil = 0; // bis dahin nach einer Aktion schnell abfragen
    this._paddleUntil = 0;
    this._liveStarts = [];    // Startzeiten live erkannter Bezüge, die der Bezugszähler noch nicht mitgezählt hat
    this._lastDiag = null;
    this._shotClock = null;   // Fallback, wenn die Firmware keine EXTRACTION_TIME_MS liefert (alte Xenia)
    this._repairHistory();
    this.state.lastShot = this.listedShots()[0] || null;
  }

  get apiId() {
    return machineApiId(this.cfg.api);
  }

  get api() {
    return MACHINE_API[this.apiId];
  }

  // --- Polling --------------------------------------------------------------

  start() {
    this._loop();
  }

  stop() {
    this._stopped = true;
    clearTimeout(this._timer);
  }

  setViewers(n) {
    const wake = n > 0 && this.viewers === 0;
    this.viewers = n;
    if (wake) this.kick();
  }

  kick(delay = 0) {
    if (this._stopped) return;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._loop(), delay);
    this._timer.unref?.();
  }

  _interval() {
    const s = this.state;
    if (s.shot.running || s.status === 4) return this.cfg.pollActiveMs;
    // nach einer Aktion (App, Widget, Wecker) eine Weile schnell nachsehen, auch ohne offene App: die Maschine meldet
    // z. B. das Einschalten erst nach einigen Sekunden, sonst bliebe der alte Zustand bis zur nächsten Abfrage (10 s)
    if (Date.now() < this._burstUntil) return this.cfg.pollActiveMs;
    if (this.viewers > 0) return s.status && s.status !== 0 ? this.cfg.pollActiveMs : this.cfg.pollIdleMs;
    return s.status && s.status !== 0 ? Math.min(this.cfg.pollBackgroundMs, 5000) : this.cfg.pollBackgroundMs;
  }

  async _loop() {
    clearTimeout(this._timer);
    let delay = null;
    try {
      if (Date.now() >= this._slowAt) {
        await this.refreshSlow();
        this._slowAt = Date.now() + this.cfg.slowPollMs;
      }
      const d = await this.client.get(this.livePath);
      this._applyLive(normalizeLive(d));
      this._markOnline();
      // nicht abwarten: hängt /api/v2/machine, soll die schnelle Abfrage (laufender Bezug) nicht stehen bleiben
      this._readScaleLink(d).catch(() => {});
    } catch (e) {
      // Ein einzelner Aussetzer (WLAN der Maschine, Zeitüberschreitung) ist noch nicht „offline“: gleich noch einmal
      // fragen. Sonst meldet z. B. ein Widget, das genau dann nachsieht, bis zum nächsten Update „Offline“.
      if (this.state.online && !this._retrying) {
        this._retrying = true;
        delay = RETRY_AFTER_FAIL_MS;
        log.debug(`Maschine antwortet nicht (${e.message}), neuer Versuch`);
      } else {
        this._markOffline(e);
      }
    }
    if (this._stopped) return;
    this._timer = setTimeout(() => this._loop(), delay ?? this._interval());
    this._timer.unref?.();
  }

  async refreshSlow() {
    const single = await this.client.get('/api/v2/overview_single');
    let general = {};
    if (this.api.general) {
      try {
        general = await this.client.get('/api/v2/general');
        this._noteApi('bbs');
      } catch (e) {
        log.debug(`general nicht lesbar: ${e.message}`);
        if (e.status === 404) this._noteApi('classic');
      }
    } else if (!this.state.info || Date.now() >= (this._apiCheckAt || 0)) {
      // Alte Xenia eingestellt: gelegentlich nachsehen, ob doch eine neue antwortet (nach dem Start, nach Änderungen,
      // sonst alle 5 min)
      this._apiCheckAt = Date.now() + 5 * 60_000;
      try {
        const g = await this.client.get('/api/v2/general');
        if (g && typeof g === 'object' && ('BG_SET_TEMP' in g || 'BB_SET_TEMP' in g)) this._noteApi('bbs');
      } catch (e) {
        if (e.status === 404) this._noteApi('classic');
      }
    }
    // Live-Abfrage der alten API ist schon /overview; ein zweites Mal nur, wenn wir diagram/get pollen
    const overview = this.livePath === '/api/v2/overview' ? (this._lastDiag || await this.client.get('/api/v2/overview')) : await this.client.get('/api/v2/overview');
    if (!this.api.general && this._caps?.pages) {
      try { this._diagExtractionMs = num((await this.client.get('/api/v2/diagram/get')).EXTRACTION_TIME_MS); } catch { /* optional */ }
    }
    this._applySlow(single, general, overview);
    if (!this.state.info) {
      try {
        const machine = await this.client.get('/api/v2/machine');
        let info = {};
        if (this.api.info) {
          try { info = await this.client.get('/api/v2/info'); } catch { /* ältere Firmware */ }
        }
        this.state.info = {
          type: machine.MA_TYPE, typeName: MA_TYPE[machine.MA_TYPE] || `Typ ${machine.MA_TYPE}`,
          subtype: machine.MA_SUBTYPE,
          firmware: `${machine.FW_VERSION_MAJOR}.${machine.FW_VERSION_MINOR}`,
          esp: `${machine.ESP_FW_MAJOR}.${machine.ESP_FW_MINOR}`,
          serialTail: String(machine.MA_SN || '').slice(-4),
          maxAmpere: machine.MA_MAX_AMPERE,
          fixWaterSupply: machine.MA_FIX_WATER_SUPPLY,
          view: info.VIEW,
          tzIndex: info.TZ_IND,
          api: this.apiId,
        };
        if (!this.api.general) {
          this.state.info.caps = await this.classicCaps().catch(() => undefined);
          // Alte Firmware: eigene Modellnummern (MA_TYPE 3 ist hier die DB + L, nicht die Brew-by-Sync)
          if (CLASSIC_TYPE[num(machine.MA_TYPE)]) this.state.info.typeName = CLASSIC_TYPE[num(machine.MA_TYPE)];
        }
      } catch (e) {
        log.debug(`Info nicht lesbar: ${e.message}`);
      }
    }
    if (this.api.info) {
      try {
        const i = await this.client.get('/api/v2/info');
        const iso = clockToIso(i.MA_CLOCK, i.MA_CALENDAR);
        this.state.clock = { machine: iso, readAt: new Date().toISOString(), tzIndex: i.TZ_IND };
      } catch { /* optional */ }
    }
  }

  _applySlow(single, general, overview) {
    const s = this.state;
    this._offsets = {
      bg: num(general.BG_TEMPERATURE_OFFSET ?? single.BG_TEMPERATURE_OFFSET) || 0,
      bb: num(general.BB_TEMPERATURE_OFFSET ?? single.BB_TEMPERATURE_OFFSET) || 0,
    };
    s.settings = {};
    for (const k of [...GENERAL_FIELDS, 'BB_FILL_LEVEL', 'MA_FIX_WATER_SUPPLY', 'VIEW']) s.settings[k] = num(general[k]);
    // Ein gerade erst gespeicherter Sollwert gilt 5 s lang vor dem (evtl. noch alten) Wert der Maschine
    s.temp.groupSet = this._recentSaved('groupSet') ?? num(single.BG_SET_TEMP ?? general.BG_SET_TEMP);
    s.temp.boilerSet = this._recentSaved('boilerSet') ?? num(single.BB_SET_TEMP ?? general.BB_SET_TEMP);
    s.pressure.steamSet = this._recentSaved('steamSet') ?? num(single.SB_SET_PRESS ?? general.SB_SET_PRESS);
    s.pressure.pumpSet = num(single.PU_SET_PRESS);
    const tankOk = num(single.PU_SENS_WATER_TANK_LEVEL) === 1;
    if (s.tankOk !== null && s.tankOk && !tankOk) this._event('tank', { title: 'Wassertank leer', body: 'Bitte Wasser nachfüllen.' });
    s.tankOk = tankOk;
    this._checkCounter(num(overview.MA_EXTRACTIONS), overview.MA_LAST_EXTRACTION_ML);
    s.counters = {
      extractions: num(overview.MA_EXTRACTIONS),
      operatingHours: num(overview.MA_OPERATING_HOURS),
      energyKwh: round(num(overview.MA_ENERGY_TOTAL_KWH), 3),
      currentPower: num(overview.MA_CUR_PWR),
      maxPower: num(overview.MA_MAX_PWR),
    };
  }

  _temp(raw, offset) {
    // Wie die offizielle Oberfläche: Offset erst oberhalb 40 °C abziehen.
    if (raw === null) return null;
    return round(raw > 40 ? raw - offset : raw, 1);
  }

  _applyLive(d) {
    this._lastDiag = d;
    const s = this.state;
    const prevStatus = s.status;
    const status = num(d.MA_STATUS);
    s.status = status;
    const st = MA_STATUS[status] || { key: 'unknown', label: `Status ${status}` };
    s.statusKey = st.key;
    s.statusLabel = st.label;
    // Paddle-Pumpen (Status 5) zählt die Maschine womöglich als Bezug: wie einen live gesehenen Start merken,
    // damit der Zählerabgleich daraus keinen „nachträglichen“ Bezug ohne Dauer macht (vergessen nach 3 min).
    if (status === 5 && prevStatus !== 5) this._liveStarts.push(Date.now());
    // Dampfkessel an: neue Firmware SB_STATUS 2; alte Firmware wie deren Original-Oberfläche „alles außer 1 (aus)“,
    // die DBL meldet beim Aufheizen einen anderen Wert als 2
    const sb = num(d.SB_STATUS);
    s.steamOn = this.api.general ? sb === 2 : sb !== null && sb !== 1;
    s.temp.groupRaw = num(d.BG_SENS_TEMP_A);
    s.temp.boilerRaw = num(d.BB_SENS_TEMP_A);
    s.temp.group = this._temp(s.temp.groupRaw, this._offsets.bg);
    s.temp.boiler = this._temp(s.temp.boilerRaw, this._offsets.bb);
    s.pressure.pump = round(num(d.PU_SENS_PRESS), 1);
    s.pressure.steam = round(num(d.SB_SENS_PRESS), 2);
    s.power = { group: num(d.BG_LEVEL_PW_CONTROL), boiler: num(d.BB_LEVEL_PW_CONTROL), pump: num(d.PU_LEVEL_PW_CONTROL) };
    s.scale = { weight: round(num(d.PU_LOADCELL_VOLUME), 1), rate: round(num(d.PU_LOADCELL_RATE), 1) };
    s.flow = { volume: round(num(d.PU_SENS_FLOW_METER_VOLUME), 1), rate: round(num(d.PU_SENS_FLOW_METER_FLOWRATE), 1), ml: round(num(d.PU_SENS_FLOW_METER_ML), 1) };
    let extractionMs = num(d.EXTRACTION_TIME_MS);

    // Bezug erkennen (Status 3)
    if (status === 3) {
      if (!s.shot.running) {
        this._shotClock = Date.now();
        this._liveStarts.push(this._shotClock);
        s.shot = { running: true, timeMs: 0, startedAt: new Date().toISOString(), curve: [] };
        s.lastFault = null;
        // Hat die App kurz vorher ein Skript gestartet, gehört es zu diesem Bezug (für die Zielkurve in der Analyse)
        const p = this._pendingScript;
        if (p && Date.now() - p.at < 20e3) s.shot.script = { id: p.id, title: p.title ?? this.builtinScripts()[p.id] ?? null, steps: p.steps ?? null };
        this._pendingScript = null;
        this.kick(this.cfg.pollActiveMs);
      }
      if (extractionMs == null || extractionMs === 0) extractionMs = Date.now() - (this._shotClock || Date.now());
      s.shot.timeMs = extractionMs;
      if (s.shot.curve.length < 600) {
        s.shot.curve.push([round(extractionMs / 1000, 1), s.pressure.pump, s.scale.weight, s.flow.ml]);
      }
    } else if (s.shot.running) {
      if (extractionMs == null || extractionMs === 0) extractionMs = Date.now() - (this._shotClock || Date.now());
      this._shotClock = null;
      this._finishShot(extractionMs);
    }

    // Aufgeheizt (einmal pro Einschaltvorgang). Paddle zählt als an: sonst käme nach jeder Backflush-Runde erneut „bereit“.
    const on = status === 1 || status === 3 || status === 4 || status === 5;
    if (!on) {
      s.heated = false;
      s.steamReady = false;
    } else if (!s.heated && s.temp.group !== null && s.temp.groupSet !== null && s.temp.group >= s.temp.groupSet - 0.8) {
      s.heated = true;
      if (prevStatus !== null) {
        this._event('heated', {
          title: 'Xenia ist bereit',
          body: `Brühgruppe ${fmt(s.temp.group)} °C (Ziel ${fmt(s.temp.groupSet)} °C)`,
          tag: 'heated',
        });
      }
    }
    if (on && s.steamOn && s.pressure.steamSet) {
      if (!s.steamReady && s.pressure.steam >= s.pressure.steamSet - 0.1) {
        s.steamReady = true;
        if (prevStatus !== null) this._event('steam', { title: 'Dampf bereit', body: `Dampfkessel ${fmt(s.pressure.steam, 2)} bar`, tag: 'steam' });
      }
    } else {
      s.steamReady = false;
    }

    // Ein-/Ausschalten, das nicht aus der App kam (Timer, Taste, Auto-Aus)
    if (prevStatus !== null && prevStatus !== status && Date.now() - this._lastAppAction > 15000) {
      const was = MA_STATUS[prevStatus]?.key;
      if (was === 'off' && (status === 1 || status === 2)) this._event('power', { title: 'Xenia eingeschaltet', body: status === 2 ? 'Eco-Modus' : 'Heizt auf …', tag: 'power' });
      if ((prevStatus === 1 || prevStatus === 2) && status === 0) this._event('power', { title: 'Xenia ausgeschaltet', body: 'Automatisch oder am Gerät ausgeschaltet.', tag: 'power' });
    }
    if (status === 6 && prevStatus !== 6) {
      // Lief gerade ein Bezug bzw. Skript, den Abbruch festhalten (Dashboard „Status“ zeigt ihn bis zum nächsten Bezug)
      const what = s.shot.running ? (s.shot.script?.title ? `Skript „${s.shot.script.title}“` : 'Bezug') : this._backflush ? 'Backflush' : null;
      s.lastFault = { at: new Date().toISOString(), text: what ? `${what} mit Störung abgebrochen` : 'Die Maschine meldet eine Störung' };
      this._event('fault', { title: 'Xenia meldet eine Störung', body: what ? `${what} wurde abgebrochen. Bitte die Maschine prüfen.` : 'Bitte die Maschine prüfen.', tag: 'fault' });
    }
    if (prevStatus !== status) this.kick(this.cfg.pollActiveMs);
    this.emit('state');
  }

  _finishShot(finalMs) {
    const s = this.state;
    const timeMs = Math.max(finalMs || 0, s.shot.timeMs || 0);
    // Gewicht vor dem Tarieren der Waage (alter Wert zu Beginn) verwerfen
    const curve = taredCurve(s.shot.curve);
    const maxPressure = curve.reduce((m, p) => Math.max(m, p[1] || 0), 0);
    const shot = {
      id: shotId(),
      endedAt: new Date().toISOString(),
      startedAt: s.shot.startedAt,
      timeMs,
      // Ausbeute: höchster Wert der Waage nach dem Tarieren – setzt sie am Ende schon zurück, bleibt er erhalten
      weight: round(Math.max(s.scale.weight || 0, curveYield(curve) || 0), 1) || null,
      volumeMl: s.flow.ml || s.flow.volume || null,
      maxPressure: round(maxPressure, 1),
      groupTemp: s.temp.group,
      curve: curve.slice(0, 300),
      ...(s.shot.script ? { script: s.shot.script } : {}),
    };
    // Vorbrühen, Bezugszeit (ohne Vorbrühen) und ersten Tropfen festhalten – bleiben auch, wenn die Kurve später entfällt
    const ph = shotPhases({ timeMs, curve });
    shot.preinfusionMs = ph.preMs;
    shot.brewMs = ph.brewMs;
    shot.firstDropMs = ph.firstDropMs;
    // Dosis: die Waage misst nur die Ausbeute; ohne Mühle gilt die eingestellte Standard-Dosis (änderbar am Bezug)
    const defDose = this.defaultDoseG;
    if (defDose) shot.doseDefaultG = defDose;
    s.shot = { running: false, timeMs: 0, startedAt: null, curve: [] };
    // Zu kurze Pumpvorgänge (Spülen, Backflush, Fehlbezug) erscheinen weder im Protokoll noch als „letzter Bezug“
    if (timeMs >= this.minShotMs) {
      s.lastShot = shot;
      shot.no = (s.counters?.extractions ?? null) !== null ? s.counters.extractions + this._liveStarts.length : null;
      this._log(shot);
      const parts = [`${fmt((shot.brewMs ?? timeMs) / 1000)} s`];
      if (shot.weight) parts.push(`${fmt(shot.weight)} g`);
      else if (shot.volumeMl) parts.push(`${fmt(shot.volumeMl, 0)} ml`);
      if (shot.maxPressure) parts.push(`max. ${fmt(shot.maxPressure)} bar`);
      this._event('shot', { title: 'Bezug fertig', body: parts.join(' · '), tag: 'shot', shotId: shot.id });
    }
  }

  _markOnline() {
    const s = this.state;
    if (!s.online && this._offlineNotified) {
      this._event('offline', { title: 'Xenia wieder erreichbar', body: 'Die Verbindung zur Maschine steht wieder.', tag: 'offline-machine' });
    }
    s.online = true;
    s.error = null;
    s.lastSeen = new Date().toISOString();
    this._retrying = false;
    this._failSince = null;
    this._offlineNotified = false;
  }

  _markOffline(e) {
    const s = this.state;
    if (s.online) log.warn(`Maschine nicht erreichbar: ${e.message}`);
    s.online = false;
    s.error = e.message;
    this._failSince ??= Date.now();
    if (!this._offlineNotified && Date.now() - this._failSince > 3 * 60e3) {
      this._offlineNotified = true;
      this._event('offline', { title: 'Xenia nicht erreichbar', body: 'Seit 3 Minuten keine Verbindung zur Maschine (WLAN/Strom?).', tag: 'offline-machine' });
    }
    this.emit('state');
  }

  _event(topic, msg) {
    log.info(`Ereignis ${topic}: ${msg.title} – ${msg.body}`);
    this.emit('event', { topic, ...msg, at: new Date().toISOString() });
  }

  // Passt das eingestellte Modell? Wie der Verbindungstest beim Einrichten: /api/v2/general hat nur die neue Xenia.
  _noteApi(detected) {
    const mismatch = detected !== this.apiId ? { configured: this.apiId, detected } : null;
    const key = (x) => (x ? `${x.configured}>${x.detected}` : '');
    if (key(mismatch) === key(this.state.apiMismatch)) return;
    this.state.apiMismatch = mismatch;
    const name = { bbs: 'neue Xenia', classic: 'alte Xenia (DBL)' };
    if (mismatch) log.warn(`Eingestellt ist ${name[mismatch.configured]}, die Maschine antwortet aber wie die ${name[mismatch.detected]} – unter Einstellungen → Modell & Aussehen umstellen`);
    this.emit('state');
  }

  // Alte Xenia: alle 10 s nachsehen, ob die Bluetooth-Waage verbunden ist. Ein Gewicht ungleich 0 zählt sofort.
  async _readScaleLink(d) {
    if (this.apiId !== 'classic') return;
    const weighs = (num(d?.SCALE_WEIGHT) || 0) !== 0;
    if (Date.now() >= (this._scaleLinkAt || 0)) {
      this._scaleLinkAt = Date.now() + 10_000;
      try {
        const mm = await this.client.get('/api/v2/machine');
        if (mm && 'BLE' in mm) this._ble = (num(mm.BLE) || 0) > 0;
      } catch { /* optional */ }
    }
    if (this._ble === undefined && !weighs) return;
    const connected = Boolean(this._ble) || weighs;
    if (this.state.scaleLink?.connected !== connected) {
      this.state.scaleLink = { connected };
      this.emit('state');
    }
  }

  snapshot() {
    return { ...this.state, api: this.apiId, shot: { ...this.state.shot, curve: this.state.shot.curve.slice(-120) } };
  }

  // Bezugs-Protokoll: bis zu 2000 Einträge, Druckkurven nur für die neuesten 100 (Speicherplatz)
  _log(shot) {
    const h = this.history.data;
    // Ohne Mühle und eigene Angabe gilt die Standard-Dosis – auch für nachträglich (über den Zähler) erfasste Bezüge
    const defDose = this.defaultDoseG;
    if (defDose && shot.doseDefaultG == null && shot.dose?.g == null && shot.notes?.doseG == null) shot.doseDefaultG = defDose;
    h.shots.unshift(shot);
    h.shots = h.shots.slice(0, 2000);
    for (let i = 100; i < h.shots.length && h.shots[i].curve; i++) delete h.shots[i].curve;
    this.history.save();
  }

  // Bezüge, die nicht live erkannt wurden (App/Server war aus, Bezug zu kurz zwischen zwei Abfragen):
  // Der Bezugszähler der Maschine (MA_EXTRACTIONS) steigt trotzdem. Dann einen Eintrag mit den
  // zuletzt gemeldeten Werten (Zeit, Waage) anlegen.
  // Die Maschine zählt einen Bezug erst an seinem Ende. Ein live erkannter Start bleibt deshalb in _liveStarts,
  // bis der Zähler ihn mitgezählt hat – ein Abgleich mitten im Bezug macht daraus keinen „verpassten“ Bezug.
  _checkCounter(count, lastMl) {
    if (count === null || !Number.isFinite(count)) return;
    const h = this.history.data;
    const prev = h.counter ?? null;
    h.counter = count;
    // Starts, die der Zähler nie mitzählt (z. B. kurzes Spülen), nach 3 min vergessen; der laufende Bezug bleibt
    const now = Date.now();
    this._liveStarts = this._liveStarts.filter((t, i, a) => now - t < 3 * 60e3 || (this.state.shot.running && i === a.length - 1));
    if (prev === null || count <= prev) {
      if (prev !== count) this.history.save();
      return;
    }
    const used = Math.min(this._liveStarts.length, count - prev);
    this._liveStarts.splice(0, used);
    const missed = count - prev - used;
    // Werte der letzten Abfrage nur übernehmen, wenn sie nicht zu einem schon live protokollierten Bezug gehören
    const diag = { ...(this._lastDiag || {}) };
    if (num(diag.EXTRACTION_TIME_MS) === null && this._diagExtractionMs != null) diag.EXTRACTION_TIME_MS = this._diagExtractionMs;
    const lastLogged = h.shots[0];
    const stale = Boolean(lastLogged && !lastLogged.estimated && Math.abs((lastLogged.timeMs || 0) - (num(diag.EXTRACTION_TIME_MS) || 0)) < 500);
    // älteste zuerst eintragen, damit der neueste oben im Protokoll steht
    for (let i = Math.min(missed, 20) - 1; i >= 0; i--) {
      const d = i === 0 && !stale ? diag : {};
      const timeMs = num(d.EXTRACTION_TIME_MS);
      const shot = {
        id: shotId(),
        endedAt: new Date().toISOString(),
        startedAt: null,
        timeMs: timeMs || null,
        weight: i === 0 ? round(num(d.PU_LOADCELL_VOLUME), 1) || null : null,
        volumeMl: i === 0 && !stale ? round(num(d.PU_SENS_FLOW_METER_ML) ?? num(lastMl), 1) || null : null,
        maxPressure: null,
        groupTemp: null,
        no: count - i,
        estimated: true, // nicht live erfasst: Zeitpunkt = Zeitpunkt der Zählerprüfung
      };
      // Zu kurze (Spülen/Backflush) bleiben im Speicher, werden aber nicht gelistet (listedShots)
      if (i === 0 && timeMs && timeMs >= this.minShotMs) this.state.lastShot = shot;
      this._log(shot);
    }
    this.history.save();
  }

  // Doppelte Einträge aus älteren Versionen entfernen: Lief der Zählerabgleich mitten im Bezug, entstand nach dem live
  // erfassten Bezug ein zweiter, „nachträglicher“ mit dessen Werten. Der live erfasste (mit Kurve) bleibt und erhält die
  // Nummer des doppelten, denn die Zählung hatte ihn eins zu niedrig nummeriert.
  _repairHistory() {
    const list = this.history.data.shots;
    if (!Array.isArray(list)) return;
    let removed = 0;
    // Ältere Bezüge: Gewicht vor dem Tarieren der Waage steckte in Kurve und Ausbeute (z. B. 293 g statt 44 g)
    let fixed = 0;
    for (const shot of list) {
      if (!Array.isArray(shot.curve) || !shot.curve.length) continue;
      const tared = taredCurve(shot.curve);
      if (tared === shot.curve) continue;
      shot.curve = tared;
      const y = curveYield(tared);
      if (y) shot.weight = y;
      fixed++;
    }
    if (fixed) this.history.save();
    for (let i = 0; i < list.length - 1; i++) {
      const dup = list[i];
      const live = list[i + 1];
      const gap = Date.parse(dup.endedAt) - Date.parse(live.endedAt);
      if (dup.estimated && !live.estimated && dup.timeMs && live.timeMs && Math.abs(dup.timeMs - live.timeMs) < 500 && gap >= 0 && gap < 5 * 60e3) {
        if (dup.no) live.no = dup.no;
        list.splice(i, 1);
        removed++;
        i--;
      }
    }
    // Zu kurze Einträge aus älteren Versionen (Spülen, Rückspülen), solange niemand etwas dazu notiert hat
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      if (s.timeMs && s.timeMs < Math.min(MIN_SHOT_MS, this.minShotMs) && !s.notes && !s.dose) {
        list.splice(i, 1);
        removed++;
      }
    }
    // Ältere Einträge ohne ID bekommen eine stabile aus ihrem Zeitpunkt (für Notizen und die Detailansicht)
    const seen = new Set(list.map((s) => s.id).filter(Boolean));
    let ids = 0;
    for (const s of list) {
      if (s.id) continue;
      let id = `t${(Date.parse(s.endedAt) || 0).toString(36)}`;
      while (seen.has(id)) id += 'x';
      seen.add(id);
      s.id = id;
      ids++;
    }
    if (removed || ids) this.history.save();
    if (removed) log.info(`${removed} doppelte Bezüge im Protokoll zusammengeführt`);
    this._syncBeans();
  }

  // Bohnen: eigene Liste. Einmalig Namen aus älteren Bewertungen übernehmen; danach nur noch über saveBean.
  _syncBeans() {
    const h = this.history.data;
    if (Array.isArray(h.beans)) return;
    const have = new Set();
    h.beans = [];
    for (const s of h.shots || []) {
      const n = String(s.notes?.bean || '').trim();
      if (n && !have.has(n)) {
        h.beans.push({ name: n, roaster: '' });
        have.add(n);
      }
    }
    this.history.save();
  }

  listBeans() {
    this._syncBeans();
    return [...this.history.data.beans].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }

  saveBean({ name, roaster, rename }) {
    const n = cleanBean(name);
    this._syncBeans();
    const list = this.history.data.beans;
    if (rename) {
      const from = cleanBean(rename);
      const hit = list.find((b) => b.name === from);
      if (!hit) throw httpError(404, 'Bohne nicht gefunden');
      if (n !== from && list.some((b) => b.name === n)) throw httpError(409, `„${n}“ gibt es schon`);
      hit.name = n;
      if (roaster !== undefined) hit.roaster = cleanRoaster(roaster);
      for (const s of this.history.data.shots) {
        if (s.notes?.bean === from) s.notes.bean = n;
      }
    } else {
      const hit = list.find((b) => b.name === n);
      if (hit) {
        if (roaster !== undefined) hit.roaster = cleanRoaster(roaster);
      } else {
        list.push({ name: n, roaster: cleanRoaster(roaster) });
      }
    }
    this.history.save();
    return { beans: this.listBeans() };
  }

  deleteBean(name) {
    const n = cleanBean(name);
    const list = this.history.data.beans || [];
    const i = list.findIndex((b) => b.name === n);
    if (i < 0) throw httpError(404, 'Bohne nicht gefunden');
    list.splice(i, 1);
    this.history.save();
    return { beans: this.listBeans() };
  }

  // Protokoll-Einträge; Druckkurven nur für die ersten `curves` (Datenmenge)
  // Mindestdauer eines Bezugs (ms). Kürzere werden nicht protokolliert und ältere nicht mehr gelistet.
  get minShotMs() {
    const v = Number(this.history.data.settings?.minShotS);
    return Number.isFinite(v) && v >= MIN_SHOT_LIMITS.min && v <= MIN_SHOT_LIMITS.max ? Math.round(v * 1000) : MIN_SHOT_MS;
  }

  // Standard-Dosis (g) für neue Bezüge ohne Mühle; null = keine
  get defaultDoseG() {
    const v = Number(this.history.data.settings?.defaultDoseG);
    return Number.isFinite(v) && v >= 3 && v <= 40 ? v : null;
  }

  shotSettings() {
    return { minShotS: this.minShotMs / 1000, limits: MIN_SHOT_LIMITS, defaultMinShotS: MIN_SHOT_MS / 1000, defaultDoseG: this.defaultDoseG };
  }

  setShotSettings({ minShotS, defaultDoseG } = {}) {
    const next = { ...(this.history.data.settings || {}) };
    if (minShotS !== undefined) {
      const v = Number(minShotS);
      if (!Number.isFinite(v) || v < MIN_SHOT_LIMITS.min || v > MIN_SHOT_LIMITS.max) throw httpError(400, `Mindestdauer muss zwischen ${MIN_SHOT_LIMITS.min} und ${MIN_SHOT_LIMITS.max} s liegen`);
      next.minShotS = Math.round(v);
    }
    if (defaultDoseG !== undefined) {
      if (defaultDoseG === null || defaultDoseG === '') delete next.defaultDoseG;
      else {
        const d = Number(defaultDoseG);
        if (!Number.isFinite(d) || d < 3 || d > 40) throw httpError(400, 'Standard-Dosis muss zwischen 3 und 40 g liegen');
        next.defaultDoseG = Math.round(d * 10) / 10;
        // Bisherige Bezüge ganz ohne Dosis bekommen sie ebenfalls, damit auch dort das Verhältnis erscheint
        for (const shot of this.history.data.shots || []) {
          if (shot.doseDefaultG == null && shot.dose?.g == null && shot.notes?.doseG == null) shot.doseDefaultG = next.defaultDoseG;
        }
      }
    }
    this.history.data.settings = next;
    this.history.save();
    const last = this.listedShots()[0] || null;
    if (!this.state.shot.running) this.state.lastShot = last;
    this.emit('state');
    return this.shotSettings();
  }

  // Bezüge, die gelistet werden: ohne zu kurze (bewertete/notierte bleiben immer sichtbar)
  listedShots() {
    const min = this.minShotMs;
    // Zu kurz oder Dauer unbekannt (nachträglich erkannt, ohne Bezugszeit) → nicht listen, außer bewertet/mit Dosis
    const short = (s) => (s.timeMs ? s.timeMs < min : Boolean(s.estimated)) || (s.timeMs === 0);
    return this.history.data.shots.filter((s) => !(short(s) && !s.notes && !s.dose));
  }

  shots(limit = 30, { curves = limit } = {}) {
    return this.listedShots().slice(0, limit).map((s, i) => (i < curves ? s : { ...s, curve: undefined }));
  }

  shotsCsv() {
    const cell = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
    const text = (v) => (v ? `"${String(v).replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"` : '');
    const rows = [['Nr', 'Ende', 'Bezugszeit (s)', 'Vorbrühen (s)', 'Gesamt (s)', 'Erster Tropfen (s)', 'Gewicht (g)', 'Menge (ml)', 'Max. Druck (bar)', 'Brühgruppe (°C)', 'Live erfasst',
      'Dosis (g)', 'Verhältnis 1:', 'Rezept Mühle', 'Skript', 'Bohne', 'Mahlgrad', 'Bewertung', 'Geschmack', 'Stärke', 'Notiz']];
    for (const s of this.listedShots()) {
      const n = s.notes || {};
      const yieldG = n.yieldG ?? s.weight;
      const doseG = n.doseG ?? s.dose?.g ?? s.doseDefaultG ?? null;
      const ratio = doseG && yieldG ? Math.round((yieldG / doseG) * 10) / 10 : null;
      const ph = shotPhases(s);
      const sec = (ms) => (ms ? Math.round(ms / 100) / 10 : null);
      rows.push([s.no ?? '', s.endedAt, cell(sec(ph.brewMs)), cell(sec(ph.preMs)), cell(sec(s.timeMs)), cell(sec(ph.firstDropMs)), cell(s.weight), cell(s.volumeMl), cell(s.maxPressure), cell(s.groupTemp), s.estimated ? 'nein' : 'ja',
        cell(doseG), cell(ratio), s.dose?.recipe ?? '', text(s.script?.title), text(n.bean), text(n.grind), n.rating ?? '', TASTE[n.taste] ?? '', STRENGTH[n.strength] ?? '', text(n.text)]);
    }
    return '﻿' + rows.map((r) => r.join(';')).join('\r\n') + '\r\n';
  }

  _shot(id) {
    const s = this.history.data.shots.find((x) => x.id === String(id));
    if (!s) throw httpError(404, 'Bezug nicht gefunden');
    return s;
  }

  // Ein Bezug mit Vergleichskurven: frühere Bezüge mit demselben Skript, sonst derselben Bohne, sonst die letzten;
  // dazu der Referenz-Bezug (zur selben Bohne, falls vorhanden).
  shotDetail(id) {
    const shot = this._shot(id);
    const list = this.history.data.shots;
    const i = list.indexOf(shot);
    const earlier = list.slice(i + 1).filter((s) => s.curve?.length > 1);
    const bean = shot.notes?.bean;
    const same = (pred) => earlier.filter(pred).slice(0, 5);
    const compare = (shot.script ? same((s) => s.script?.id === shot.script.id) : [])
      .concat(bean ? same((s) => s.notes?.bean === bean) : [])
      .concat(earlier.slice(0, 5))
      .filter((s, k, a) => a.indexOf(s) === k)
      .slice(0, 5);
    const refs = list.filter((s) => s.notes?.reference && s !== shot && s.curve?.length > 1);
    const reference = (bean && refs.find((s) => s.notes.bean === bean)) || refs[0] || null;
    return { shot, compare, reference, beans: this.listBeans(), advice: dialIn(shot, list.slice(i + 1, i + 60)), lastGrind: this._lastGrind(shot) };
  }

  // Vorschlag für die Bewertung: Abstand der Mühle (µm) am zugeordneten Mahlvorgang, sonst zuletzt notiert
  _lastGrind(shot) {
    if (shot.dose?.ddd != null) return String(shot.dose.ddd);
    const list = this.history.data.shots;
    const bean = shot.notes?.bean;
    const hit = list.find((s) => s !== shot && (!bean || s.notes?.bean === bean) && (s.notes?.grind || s.dose?.ddd != null));
    return hit?.notes?.grind ?? (hit?.dose?.ddd != null ? String(hit.dose.ddd) : null);
  }

  // Bewertung und Notizen zu einem Bezug (alle Felder optional; null löscht)
  annotateShot(id, body = {}) {
    const shot = this._shot(id);
    const n = { ...(shot.notes || {}) };
    const set = (k, v) => { if (v === null || v === undefined || v === '') delete n[k]; else n[k] = v; };
    if ('rating' in body) {
      const r = body.rating === null ? null : Number(body.rating);
      if (r !== null && !(Number.isInteger(r) && r >= 1 && r <= 5)) throw httpError(400, 'Bewertung: 1 bis 5 Sterne');
      set('rating', r);
    }
    if ('taste' in body) {
      if (body.taste !== null && !(body.taste in TASTE)) throw httpError(400, 'Geschmack: sour, balanced oder bitter');
      set('taste', body.taste);
    }
    if ('strength' in body) {
      if (body.strength !== null && !(body.strength in STRENGTH)) throw httpError(400, 'Stärke: weak, ok oder strong');
      set('strength', body.strength);
    }
    // Mahlgrad der E64 WS: Scheibenabstand in µm (DDD), als Text damit ältere Angaben (z. B. 3,5) bleiben
    if ('grind' in body) set('grind', body.grind === null ? null : String(body.grind).trim().replace(/[\u0000-\u001f]/g, '').slice(0, 12));
    if ('bean' in body) {
      if (body.bean === null || body.bean === '') set('bean', null);
      else {
        const name = cleanBean(body.bean);
        set('bean', name);
        this.saveBean({ name });
      }
    }
    if ('text' in body) set('text', body.text === null ? null : String(body.text).trim().slice(0, 500));
    if ('yieldG' in body) {
      const y = body.yieldG === null || body.yieldG === '' ? null : Number(body.yieldG);
      if (y !== null && !(Number.isFinite(y) && y > 0 && y < 400)) throw httpError(400, 'Ausbeute: 1 bis 399 g');
      set('yieldG', y === null ? null : round(y, 1));
    }
    if ('doseG' in body) {
      // Dosis von Hand, falls die Mühle keinen passenden Mahlvorgang kennt
      const d = body.doseG === null || body.doseG === '' ? null : Number(body.doseG);
      if (d !== null && !(Number.isFinite(d) && d > 0 && d < 40)) throw httpError(400, 'Dosis: 1 bis 39 g');
      set('doseG', d === null ? null : round(d, 1));
    }
    if ('reference' in body) set('reference', body.reference ? true : null);
    if (Object.keys(n).length) shot.notes = n;
    else delete shot.notes;
    this.history.save();
    const i = this.history.data.shots.indexOf(shot);
    return { shot, advice: dialIn(shot, this.history.data.shots.slice(i + 1, i + 60)) };
  }

  // Mahlvorgang der Mühle dem Bezug zuordnen: der letzte erfolgreiche bis 20 min vor dem Start (Dosis, Rezept, Verhältnis).
  // Läuft nach jedem Abgleich mit der Mühle; betrachtet nur Bezüge der letzten 48 h.
  linkGrinds(grinds) {
    if (!Array.isArray(grinds) || !grinds.length) return 0;
    const list = this.history.data.shots;
    const used = new Set(list.map((s) => s.dose?.grindId).filter((x) => x !== undefined));
    const now = Date.now();
    let linked = 0;
    for (const s of list) {
      const end = Date.parse(s.endedAt);
      if (now - end > 48 * 3600e3) break;
      if (s.dose) continue;
      const start = s.startedAt ? Date.parse(s.startedAt) : end - (s.timeMs || 0);
      const g = grinds
        .filter((x) => x.success && x.weightG > 0 && !used.has(x.id))
        .map((x) => ({ x, t: Date.parse(x.at) }))
        .filter(({ t }) => Number.isFinite(t) && t <= start + 60e3 && t >= start - 20 * 60e3)
        .sort((a, b) => b.t - a.t)[0]?.x;
      if (!g) continue;
      s.dose = { g: g.weightG, targetG: g.targetG ?? null, recipe: g.recipe ?? null, type: g.type ?? null, grindId: g.id, at: g.at, durationMs: g.durationMs ?? null, gbs: Boolean(g.gbs), ddd: g.ddd ?? null };
      used.add(g.id);
      linked++;
    }
    if (linked) this.history.save();
    return linked;
  }

  // --- Pflege: Backflush-Erinnerung ------------------------------------------------
  maintenance() {
    const m = this.history.data.maintenance || {};
    const intervalDays = m.intervalDays ?? 7;
    const last = m.backflushAt ? Date.parse(m.backflushAt) : null;
    const since = (t) => this.history.data.shots.filter((s) => !last || Date.parse(s.endedAt) > t).length;
    const daysSince = last ? Math.floor((Date.now() - last) / 86400e3) : null;
    return {
      backflush: { lastAt: m.backflushAt ?? null, daysSince, shotsSince: last ? since(last) : null, intervalDays, due: daysSince === null || daysSince >= intervalDays },
    };
  }

  markBackflush() {
    this.history.data.maintenance = { ...(this.history.data.maintenance || {}), backflushAt: new Date().toISOString() };
    this.history.save();
    return this.maintenance();
  }

  setMaintenance({ intervalDays }) {
    const d = Number(intervalDays);
    if (!(Number.isInteger(d) && d >= 1 && d <= 60)) throw httpError(400, 'Intervall: 1 bis 60 Tage');
    this.history.data.maintenance = { ...(this.history.data.maintenance || {}), intervalDays: d };
    this.history.save();
    return this.maintenance();
  }

  // --- Aktionen ---------------------------------------------------------------

  // Nach dem Speichern von Einstellungen: Sollwerte sofort im Zustand zeigen und die Maschine neu lesen. Mehrere
  // Speichervorgänge kurz hintereinander könnten sonst einen noch alten Wert lesen und bis zur nächsten langsamen
  // Abfrage (1 min) anzeigen; deshalb nach 3 s noch einmal lesen.
  _settingsSaved(changes) {
    const s = this.state;
    const v = (k) => (k in changes && Number.isFinite(Number(changes[k])) ? Number(changes[k]) : null);
    if (v('BG_SET_TEMP') !== null) s.temp.groupSet = v('BG_SET_TEMP');
    if (v('BB_SET_TEMP') !== null) s.temp.boilerSet = v('BB_SET_TEMP');
    if (v('SB_SET_PRESS') !== null) s.pressure.steamSet = v('SB_SET_PRESS');
    this._savedSet = { at: Date.now(), groupSet: v('BG_SET_TEMP') ?? this._recentSaved('groupSet'), boilerSet: v('BB_SET_TEMP') ?? this._recentSaved('boilerSet'), steamSet: v('SB_SET_PRESS') ?? this._recentSaved('steamSet') };
    this.emit('state');
    this._slowAt = 0;
    this._acted();
    clearTimeout(this._rereadTimer);
    this._rereadTimer = setTimeout(() => { this._slowAt = 0; if (!this._stopped) this.kick(); }, 3000);
    this._rereadTimer.unref?.();
  }

  // Kurz zuvor gespeicherter Sollwert (5 s): hat Vorrang vor einem noch alten Wert aus der Maschine
  _recentSaved(key) {
    const r = this._savedSet;
    return r && Date.now() - r.at < 5000 ? r[key] ?? null : null;
  }

  _acted() {
    this._lastAppAction = Date.now();
    this._burstUntil = Date.now() + (this.cfg.actionBurstMs ?? 20000);
    setTimeout(() => this.kick(), 300);
  }

  // mode: 'on' | 'off' | 'eco'; steam: true/false/undefined (= nach Startmodus)
  async power(mode, steam) {
    const action = { off: '0', on: '1', eco: '2' }[mode];
    if (action === undefined) throw new Error('Ungültiger Modus');
    this._lastAppAction = Date.now();
    if (!this.api.toggleSb) {
      // Alte API: Dampf über dieselben control-Aktionen (3 aus, 4 an, 5 an ohne Dampf)
      let act = action;
      if (mode === 'on' && steam === false) act = '5';
      await this.client.post('/api/v2/machine/control', { action: act });
      this._acted();
      return { ok: true };
    }
    await this.client.post('/api/v2/machine/control', { action });
    // Wie die offizielle Oberfläche: Dampfkessel passend mitschalten
    let sb;
    if (mode === 'off' || mode === 'eco') sb = 0;
    else if (steam === true || steam === false) sb = steam ? 1 : 0;
    else sb = (this.state.settings?.MA_BOILER_START_MODE ?? 1) === 2 ? 0 : 1;
    await this.client.post('/api/v2/toggle/sb', { TOGGLE: sb });
    this._acted();
    return { ok: true };
  }

  async steam(on) {
    this._lastAppAction = Date.now();
    if (!this.api.toggleSb) {
      await this.client.post('/api/v2/machine/control', { action: on ? '4' : '3' });
    } else {
      await this.client.post('/api/v2/toggle/sb', { TOGGLE: on ? 1 : 0 });
    }
    this._acted();
    return { ok: true };
  }

  // Alte Xenia: Kann die Firmware die Seiten-API der Original-Oberfläche (/api/v2/brewgroup, /pump, /paddle …)?
  // Die DBL mit Firmware 4.1xx kann es, ältere Stände nur inc_dec. Ergebnis wird gemerkt.
  async classicCaps() {
    if (this.api.general) return { pages: false, paddle: true };
    if (this._caps) return this._caps;
    let pages = false;
    try {
      const d = await this.client.get('/api/v2/boilerandbrewgroup');
      pages = d && typeof d === 'object' && ('BG_SET_TEMP' in d || 'BB_SET_TEMP' in d);
    } catch (e) {
      if (e.status === 502) throw e; // offline: später erneut prüfen
    }
    this._caps = { pages, paddle: pages };
    if (this.state.info) this.state.info.caps = this._caps;
    return this._caps;
  }

  builtinScripts() {
    return this.api.general ? BUILTIN_SCRIPTS : CLASSIC_BUILTIN_SCRIPTS;
  }

  // Live-Abfrage: neue Xenia über diagram/get. Alte Xenia immer über overview: nur dort steht das Gewicht einer
  // per Bluetooth verbundenen Waage (SCALE_WEIGHT, PU_SENS_SCALE_RATE). Die Bezugszeit der Maschine holt bei der
  // DBL mit Seiten-API die langsame Abfrage aus diagram/get (für nachträglich erkannte Bezüge).
  get livePath() {
    return this.api.general ? this.api.livePath : '/api/v2/overview';
  }

  get hasPaddle() {
    return this.api.paddle || Boolean(this._caps?.paddle);
  }

  async readSettings() {
    if (this.api.general) return this.client.get('/api/v2/general');
    const single = await this.client.get('/api/v2/overview_single');
    let machine = {};
    try { machine = await this.client.get('/api/v2/machine'); } catch { /* optional */ }
    const out = {
      BG_SET_TEMP: num(single.BG_SET_TEMP), BB_SET_TEMP: num(single.BB_SET_TEMP),
      SB_SET_PRESS: num(single.SB_SET_PRESS), PU_SET_PRESS: num(single.PU_SET_PRESS),
      MA_SET_TIMER_ECO_MA: num(machine.MA_SET_TIMER_ECO_MA),
      MA_SET_TIMER_POWERDOWN: num(machine.MA_SET_TIMER_POWERDOWN),
      MA_FIX_WATER_SUPPLY: num(machine.MA_FIX_WATER_SUPPLY),
      MA_HEATUP_FLUSH_EN: num(machine.MA_HEATUP_FLUSH_EN),
    };
    const caps = await this.classicCaps().catch(() => ({ pages: false }));
    if (!caps.pages) return out;
    // Seiten-API: alle Werte, die die Original-Seiten anzeigen
    const reads = {};
    for (const pg of CLASSIC_PAGES) {
      if (!(pg.read in reads)) reads[pg.read] = pg.read === '/api/v2/machine' ? machine : await this.client.get(pg.read).catch(() => ({}));
      for (const k of [...pg.fields, ...pg.keep]) if (k in reads[pg.read]) out[k] = num(reads[pg.read][k]);
    }
    out._pages = true;
    return out;
  }

  // Neue Xenia: POST /api/v2/general (alle Felder). Alte Xenia: Seiten-API bzw. incdec / incdecsb.
  async updateSettings(changes) {
    if (!this.features.settings) throw httpError(403, 'Einstellungen ändern ist deaktiviert');
    if (!this.api.general) return this._updateClassicSettings(changes);
    const current = await this.client.get('/api/v2/general');
    const body = {};
    for (const k of GENERAL_FIELDS) {
      let v = k in changes ? Number(changes[k]) : Number(current[k]);
      if (k in changes) {
        const [min, max] = SETTING_LIMITS[k];
        if (!Number.isFinite(v) || v < min || v > max) throw httpError(400, `${SETTING_LABELS[k] || k} muss zwischen ${min} und ${max} liegen`);
      }
      if (k === 'MA_HEATUP_FLUSH_DURATION' && v < 1) v = 1;
      body[k] = String(v);
    }
    for (const k of Object.keys(changes)) if (!GENERAL_FIELDS.includes(k)) throw httpError(400, `Unbekannte Einstellung ${k}`);
    await this.client.post('/api/v2/general', body);
    this._settingsSaved(changes);
    return { ok: true };
  }

  async _updateClassicSettings(changes) {
    const caps = await this.classicCaps();
    if (caps.pages) return this._updateClassicPages(changes);
    for (const k of Object.keys(changes)) {
      if (!CLASSIC_SETTING_FIELDS.includes(k)) throw httpError(400, `Unbekannte Einstellung ${k}`);
      checkLimit(k, changes[k]);
    }
    // Die Original-Startseite nutzt incdec/incdecsb, die alte API-Doku inc_dec/inc_dec_sb: beides versuchen
    const post = async (paths, body) => {
      let last;
      for (const p of paths) {
        try { return await this.client.post(p, body); } catch (e) { last = e; if (e.status !== 404) throw e; }
      }
      throw last;
    };
    if ('BG_SET_TEMP' in changes || 'BB_SET_TEMP' in changes) {
      const cur = await this.client.get('/api/v2/overview_single');
      await post(['/api/v2/incdec', '/api/v2/inc_dec'], {
        BG_SET_TEMP: String(changes.BG_SET_TEMP ?? cur.BG_SET_TEMP),
        BB_SET_TEMP: String(changes.BB_SET_TEMP ?? cur.BB_SET_TEMP),
      });
    }
    if ('SB_SET_PRESS' in changes) {
      await post(['/api/v2/incdecsb', '/api/v2/inc_dec_sb'], { SB_SET_PRESS: String(changes.SB_SET_PRESS) });
    }
    this._settingsSaved(changes);
    return { ok: true };
  }

  // Seiten-API: je betroffener Seite aktuelle Werte lesen, Änderungen einsetzen, alle Felder der Seite senden
  // (wie die Original-Oberfläche). Fehlt ein Feld in der Antwort der Maschine, wird nichts gesendet.
  async _updateClassicPages(changes) {
    const known = new Set(CLASSIC_PAGES.flatMap((pg) => pg.fields));
    for (const k of Object.keys(changes)) {
      if (!known.has(k)) throw httpError(400, `Unbekannte Einstellung ${k}`);
      if (k === 'MA_HEATUP_FLUSH_DURATION') {
        const v = Number(changes[k]);
        if (!Number.isInteger(v) || v < 0 || v > 20) throw httpError(400, 'Spüldauer muss zwischen 0 und 20 s liegen');
      } else checkLimit(k, changes[k]);
    }
    const reads = {};
    for (const pg of CLASSIC_PAGES) {
      if (!pg.fields.some((k) => k in changes)) continue;
      reads[pg.read] ??= await this.client.get(pg.read);
      const cur = reads[pg.read];
      const body = {};
      for (const k of [...pg.fields, ...pg.keep]) {
        const v = k in changes ? Number(changes[k]) : num(cur[k]);
        if (v === null || !Number.isFinite(v)) {
          if (pg.keep.includes(k) && k === 'PU_MODE') continue; // Maschinen ohne Pumpenmodus (pump2)
          throw httpError(502, `Die Maschine liefert „${SETTING_LABELS[k] || k}“ nicht – nichts gespeichert`);
        }
        body[k] = String(v);
      }
      for (const [t, e] of [['BG_SET_TEMP', 'BG_SET_ECO_TEMP'], ['BB_SET_TEMP', 'BB_SET_ECO_TEMP']]) {
        if (t in body && Number(body[t]) < Number(body[e])) throw httpError(400, `${SETTING_LABELS[e]} darf nicht über ${SETTING_LABELS[t]} liegen`);
      }
      const path = pg.path === '/api/v2/pump' && !('PU_MODE' in body) ? '/api/v2/pump2' : pg.path;
      await this.client.post(path, body);
    }
    this._settingsSaved(changes);
    return { ok: true };
  }

  async setTemperature(group, boiler) {
    const g = Number(group);
    if (!Number.isFinite(g) || g < 60 || g > 96) throw httpError(400, 'Brühgruppe muss zwischen 60 und 96 °C liegen');
    const ch = { BG_SET_TEMP: g };
    ch.BB_SET_TEMP = boiler ?? group;
    return this.updateSettings(ch);
  }

  async scripts() {
    let last;
    let d;
    for (const p of this.api.scriptsList) {
      try { d = await this.client.get(p); break; } catch (e) { last = e; }
    }
    if (!d) throw last || httpError(502, 'Skriptliste nicht lesbar');
    const list = (d.index_list || []).map((id, i) => ({ id: Number(id), title: d.title_list?.[i] ?? `Skript ${id}`, type: scriptType(Number(id)) }));
    list.sort((a, b) => a.id - b.id);
    return list;
  }

  async readScript(id) {
    const d = await this.client.post('/api/v2/scripts/read', { FILE_NAME: String(id).padStart(3, '0') });
    return { id: Number(id), title: d.Title, content: d.Content, steps: parseScript(d.Content) };
  }

  async runScript(id) {
    this._lastAppAction = Date.now();
    await this.client.post('/api/v2/scripts/execute', { ID: Number(id) });
    this.noteScript(id);
    this._acted();
    return { ok: true };
  }

  // Merken, damit der gleich erkannte Bezug weiß, welches Skript lief; Titel und Schritte kommen nach (Zielkurve)
  noteScript(id, { title, steps } = {}) {
    const pending = { id: Number(id), at: Date.now(), title, steps };
    this._pendingScript = pending;
    if (steps) return;
    this.readScript(id).then((r) => { pending.title = title ?? (r.title || this.builtinScripts()[id] || null); pending.steps = r.steps; }).catch(() => {});
  }

  async stopScript() {
    // Backflush läuft über die Pumpensteuerung, nicht als Skript; „Stoppen“ beendet ihn trotzdem
    if (this._backflush) return { ...this.stopBackflush(), backflush: true };
    try {
      await this.client.get('/api/v2/scripts/stop');
      return { ok: true, stopped: true };
    } catch (e) {
      if (e.status === 500) return { ok: true, stopped: false };
      throw e;
    }
  }

  async saveScript({ id, name, steps, kind }) {
    if (!this.features.scriptEditor) throw httpError(403, 'Skript-Editor ist deaktiviert');
    if (!isScriptNameValid(name)) throw httpError(400, 'Name: nur Buchstaben, Ziffern, Leerzeichen, - _ # (max. 40 Zeichen)');
    const instruction = buildScript(steps);
    await this.writeScript({ id, name, instruction, kind });
    return { ok: true, instruction };
  }

  // Schreibt ein Skript ohne Prüfung der Funktions-Schalter (auch vom Grind-by-Sync-Vermittler genutzt).
  async writeScript({ id, name, instruction, kind }) {
    const body = { Edit: '', script_id: '', switch: '', script: kind === 'paddle' ? 'paddle' : 'none', name, instruction };
    const edit = id !== undefined && id !== null && id !== '';
    if (edit) {
      if (this.api.general) {
        // Neue Xenia: wie die Original-UI erst "scriptsedit" setzen, dann speichern.
        await this.client.post('/api/v2/scriptsedit', { SCRIPT_ID: Number(id) });
      }
      body.Edit = 'Enabled';
      body.script_id = Number(id);
      body.switch = null;
    } else if (!this.api.general) {
      body.script_id = null;
      body.Edit = 'Disabled';
    }
    try {
      await this.client.post('/api/v2/scripts/create', body);
    } catch (e) {
      if (e.status === 403) throw httpError(409, 'Kein Platz für weitere Skripte');
      if (e.status === 400) throw httpError(400, 'Skriptdaten ungültig');
      throw e;
    }
    return { ok: true, instruction };
  }

  async deleteScript(id) {
    if (!this.features.scriptEditor) throw httpError(403, 'Skript-Editor ist deaktiviert');
    id = Number(id);
    if (!(id > 9)) throw httpError(400, 'Eingebaute Skripte können nicht gelöscht werden');
    const n = String(id).padStart(3, '0');
    await this.client.post('/api/v2/scripts/delete', { scr_file_name: `${n}.S`, title_file_name: `${n}.T` });
    return { ok: true };
  }

  // Export wie die Original-UI: Datei "Xenia-<Titel>.script" mit {"<Titel>":"<Inhalt>"}.
  async exportScript(id) {
    try {
      const d = await this.client.post('/api/v2/scripts/iddownload', { ID: String(id).padStart(3, '0') });
      const title = Object.keys(d || {})[0];
      if (title) return { title, content: d[title], file: JSON.stringify({ [title]: d[title] }) };
    } catch { /* ältere Firmware: nur scripts/read */ }
    const r = await this.readScript(id);
    return { title: r.title, content: r.content, file: JSON.stringify({ [r.title]: r.content }) };
  }

  // Import einer .script-Datei. Der Inhalt wird geparst und neu aufgebaut, damit nur gültige Befehle die Maschine erreichen.
  async importScript(file, { name, kind } = {}) {
    let obj = file;
    if (typeof file === 'string') {
      try { obj = JSON.parse(file); } catch { throw httpError(400, 'Keine gültige .script-Datei'); }
    }
    const entries = obj && typeof obj === 'object' && !Array.isArray(obj) ? Object.entries(obj) : [];
    if (entries.length !== 1 || typeof entries[0][1] !== 'string') throw httpError(400, 'Keine gültige .script-Datei');
    const [title, content] = entries[0];
    const steps = parseScript(content);
    if (!steps.length) throw httpError(400, 'Die Datei enthält keine Skript-Schritte');
    const clean = String(name || title).replace(/[^A-Za-z0-9\-_# ]/g, '').trim().slice(0, 40) || 'Import';
    const k = kind === 'paddle' || (kind === undefined && /^paddle_/i.test(clean)) ? 'paddle' : 'standard';
    const r = await this.saveScript({ name: clean, steps, kind: k });
    return { ...r, name: clean, steps: steps.length };
  }

  async timezones() {
    if (!this.api.clock) throw httpError(409, 'Die alte Xenia hat keine Zeitzonenliste über die API');
    const [tz, info] = await Promise.all([this.client.get('/tz/tz.json'), this.client.get('/api/v2/info')]);
    const list = Object.entries(tz || {}).map(([index, e]) => ({ index: Number(index), name: Array.isArray(e) ? String(e[0]) : String(index) }));
    list.sort((a, b) => a.name.localeCompare(b.name));
    return { current: num(info.TZ_IND), list };
  }

  async switches() {
    const d = await this.client.get('/api/v2/switches');
    const keys = ['LEFT_LEFT', 'RIGHT_LEFT', 'RIGHT_RIGHT'];
    const out = { buttons: {}, singleDoseG: num(d.MA_BEVERAGE_WEIGHT_SGL_INT_SCALE), doubleDoseG: num(d.MA_BEVERAGE_WEIGHT_DBL_INT_SCALE) };
    for (const k of keys) out.buttons[k] = { short: num(d[`SWITCH_SET_${k}_0`]), long: num(d[`SWITCH_SET_${k}_1`]) };
    this.state.switches = out;
    return out;
  }

  // Dosis-Gewichte und optional die Tastenbelegung. Die Original-UI sendet SWITCH_SET_* nicht mehr,
  // die Firmware (4.226) übernimmt die Werte aber (live geprüft, 23.10.2026).
  async setSwitches({ singleDoseG, doubleDoseG, buttons }) {
    if (!this.features.settings) throw httpError(403, 'Einstellungen ändern ist deaktiviert');
    const cur = await this.client.get('/api/v2/switches');
    const classic = !this.api.general;
    const body = {};
    // Dosis-Gewichte: Die DBL-Oberfläche sendet sie nie (dort feste Mengen), also nur auf ausdrücklichen Wunsch
    if (!classic || singleDoseG !== undefined || doubleDoseG !== undefined) {
      const single = singleDoseG ?? cur.MA_BEVERAGE_WEIGHT_SGL_INT_SCALE;
      const double = doubleDoseG ?? cur.MA_BEVERAGE_WEIGHT_DBL_INT_SCALE;
      for (const v of [single, double]) if (!(Number(v) > 0 && Number(v) < 200)) throw httpError(400, 'Gewicht muss zwischen 1 und 199 g liegen');
      body.MA_BEVERAGE_WEIGHT_SGL_INT_SCALE = String(single);
      body.MA_BEVERAGE_WEIGHT_DBL_INT_SCALE = String(double);
    }
    if (buttons && typeof buttons === 'object') {
      const valid = new Set([0, ...Object.keys(this.builtinScripts()).map(Number), ...(await this.scripts()).map((s) => s.id)]);
      // Immer alle sechs Belegungen senden (wie die Schalter-Seite der Original-Oberfläche): Die DBL setzt
      // fehlende Felder auf „keine“, sonst löscht das Ändern von ③ die Belegung von ④ und umgekehrt.
      for (const key of ['LEFT_LEFT', 'RIGHT_LEFT', 'RIGHT_RIGHT']) {
        const b = buttons[key] || {};
        for (const [press, idx] of [['short', 0], ['long', 1]]) {
          const field = `SWITCH_SET_${key}_${idx}`;
          if (b[press] === undefined) {
            const keep = num(cur[field]);
            if (keep === null) throw httpError(502, `Die Maschine liefert ${field} nicht – nichts gespeichert`);
            body[field] = String(keep);
            continue;
          }
          const id = Number(b[press]);
          if (!Number.isInteger(id) || !valid.has(id)) throw httpError(400, `Unbekanntes Skript ${b[press]} für Taster ${key}`);
          body[field] = String(id);
        }
      }
    }
    if (!Object.keys(body).length) return { ok: true };
    const weights = 'MA_BEVERAGE_WEIGHT_SGL_INT_SCALE' in body;
    if (classic && weights) {
      // Die DBL setzt nicht gesendete Belegungen auf „keine“: immer alle sechs mitsenden
      for (const key of ['LEFT_LEFT', 'RIGHT_LEFT', 'RIGHT_RIGHT']) for (const idx of [0, 1]) {
        const field = `SWITCH_SET_${key}_${idx}`;
        if (field in body) continue;
        const keep = num(cur[field]);
        if (keep === null) throw httpError(502, `Die Maschine liefert ${field} nicht – nichts gespeichert`);
        body[field] = String(keep);
      }
    }
    await this.client.post('/api/v2/switches', body);
    if (classic && weights) {
      // Die Original-Oberfläche der DBL schreibt diese Werte nie: prüfen, ob die Firmware sie übernommen hat
      const after = await this.client.get('/api/v2/switches');
      const applied = Number(after.MA_BEVERAGE_WEIGHT_SGL_INT_SCALE) === Number(body.MA_BEVERAGE_WEIGHT_SGL_INT_SCALE)
        && Number(after.MA_BEVERAGE_WEIGHT_DBL_INT_SCALE) === Number(body.MA_BEVERAGE_WEIGHT_DBL_INT_SCALE);
      return { ok: true, applied, singleDoseG: num(after.MA_BEVERAGE_WEIGHT_SGL_INT_SCALE), doubleDoseG: num(after.MA_BEVERAGE_WEIGHT_DBL_INT_SCALE) };
    }
    return { ok: true, applied: true };
  }

  async timers() {
    if (!this.api.weeklyTimers && (await this.classicCaps().catch(() => ({}))).pages) return this._dblTimers();
    if (!this.api.weeklyTimers) {
      let eco = null, off = null, type = this.state.info?.type ?? null;
      try {
        const m = await this.client.get('/api/v2/machine');
        eco = num(m.MA_SET_TIMER_ECO_MA);
        off = num(m.MA_SET_TIMER_POWERDOWN);
        type = num(m.MA_TYPE);
      } catch { /* Eco/Aus-Timer sind auf mancher alten Firmware nicht lesbar */ }
      return {
        days: DAYS.map((day) => ({ day, on: null, off: null, brew: false, steam: false, enabled: false })),
        ecoAfterMin: eco, offAfterMin: off, machineType: type, clock: null, weekly: false,
      };
    }
    const d = await this.client.get('/api/v2/timer2');
    const days = DAYS.map((day) => {
      const on = timerToMinutes(d[`TI_${day}_ON1`]);
      const off = timerToMinutes(d[`TI_${day}_ON2`]);
      const boilers = num(d[`TI_${day}_ON1_BOILER`]) || 0;
      return { day, on, off, brew: Boolean(boilers & 1), steam: Boolean(boilers & 2), enabled: boilers !== 0 && on !== null };
    });
    return {
      days,
      ecoAfterMin: num(d.MA_SET_TIMER_ECO_MA),
      offAfterMin: num(d.MA_SET_TIMER_POWERDOWN),
      machineType: num(d.MA_TYPE),
      clock: clockToIso(d.MA_CLOCK, d.MA_CALENDAR),
      weekly: true,
    };
  }

  // Xenia DBL (Seiten-API): GET/POST /api/v2/timer. Je Tag zwei EINSCHALTzeiten (ON1, ON2) mit eigener
  // Kesselwahl (TI_<Tag>_ON<n>_BOILER: 1 Brühkessel, 2 Dampf, 3 beide); ausgeschaltet wird über den Abschalt-Timer.
  async _dblTimers() {
    const d = await this.client.get('/api/v2/timer');
    let m = {};
    try { m = await this.client.get('/api/v2/machine'); } catch { /* optional */ }
    const days = DAYS.map((day) => ({
      day,
      starts: [1, 2].map((n) => {
        const on = timerToMinutes(d[`TI_${day}_ON${n}`]);
        const boilers = num(d[`TI_${day}_ON${n}_BOILER`]) || 0;
        return { on, brew: Boolean(boilers & 1), steam: Boolean(boilers & 2), enabled: boilers !== 0 && on !== null };
      }),
    }));
    return {
      days, ecoAfterMin: num(m.MA_SET_TIMER_ECO_MA), offAfterMin: num(m.MA_SET_TIMER_POWERDOWN),
      machineType: num(d.MA_TYPE ?? m.MA_TYPE), clock: null, weekly: 'starts',
    };
  }

  async _saveDblTimers({ days, ecoAfterMin, offAfterMin }) {
    if (days !== undefined) {
      if (!Array.isArray(days) || days.length !== 7) throw httpError(400, '7 Tage erwartet');
      const msg = {};
      days.forEach((d, i) => {
        const key = DAYS[i];
        const starts = Array.isArray(d.starts) ? d.starts : [];
        [1, 2].forEach((n) => {
          const st = starts[n - 1] || {};
          const on = st.enabled && st.on !== null && st.on !== undefined ? Math.max(0, Math.min(1439, Math.round(Number(st.on)))) : null;
          if (st.enabled && (on === null || !Number.isFinite(on))) throw httpError(400, `${key}: Einschaltzeit ${n} fehlt`);
          msg[`TI_${key}_ON${n}_STATUS`] = on === null ? 0 : ((st.brew ? 1 : 0) | (st.steam ? 2 : 0)) || 1;
          msg[`TI_${key}_ON${n}`] = on === null ? 0 : on * 60;
        });
      });
      await this.client.post('/api/v2/timer', msg);
    }
    const ch = {};
    if (ecoAfterMin !== undefined && ecoAfterMin !== null) ch.MA_SET_TIMER_ECO_MA = Number(ecoAfterMin);
    if (offAfterMin !== undefined && offAfterMin !== null) ch.MA_SET_TIMER_POWERDOWN = Number(offAfterMin);
    if (Object.keys(ch).length) {
      const cur = await this.client.get('/api/v2/machine');
      const eco = ch.MA_SET_TIMER_ECO_MA ?? num(cur.MA_SET_TIMER_ECO_MA);
      const off = ch.MA_SET_TIMER_POWERDOWN ?? num(cur.MA_SET_TIMER_POWERDOWN);
      // wie die Original-Oberfläche: Abschalten muss später kommen als Eco
      if (eco !== null && off !== null && off <= eco) throw httpError(400, '„Ausschalten nach“ muss länger sein als „Eco-Modus nach“');
      await this._updateClassicPages(ch);
    }
    return { ok: true };
  }

  async saveTimers({ days, ecoAfterMin, offAfterMin }) {
    if (!this.features.settings) throw httpError(403, 'Einstellungen ändern ist deaktiviert');
    if (!this.api.weeklyTimers && (await this.classicCaps()).pages) return this._saveDblTimers({ days, ecoAfterMin, offAfterMin });
    if (!this.api.weeklyTimers) {
      const cur = await this.client.get('/api/v2/machine');
      await this.client.post('/api/v2/machine', {
        MA_HEATUP_FLUSH_EN: String(cur.MA_HEATUP_FLUSH_EN ?? 0),
        MA_SET_TIMER_ECO_MA: String(ecoAfterMin === undefined ? (cur.MA_SET_TIMER_ECO_MA ?? 0) : clampInt(ecoAfterMin, 0, 240)),
        MA_SET_TIMER_POWERDOWN: String(offAfterMin === undefined ? (cur.MA_SET_TIMER_POWERDOWN ?? 0) : clampInt(offAfterMin, 0, 240)),
        MA_FIX_WATER_SUPPLY: String(cur.MA_FIX_WATER_SUPPLY ?? 0),
        MA_MAX_AMPERE: String(cur.MA_MAX_AMPERE ?? 10),
      });
      return { ok: true };
    }
    if (!Array.isArray(days) || days.length !== 7) throw httpError(400, '7 Tage erwartet');
    const msg = {};
    days.forEach((d, i) => {
      const key = DAYS[i];
      const status = d.enabled ? (d.brew ? 1 : 0) | (d.steam ? 2 : 0) || 1 : 0;
      const toSec = (min) => (min === null || min === undefined ? 0 : Math.max(0, Math.min(1439, Math.round(min))) * 60);
      msg[`TI_${key}_ON1_STATUS`] = status;
      msg[`TI_${key}_ON2_STATUS`] = status;
      msg[`TI_${key}_ON1`] = toSec(d.on);
      msg[`TI_${key}_ON2`] = toSec(d.off);
    });
    if (ecoAfterMin !== undefined) msg.MA_SET_TIMER_ECO_MA = String(clampInt(ecoAfterMin, 0, 240));
    if (offAfterMin !== undefined) msg.MA_SET_TIMER_POWERDOWN = String(clampInt(offAfterMin, 0, 240));
    await this.client.post('/api/v2/timer2', msg);
    return { ok: true };
  }

  // Uhr stellen; mit tzIndex wird zugleich die Zeitzone gewählt (wie Seite „System“ der Original-UI).
  async syncClock(tzIndex) {
    if (!this.api.clock) throw httpError(409, 'Die alte Xenia hat keine API zum Stellen der Uhr');
    if (!this.features.clockSync) throw httpError(403, 'Uhrzeit stellen ist deaktiviert');
    const info = await this.client.get('/api/v2/info');
    const tz = await this.client.get('/tz/tz.json');
    const idx = tzIndex === undefined || tzIndex === null || tzIndex === '' ? String(info.TZ_IND) : String(clampInt(tzIndex, 0, 9999));
    const entry = tz[idx];
    if (!entry) throw httpError(409, 'Zeitzone der Maschine unbekannt – bitte einmal in der Original-Oberfläche wählen');
    await this.client.post('/api/v2/timer2/sync', {
      TZ_IND: idx, TZ_STR: entry[1], MA_TIMEZONE: entry[3], UTC_EPOCH: Math.floor(Date.now() / 1000),
    });
    this._slowAt = 0;
    return { ok: true, timezone: entry[0] };
  }

  // Paddle (direkte Pumpensteuerung) – nur auf ausdrücklichen Wunsch aus der App.
  async paddleState() {
    if (!this.hasPaddle) throw httpError(409, 'Paddle gibt es auf dieser Xenia nicht über die API');
    if (!this.features.paddle) throw httpError(403, 'Paddle ist deaktiviert');
    const d = await this.client.get('/api/v2/paddle/press');
    this._paddleUntil = Date.now() + 5000;
    return {
      status: num(d.MA_STATUS), pressure: round(num(d.PU_SENS_PRESS), 1),
      supplyValve: num(d.BB_SET_SUPPLY_VALVE) === 1, drainValve: num(d.BB_SET_SUPPLY_VALVE_2) === 1,
    };
  }

  async paddlePower(level) {
    if (!this.hasPaddle) throw httpError(409, 'Paddle gibt es auf dieser Xenia nicht über die API');
    if (!this.features.paddle) throw httpError(403, 'Paddle ist deaktiviert');
    const lv = clampInt(level, 0, 100);
    this._lastAppAction = Date.now();
    const d = await this.client.post('/api/v2/paddle/pumppower', { PU_SET_LEVEL_PW_CONTROL: lv });
    this.kick(200);
    return { ok: true, level: lv, supplyValve: num(d?.BB_SET_SUPPLY_VALVE) === 1, drainValve: num(d?.BB_SET_SUPPLY_VALVE_2) === 1 };
  }

  async paddleStop() {
    await this.client.get('/api/v2/paddle/stop');
    this.kick(200);
    return { ok: true };
  }

  // Backflush im Hintergrund starten: je Runde Druck aufbauen, halten, über paddle/stop entlasten.
  async runBackflush() {
    if (!this.hasPaddle) throw httpError(409, 'Backflush braucht die direkte Pumpensteuerung, diese Xenia hat sie nicht');
    if (!this.features.paddle) throw httpError(403, 'Backflush braucht die Paddle-Steuerung, sie ist deaktiviert');
    if (this._backflush) throw httpError(409, 'Backflush läuft schon');
    if (this.state.status !== 1) throw httpError(409, 'Maschine muss eingeschaltet und bereit sein');
    const run = { stop: false };
    this._backflush = run;
    this._backflushLoop(run)
      .catch((e) => {
        log.warn(`Backflush abgebrochen: ${e.message}`);
        this._event('shot', { title: 'Backflush abgebrochen', body: e.message, tag: 'backflush' });
      })
      .finally(() => {
        this._backflush = null;
        this.state.backflush = null;
        this.emit('state');
      });
    return { ok: true, cycles: BACKFLUSH.cycles };
  }

  stopBackflush() {
    if (this._backflush) this._backflush.stop = true;
    return { ok: true, stopped: Boolean(this._backflush) };
  }

  async _backflushLoop(run) {
    const { cycles, level, bar, holdMs, restMs, maxPumpMs } = BACKFLUSH;
    const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
    const pump = (lv) => this.client.post('/api/v2/paddle/pumppower', { PU_SET_LEVEL_PW_CONTROL: lv });
    const release = async () => {
      try { await pump(0); } catch { /* Maschine evtl. schon entlastet */ }
      try { await this.client.get('/api/v2/paddle/stop'); } catch { /* 500 = kein Paddle aktiv */ }
    };
    try {
      for (let cycle = 1; cycle <= cycles && !run.stop; cycle++) {
        this.state.backflush = { cycle, cycles };
        this._lastAppAction = Date.now();
        this.emit('state');
        const start = Date.now();
        let heldSince = null;
        while (!run.stop) {
          const p = num((await this.client.get('/api/v2/paddle/press')).PU_SENS_PRESS) ?? 0;
          if (p >= bar) heldSince ??= Date.now();
          if (heldSince && Date.now() - heldSince >= holdMs) break;
          if (!heldSince && Date.now() - start > maxPumpMs) throw new Error('Kein Druckaufbau – Blindsieb eingesetzt?');
          await pump(p >= bar ? 0 : level); // laufend senden, sonst bleibt die Pumpe stehen
        }
        await release();
        if (cycle < cycles && !run.stop) await sleep(restMs);
      }
    } finally {
      await release();
      this._acted();
    }
    if (run.stop) {
      this._event('shot', { title: 'Backflush gestoppt', body: 'Nicht als erledigt eingetragen.', tag: 'backflush' });
      return;
    }
    this.markBackflush();
    this._event('shot', { title: 'Backflush fertig', body: `${cycles} Runden, als erledigt eingetragen.`, tag: 'backflush' });
  }

  async details() {
    const out = {};
    const paths = [['machine', '/api/v2/machine'], ['network', '/api/v2/network']];
    if (this.api.info) paths.splice(1, 0, ['info', '/api/v2/info']);
    for (const [k, p] of paths) {
      try { out[k] = await this.client.get(p); } catch (e) { out[k] = { error: e.message }; }
    }
    // Seriennummer/MACs/SSID nicht vollständig an die App geben
    if (out.machine?.MA_SN) out.machine.MA_SN = '…' + String(out.machine.MA_SN).slice(-4);
    for (const k of ['WIFI_SOFT_AP_MAC', 'WIFI_AP_MAC']) if (out.network?.[k]) out.network[k] = '…' + String(out.network[k]).slice(-5);
    return out;
  }
}

function cleanBean(v) {
  const s = String(v ?? '').trim().replace(/[\u0000-\u001f]/g, '').slice(0, 60);
  if (!s) throw httpError(400, 'Bohne: Name fehlt');
  return s;
}
function cleanRoaster(v) {
  return String(v ?? '').trim().replace(/[\u0000-\u001f]/g, '').slice(0, 60);
}

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  e.expose = true;
  return e;
}

function clampInt(v, min, max) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) throw httpError(400, 'Zahl erwartet');
  return Math.min(max, Math.max(min, n));
}

function fmt(v, d = 1) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '–';
  return Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
}
