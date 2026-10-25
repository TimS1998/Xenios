// Xenia-Client: serielle Anfragen an den ESP32, Polling, Zustandsmodell, Ereignisse (für Push) und Bezugs-Historie.
// Läuft im Server (Node) und in der Android-App im Direkt-Modus (Browser): Speicher, Logger und fetch werden übergeben.
import { Emitter, MemoryStore } from './emitter.js';
import { logger } from './log.js';
import { dialIn, STRENGTH } from './shot-analysis.js';

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

// Grenzen wie in der offiziellen Web-Oberfläche (general.html).
export const SETTING_LIMITS = {
  BG_SET_TEMP: [60, 96], BG_SET_ECO_TEMP: [40, 95], BG_SET_TEMP_HYST: [2, 5],
  BB_SET_TEMP: [60, 96], BB_SET_ECO_TEMP: [40, 95], BB_SET_TEMP_HYST: [2, 5],
  PU_SET_MAX_TIMER: [30, 120],
  SB_SET_PRESS: [0, 1.8], SB_SET_ECO_PRESS: [0, 1], SB_SET_PRESS_HYST: [0.1, 0.3],
  MA_BOILER_START_MODE: [1, 2], MA_FAST_HEATUP_TYPE: [0, 1], MA_HEATUP_FLUSH_DURATION: [1, 20],
  MA_START_EXTRACTIONCOUNTER_EVENT: [0, 2],
};
export const SETTING_LABELS = {
  BG_SET_TEMP: 'Brühgruppe', BG_SET_ECO_TEMP: 'Brühgruppe Eco', BG_SET_TEMP_HYST: 'Hysterese Brühgruppe',
  BB_SET_TEMP: 'Brühkessel', BB_SET_ECO_TEMP: 'Brühkessel Eco', BB_SET_TEMP_HYST: 'Hysterese Brühkessel',
  PU_SET_MAX_TIMER: 'Max. Bezugszeit', SB_SET_PRESS: 'Dampfdruck', SB_SET_ECO_PRESS: 'Dampfdruck Eco', SB_SET_PRESS_HYST: 'Hysterese Dampf',
  MA_BOILER_START_MODE: 'Startmodus', MA_FAST_HEATUP_TYPE: 'Aufheiz-Spülung', MA_HEATUP_FLUSH_DURATION: 'Spüldauer',
  MA_START_EXTRACTIONCOUNTER_EVENT: 'Start Bezugszähler',
};
// Reihenfolge/Felder, die die offizielle Oberfläche beim Speichern sendet.
export const GENERAL_FIELDS = [
  'BB_SET_TEMP', 'BB_SET_ECO_TEMP', 'BB_SET_TEMP_HYST', 'BG_SET_TEMP', 'BG_SET_ECO_TEMP', 'BG_SET_TEMP_HYST',
  'PU_SET_MAX_TIMER', 'SB_SET_PRESS', 'SB_SET_ECO_PRESS', 'SB_SET_PRESS_HYST', 'MA_BOILER_START_MODE',
  'MA_FAST_HEATUP_TYPE', 'MA_HEATUP_FLUSH_DURATION', 'MA_START_EXTRACTIONCOUNTER_EVENT',
];

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
      const err = new Error(`Unbekannter Endpunkt ${apiPath}`);
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
    this._paddleUntil = 0;
    this._liveStarts = [];    // Startzeiten live erkannter Bezüge, die der Bezugszähler noch nicht mitgezählt hat
    this._lastDiag = null;
    this._repairHistory();
    this.state.lastShot = this.history.data.shots?.[0] || null;
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
    if (this.viewers > 0) return s.status && s.status !== 0 ? this.cfg.pollActiveMs : this.cfg.pollIdleMs;
    return s.status && s.status !== 0 ? Math.min(this.cfg.pollBackgroundMs, 5000) : this.cfg.pollBackgroundMs;
  }

  async _loop() {
    clearTimeout(this._timer);
    try {
      if (Date.now() >= this._slowAt) {
        await this.refreshSlow();
        this._slowAt = Date.now() + this.cfg.slowPollMs;
      }
      const d = await this.client.get('/api/v2/diagram/get');
      this._applyLive(d);
      this._markOnline();
    } catch (e) {
      this._markOffline(e);
    }
    if (this._stopped) return;
    this._timer = setTimeout(() => this._loop(), this._interval());
    this._timer.unref?.();
  }

  async refreshSlow() {
    const [single, general, overview] = [
      await this.client.get('/api/v2/overview_single'),
      await this.client.get('/api/v2/general'),
      await this.client.get('/api/v2/overview'),
    ];
    this._applySlow(single, general, overview);
    if (!this.state.info) {
      try {
        const [machine, info] = [await this.client.get('/api/v2/machine'), await this.client.get('/api/v2/info')];
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
        };
      } catch (e) {
        log.debug(`Info nicht lesbar: ${e.message}`);
      }
    }
    try {
      const i = await this.client.get('/api/v2/info');
      const iso = clockToIso(i.MA_CLOCK, i.MA_CALENDAR);
      this.state.clock = { machine: iso, readAt: new Date().toISOString(), tzIndex: i.TZ_IND };
    } catch { /* optional */ }
  }

  _applySlow(single, general, overview) {
    const s = this.state;
    this._offsets = { bg: num(general.BG_TEMPERATURE_OFFSET) || 0, bb: num(general.BB_TEMPERATURE_OFFSET) || 0 };
    s.settings = {};
    for (const k of [...GENERAL_FIELDS, 'BB_FILL_LEVEL', 'MA_FIX_WATER_SUPPLY', 'VIEW']) s.settings[k] = num(general[k]);
    s.temp.groupSet = num(single.BG_SET_TEMP ?? general.BG_SET_TEMP);
    s.temp.boilerSet = num(single.BB_SET_TEMP ?? general.BB_SET_TEMP);
    s.pressure.steamSet = num(single.SB_SET_PRESS ?? general.SB_SET_PRESS);
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
    s.steamOn = num(d.SB_STATUS) === 2;
    s.temp.groupRaw = num(d.BG_SENS_TEMP_A);
    s.temp.boilerRaw = num(d.BB_SENS_TEMP_A);
    s.temp.group = this._temp(s.temp.groupRaw, this._offsets.bg);
    s.temp.boiler = this._temp(s.temp.boilerRaw, this._offsets.bb);
    s.pressure.pump = round(num(d.PU_SENS_PRESS), 1);
    s.pressure.steam = round(num(d.SB_SENS_PRESS), 2);
    s.power = { group: num(d.BG_LEVEL_PW_CONTROL), boiler: num(d.BB_LEVEL_PW_CONTROL), pump: num(d.PU_LEVEL_PW_CONTROL) };
    s.scale = { weight: round(num(d.PU_LOADCELL_VOLUME), 1), rate: round(num(d.PU_LOADCELL_RATE), 1) };
    s.flow = { volume: round(num(d.PU_SENS_FLOW_METER_VOLUME), 1), rate: round(num(d.PU_SENS_FLOW_METER_FLOWRATE), 1), ml: round(num(d.PU_SENS_FLOW_METER_ML), 1) };
    const extractionMs = num(d.EXTRACTION_TIME_MS) || 0;

    // Bezug erkennen (Status 3)
    if (status === 3) {
      if (!s.shot.running) {
        this._liveStarts.push(Date.now());
        s.shot = { running: true, timeMs: 0, startedAt: new Date().toISOString(), curve: [] };
        // Hat die App kurz vorher ein Skript gestartet, gehört es zu diesem Bezug (für die Zielkurve in der Analyse)
        const p = this._pendingScript;
        if (p && Date.now() - p.at < 20e3) s.shot.script = { id: p.id, title: p.title ?? BUILTIN_SCRIPTS[p.id] ?? null, steps: p.steps ?? null };
        this._pendingScript = null;
        this.kick(this.cfg.pollActiveMs);
      }
      s.shot.timeMs = extractionMs;
      if (s.shot.curve.length < 600) {
        s.shot.curve.push([round(extractionMs / 1000, 1), s.pressure.pump, s.scale.weight, s.flow.ml]);
      }
    } else if (s.shot.running) {
      this._finishShot(extractionMs);
    }

    // Aufgeheizt (einmal pro Einschaltvorgang)
    const on = status === 1 || status === 3 || status === 4;
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
    if (status === 6 && prevStatus !== 6) this._event('fault', { title: 'Xenia meldet eine Störung', body: 'Bitte die Maschine prüfen.', tag: 'fault' });
    if (prevStatus !== status) this.kick(this.cfg.pollActiveMs);
    this.emit('state');
  }

  _finishShot(finalMs) {
    const s = this.state;
    const timeMs = Math.max(finalMs || 0, s.shot.timeMs || 0);
    const curve = s.shot.curve;
    const maxPressure = curve.reduce((m, p) => Math.max(m, p[1] || 0), 0);
    const shot = {
      id: shotId(),
      endedAt: new Date().toISOString(),
      startedAt: s.shot.startedAt,
      timeMs,
      weight: s.scale.weight || null,
      volumeMl: s.flow.ml || s.flow.volume || null,
      maxPressure: round(maxPressure, 1),
      groupTemp: s.temp.group,
      curve: curve.slice(0, 300),
      ...(s.shot.script ? { script: s.shot.script } : {}),
    };
    s.shot = { running: false, timeMs: 0, startedAt: null, curve: [] };
    s.lastShot = shot;
    if (timeMs >= 3000) {
      shot.no = (s.counters?.extractions ?? null) !== null ? s.counters.extractions + this._liveStarts.length : null;
      this._log(shot);
      const parts = [`${fmt(timeMs / 1000)} s`];
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

  snapshot() {
    return { ...this.state, shot: { ...this.state.shot, curve: this.state.shot.curve.slice(-120) } };
  }

  // Bezugs-Protokoll: bis zu 2000 Einträge, Druckkurven nur für die neuesten 100 (Speicherplatz)
  _log(shot) {
    const h = this.history.data;
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
    const diag = this._lastDiag || {};
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
      if (i === 0) this.state.lastShot = shot;
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
  shots(limit = 30, { curves = limit } = {}) {
    return this.history.data.shots.slice(0, limit).map((s, i) => (i < curves ? s : { ...s, curve: undefined }));
  }

  shotsCsv() {
    const cell = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
    const text = (v) => (v ? `"${String(v).replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"` : '');
    const rows = [['Nr', 'Ende', 'Dauer (s)', 'Gewicht (g)', 'Menge (ml)', 'Max. Druck (bar)', 'Brühgruppe (°C)', 'Live erfasst',
      'Dosis (g)', 'Verhältnis 1:', 'Rezept Mühle', 'Skript', 'Bohne', 'Mahlgrad', 'Bewertung', 'Geschmack', 'Stärke', 'Notiz']];
    for (const s of this.history.data.shots) {
      const n = s.notes || {};
      const yieldG = n.yieldG ?? s.weight;
      const ratio = s.dose?.g && yieldG ? Math.round((yieldG / s.dose.g) * 10) / 10 : null;
      rows.push([s.no ?? '', s.endedAt, cell(s.timeMs ? Math.round(s.timeMs / 100) / 10 : null), cell(s.weight), cell(s.volumeMl), cell(s.maxPressure), cell(s.groupTemp), s.estimated ? 'nein' : 'ja',
        cell(s.dose?.g), cell(ratio), s.dose?.recipe ?? '', text(s.script?.title), text(n.bean), text(n.grind), n.rating ?? '', TASTE[n.taste] ?? '', STRENGTH[n.strength] ?? '', text(n.text)]);
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

  _acted() {
    this._lastAppAction = Date.now();
    setTimeout(() => this.kick(), 300);
  }

  // mode: 'on' | 'off' | 'eco'; steam: true/false/undefined (= nach Startmodus)
  async power(mode, steam) {
    const action = { off: '0', on: '1', eco: '2' }[mode];
    if (action === undefined) throw new Error('Ungültiger Modus');
    this._lastAppAction = Date.now();
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
    await this.client.post('/api/v2/toggle/sb', { TOGGLE: on ? 1 : 0 });
    this._acted();
    return { ok: true };
  }

  // Ändert Werte über POST /api/v2/general: aktuelle Werte lesen, ändern, alle Felder senden (wie die Original-UI).
  async updateSettings(changes) {
    if (!this.features.settings) throw httpError(403, 'Einstellungen ändern ist deaktiviert');
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
    this._slowAt = 0;
    this._acted();
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
    const d = await this.client.get('/api/v2/scriptslist');
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
    this.readScript(id).then((r) => { pending.title = title ?? (r.title || BUILTIN_SCRIPTS[id] || null); pending.steps = r.steps; }).catch(() => {});
  }

  async stopScript() {
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
    if (id !== undefined && id !== null && id !== '') {
      // Bearbeiten: wie die Original-UI erst "scriptsedit" setzen, dann speichern.
      await this.client.post('/api/v2/scriptsedit', { SCRIPT_ID: Number(id) });
      body.Edit = 'Enabled';
      body.script_id = Number(id);
      body.switch = null;
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
    const d = await this.client.post('/api/v2/scripts/iddownload', { ID: String(id).padStart(3, '0') });
    const title = Object.keys(d || {})[0];
    if (!title) throw httpError(404, 'Skript nicht gefunden');
    return { title, content: d[title], file: JSON.stringify({ [title]: d[title] }) };
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
    const single = singleDoseG ?? cur.MA_BEVERAGE_WEIGHT_SGL_INT_SCALE;
    const double = doubleDoseG ?? cur.MA_BEVERAGE_WEIGHT_DBL_INT_SCALE;
    for (const v of [single, double]) if (!(Number(v) > 0 && Number(v) < 200)) throw httpError(400, 'Gewicht muss zwischen 1 und 199 g liegen');
    const body = { MA_BEVERAGE_WEIGHT_SGL_INT_SCALE: String(single), MA_BEVERAGE_WEIGHT_DBL_INT_SCALE: String(double) };
    if (buttons && typeof buttons === 'object') {
      const valid = new Set([0, ...Object.keys(BUILTIN_SCRIPTS).map(Number), ...(await this.scripts()).map((s) => s.id)]);
      for (const key of ['LEFT_LEFT', 'RIGHT_LEFT', 'RIGHT_RIGHT']) {
        const b = buttons[key];
        if (!b) continue;
        for (const [press, idx] of [['short', 0], ['long', 1]]) {
          if (b[press] === undefined) continue;
          const id = Number(b[press]);
          if (!Number.isInteger(id) || !valid.has(id)) throw httpError(400, `Unbekanntes Skript ${b[press]} für Taster ${key}`);
          body[`SWITCH_SET_${key}_${idx}`] = String(id);
        }
      }
    }
    await this.client.post('/api/v2/switches', body);
    return { ok: true };
  }

  async timers() {
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
    };
  }

  async saveTimers({ days, ecoAfterMin, offAfterMin }) {
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
    if (!this.features.paddle) throw httpError(403, 'Paddle ist deaktiviert');
    const d = await this.client.get('/api/v2/paddle/press');
    this._paddleUntil = Date.now() + 5000;
    return {
      status: num(d.MA_STATUS), pressure: round(num(d.PU_SENS_PRESS), 1),
      supplyValve: num(d.BB_SET_SUPPLY_VALVE) === 1, drainValve: num(d.BB_SET_SUPPLY_VALVE_2) === 1,
    };
  }

  async paddlePower(level) {
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

  async details() {
    const out = {};
    for (const [k, p] of [['machine', '/api/v2/machine'], ['info', '/api/v2/info'], ['network', '/api/v2/network']]) {
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
