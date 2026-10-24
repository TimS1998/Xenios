// Mahlkönig E64 WS (Hemro HSG Web-Interface): Login mit Sitzung, Auslesen von Datenbank/Logs, Statistiken.
// Läuft im Server und in der Android-App (Direkt-Modus); der HTTPS-Transport wird übergeben.
import { Emitter } from './emitter.js';
import { openSqlite } from './sqlite-read.js';
import { logger } from './log.js';

let log = logger('muehle');

// opts: { http: Transport mit request(method, path, {form, body, headers, binary}) → {status, headers, buffer, text}
//         und cookies.clear(); inflateRaw: (Uint8Array) → Promise<Uint8Array>; log }
export class Grinder extends Emitter {
  constructor(cfg, opts = {}) {
    super();
    this.cfg = cfg.grinder;
    this.http = opts.http;
    this.inflateRaw = opts.inflateRaw || inflateRawWeb;
    if (opts.log) log = opts.log;
    this.viewers = 0;
    this.loggedIn = false;
    this.loginBlockedUntil = 0;
    this.state = {
      enabled: Boolean(this.cfg.enabled),
      configured: Boolean(this.cfg.password),
      online: false, error: null, lastSeen: null, lastSync: null,
      info: null, wifi: null,
      recipes: [], grinds: [], brews: [], alerts: [], stats: null, settings: null,
    };
    this._lastGrindId = null;
    this._knownAlerts = new Set();
    this._timer = null;
    this._chain = Promise.resolve();
  }

  start() {
    if (!this.cfg.enabled) return;
    this._loop();
  }

  stop() {
    this._stopped = true;
    clearTimeout(this._timer);
    this.http.close?.();
  }

  setViewers(n) {
    const wake = n > 0 && this.viewers === 0;
    this.viewers = n;
    if (wake && Date.now() - Date.parse(this.state.lastSync || 0) > 60e3) this.kick();
  }

  kick(delay = 0) {
    if (this._stopped) return;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._loop(), delay);
    this._timer.unref?.();
  }

  _serial(fn) {
    const p = this._chain.then(fn, fn);
    this._chain = p.catch(() => {});
    return p;
  }

  async _loop() {
    clearTimeout(this._timer);
    try {
      await this.sync();
    } catch (e) {
      this._offline(e);
    }
    // Mit offener App alle 2 min, sonst alle 10 min (schont den Flash-Speicher der Mühle)
    const ms = this.viewers > 0 ? Math.max(this.cfg.pollMs, 30e3) * 4 : 10 * 60e3;
    if (this._stopped) return;
    this._timer = setTimeout(() => this._loop(), ms);
    this._timer.unref?.();
  }

  async login() {
    if (!this.cfg.password) throw Object.assign(new Error('Kein Mühlen-Passwort in der Konfiguration'), { status: 409 });
    if (Date.now() < this.loginBlockedUntil) throw Object.assign(new Error('Login bei der Mühle pausiert (zu viele Fehlversuche)'), { status: 429 });
    this.http.cookies.clear();
    await this.http.request('GET', '/login.php');
    const res = await this.http.request('POST', '/login.php', { form: { userRole: 'Owner', password: this.cfg.password, login: '' } });
    const check = await this.http.request('POST', '/rest_api/check_session');
    if (check.text.trim() !== 'session_valid') {
      this.loggedIn = false;
      this.loginBlockedUntil = Date.now() + 5 * 60e3;
      throw Object.assign(new Error(`Login bei der Mühle fehlgeschlagen (HTTP ${res.status}) – Passwort prüfen`), { status: 502 });
    }
    this.loggedIn = true;
    log.info('Bei der Mühle angemeldet');
  }

  async _authed(method, path, opts) {
    if (!this.loggedIn) await this.login();
    let res = await this.http.request(method, path, opts);
    if (res.status === 400 && /Access denied/i.test(new TextDecoder().decode(res.buffer.subarray(0, 200)))) {
      this.loggedIn = false;
      await this.login();
      res = await this.http.request(method, path, opts);
    }
    return res;
  }

  async restJson(cmd, { authed = true, method = 'POST' } = {}) {
    const res = authed ? await this._authed(method, `/rest_api/${cmd}`) : await this.http.request(method, `/rest_api/${cmd}`);
    try {
      return JSON.parse(res.text);
    } catch {
      throw new Error(`Unerwartete Antwort der Mühle auf ${cmd}`);
    }
  }

  async downloadDatabase() {
    const res = await this._authed('GET', '/rest_api/download_database', { binary: true });
    if (res.status !== 200 || !String(res.headers['content-type']).includes('octet-stream')) throw new Error(`Datenbank-Download fehlgeschlagen (HTTP ${res.status})`);
    return { buffer: res.buffer, filename: filenameFrom(res.headers) || 'grinder.db' };
  }

  async downloadLogs() {
    const res = await this._authed('GET', '/rest_api/download_machine_logs', { binary: true });
    if (res.status !== 200 || !String(res.headers['content-type']).includes('octet-stream')) throw new Error(`Log-Download fehlgeschlagen (HTTP ${res.status})`);
    return { buffer: res.buffer, filename: filenameFrom(res.headers) || 'machineLogs.zip', files: await unzip(res.buffer, this.inflateRaw) };
  }

  sync() {
    return this._serial(async () => {
      if (!this.state.info) {
        const info = await this.restJson('get_machine_info', { authed: false });
        this.state.info = { type: info.grinderType, typeName: info.grinderTypeName };
      }
      if (!this.cfg.password) {
        this.state.online = true;
        this.state.lastSeen = new Date().toISOString();
        this.state.error = 'Kein Mühlen-Passwort konfiguriert – nur Basisdaten verfügbar.';
        this.emit('state');
        return;
      }
      const wifi = await this.restJson('get_wifi_info');
      if (wifi.success) {
        const d = wifi.data || {};
        this.state.wifi = { hostname: d.hostname, mode: d.mode, ip: d.staIp || d.apIp };
      }
      const { buffer } = await this.downloadDatabase();
      this._applyDatabase(buffer);
      this.state.online = true;
      this.state.error = null;
      this.state.lastSeen = this.state.lastSync = new Date().toISOString();
      this.emit('state');
    });
  }

  _applyDatabase(buffer) {
    const db = openSqlite(buffer);
    const byId = (table, id, name) => Object.fromEntries(db.rows(table).map((r) => [r[id], r[name]]));
    const modes = byId('recipe_modes', 'recipe_mode_id', 'recipe_mode_name');
    const types = byId('recipe_types', 'recipe_type_id', 'recipe_type_name');
    const icons = byId('recipe_icons', 'recipe_icon_id', 'recipe_icon_name');
    const triggers = byId('grind_trigger_modes', 'grind_trigger_id', 'grind_trigger_name');
    const alertTypes = byId('alert_types', 'alert_type_id', 'alert_type_name');
    const data = Object.fromEntries(db.rows('recipe_data').map((r) => [r.recipe_data_id, r]));
    const settings = Object.fromEntries(db.rows('settings').map((r) => [r.key, r.value]));
    const selected = Number(settings['Grinding.SelectedRecipeIndex']) || null;

    this.state.recipes = db.rows('recipe_entries').map((e) => {
      const d = data[e.recipe_data_id] || {};
      return {
        index: e.recipe_index,
        active: e.recipe_active === 1,
        selected: e.recipe_index === selected,
        gbs: Boolean(e.recipe_gbs_data),
        mode: modes[d.recipe_mode_id] || null,
        type: types[d.recipe_type_id] || null,
        icon: icons[d.recipe_icon_id] || null,
        amount: d.recipe_amount ?? null,              // GbW: mg, GbT: ms
        coarseness: d.recipe_coarseness ?? null,
        brewTimeMs: d.recipe_brew_time ?? null,
        brewWeightG: d.recipe_brew_weight ? d.recipe_brew_weight / 1000 : null,
      };
    });

    const grinds = db.rows('grind_log').map((g) => {
      const d = data[g.recipe_data_id] || {};
      return {
        id: g.grind_id,
        at: g.grind_date_time,
        recipe: g.recipe_index,
        mode: modes[d.recipe_mode_id] || null,
        type: types[d.recipe_type_id] || null,
        targetG: d.recipe_mode_id === 2 && d.recipe_amount ? d.recipe_amount / 1000 : null,
        weightG: g.grind_weight ? g.grind_weight / 1000 : null,
        durationMs: g.grind_duration,
        ddd: g.grind_ddd,
        success: g.grind_successfull === 1,
        trigger: triggers[g.grind_trigger_id] || String(g.grind_trigger_id),
        gbs: g.recipe_gbs_enabled === 1,
      };
    });
    grinds.sort((a, b) => b.id - a.id);
    this.state.grinds = grinds.slice(0, 50);

    const grindById = Object.fromEntries(grinds.map((g) => [g.id, g]));
    this.state.brews = db.rows('brew_events').map((b) => ({
      id: b.brew_id,
      grindId: b.grind_id,
      at: grindById[b.grind_id]?.at || null,
      durationMs: b.brew_duration,
      massG: b.brew_mass ? b.brew_mass / 1000 : null,
      valid: b.brew_validity === 1,
      group: b.brew_group,
    })).sort((a, b) => b.id - a.id).slice(0, 30);

    const alerts = db.rows('alert_log');
    const cleared = new Set(alerts.filter((a) => a.alert_active === 0 && a.alert_related_id).map((a) => a.alert_related_id));
    this.state.alerts = alerts
      .filter((a) => a.alert_active === 1)
      .map((a) => ({ id: a.alert_id, type: alertTypes[a.alert_type_id] || `Alarm ${a.alert_type_id}`, at: a.alert_date_time, active: !cleared.has(a.alert_id) }))
      .sort((a, b) => b.id - a.id)
      .slice(0, 20);

    // Statistik
    const today = new Date().toISOString().slice(0, 10);
    const ok = grinds.filter((g) => g.success && g.weightG);
    const todayGrinds = ok.filter((g) => String(g.at).startsWith(today));
    const last = grinds[0] || null;
    const byWeight = ok.filter((g) => g.targetG);
    const dev = byWeight.length ? byWeight.slice(0, 30).reduce((s, g) => s + Math.abs(g.weightG - g.targetG), 0) / Math.min(30, byWeight.length) : null;
    this.state.stats = {
      totalGrinds: grinds.length,
      successful: ok.length,
      totalCoffeeG: Math.round(ok.reduce((s, g) => s + g.weightG, 0)),
      today: todayGrinds.length,
      todayCoffeeG: Math.round(todayGrinds.reduce((s, g) => s + g.weightG, 0) * 10) / 10,
      avgDeviationG: dev === null ? null : Math.round(dev * 100) / 100,
      lastGrind: last,
    };
    // Nur unkritische Einstellungen weitergeben (die DB enthält u. a. das WLAN-Passwort!)
    let m2m = null;
    try { m2m = JSON.parse(settings['M2m.CoffeeMachinesConfig'] || 'null'); } catch { /* ignorieren */ }
    this.state.settings = {
      welcomeName: settings['System.WelcomeName'] || null,
      language: settings['System.Language'] || null,
      timezone: settings.timezoneId || null,
      selectedRecipe: selected,
      ledInStandby: settings['Standby.LedEnabled'] === 'true',
      cloud: settings['Cloud.ConnectionEnabled'] === 'true',
      lastGbwCalibration: settings['Gbw.LastGbwCalibrationDate'] || null,
      coffeeMachine: m2m ? { manufacturer: m2m.manufacturer, host: m2m[m2m.activeCm]?.host, pollIntervalMs: m2m[m2m.activeCm]?.pollInterval } : null,
    };

    // Ereignisse
    if (last && this._lastGrindId !== null && last.id > this._lastGrindId) {
      const g = last;
      const txt = g.success && g.weightG ? `${fmt(g.weightG)} g in ${fmt(g.durationMs / 1000)} s${g.targetG ? ` (Ziel ${fmt(g.targetG)} g)` : ''}` : 'Mahlvorgang abgebrochen';
      this.emit('event', { topic: 'grinder', title: 'Mühle: gemahlen', body: txt, tag: 'grind', silent: true });
    }
    this._lastGrindId = last ? last.id : 0;
    const relevant = /Hopper|Fan|Agsa|Disc|Loadcell|LoadCell|Ddd|Ntc|Unreliable/;
    for (const a of this.state.alerts.filter((x) => x.active)) {
      if (!this._knownAlerts.has(a.id)) {
        if (this._knownAlertsReady && relevant.test(a.type)) {
          this.emit('event', { topic: 'grinder', title: 'Mühle meldet', body: alertText(a.type), tag: `galert-${a.id}` });
        }
        this._knownAlerts.add(a.id);
      }
    }
    this._knownAlertsReady = true;
  }

  _offline(e) {
    if (this.state.online) log.warn(`Mühle nicht erreichbar: ${e.message}`);
    this.state.online = false;
    this.state.error = e.message;
    this.loggedIn = false;
    this.emit('state');
  }

  snapshot() {
    return { ...this.state, grinds: this.state.grinds.slice(0, 20) };
  }
}

export const ALERT_TEXT = {
  HopperNotMounted: 'Bohnenbehälter nicht aufgesetzt',
  FanFailure: 'Lüfterfehler', Fan1Failure: 'Lüfter 1 defekt', Fan2Failure: 'Lüfter 2 defekt',
  AgsaBlockage: 'Mahlscheiben blockiert', AgsaBlockagePrediction: 'Blockade der Mahlgradverstellung droht',
  AgsaTimeout: 'Mahlgradverstellung: Zeitüberschreitung', AgsaOvercurrent: 'Mahlgradverstellung: Überstrom',
  AgsaBlockedByHopper: 'Mahlgradverstellung durch Behälter blockiert', AgsaLimitLowerHit: 'Untere Mahlgrad-Grenze erreicht',
  DiscCalibrationMissing: 'Mahlscheiben nicht kalibriert', LoadcellCalibrationMissing: 'Waage nicht kalibriert',
  LoadCellCalibrationReminder: 'Waage bitte neu kalibrieren', LoadCellDisabled: 'Waage deaktiviert',
  UnreliableGbwOperation: 'Grind-by-Weight unzuverlässig', InternetConnectionFailed: 'Keine Internetverbindung',
  WifiConnectionFailed: 'WLAN-Verbindung fehlgeschlagen', NewFirmwareUpdateAvailable: 'Neue Firmware verfügbar',
  BrewEventIgnoredForGbs: 'Bezug für Grind-by-Sync ignoriert', FastPortafilterSwapDetected: 'Siebträger zu schnell gewechselt',
};
const alertText = (t) => ALERT_TEXT[t] || t;

function filenameFrom(headers) {
  const m = /filename="?([^";]+)"?/.exec(headers['content-disposition'] || '');
  return m ? m[1].replace(/[^\w.\-]/g, '_') : null;
}

// Einfacher ZIP-Leser (lokale Dateiköpfe, Methode 0/8).
export async function unzip(buf, inflateRaw = inflateRawWeb) {
  const files = {};
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let p = 0;
  while (p + 30 <= u8.length && dv.getUint32(p, true) === 0x04034b50) {
    const method = dv.getUint16(p + 8, true);
    const flags = dv.getUint16(p + 6, true);
    const csize = dv.getUint32(p + 18, true);
    const nlen = dv.getUint16(p + 26, true);
    const xlen = dv.getUint16(p + 28, true);
    const name = new TextDecoder().decode(u8.subarray(p + 30, p + 30 + nlen));
    const start = p + 30 + nlen + xlen;
    if (flags & 0x08 && csize === 0) break; // Data-Descriptor ohne Größe: nicht unterstützt
    const data = u8.subarray(start, start + csize);
    files[name] = method === 8 ? await inflateRaw(data) : data.slice();
    p = start + csize;
  }
  return files;
}

// Entpacken im Browser (WebView): DecompressionStream
async function inflateRawWeb(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function fmt(v, d = 1) {
  return Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
}
