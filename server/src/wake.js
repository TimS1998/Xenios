// Wecker-Automatik: Die Android-App meldet den nächsten Wecker ihres Handys; der Server schaltet die Maschine
// eine einstellbare Zeit vor dem frühesten (berücksichtigten) Wecker ein.
import path from 'node:path';
import { JsonStore } from './store.js';
import { logger } from './log.js';
import { httpError } from './machine.js';

const log = logger('wecker');
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const p2 = (n) => String(n).padStart(2, '0');
// Schlummern meldet Android als neuen Wecker kurz nach dem alten: so lange gilt er als derselbe Wecker.
const SNOOZE_MS = 2 * 3600e3;

export const WAKE_DEFAULTS = {
  enabled: false,
  leadMin: 15,          // so viele Minuten vor dem Wecker einschalten
  steam: null,          // true/false: Dampfkessel mit an/aus; null = wie Startmodus der Maschine
  from: '03:00',        // nur Wecker in diesem Zeitfenster zählen (keine Mittagsschlaf-Wecker)
  to: '11:00',
  days: [0, 1, 2, 3, 4, 5, 6], // Montag = 0
};

export class Wake {
  constructor(cfg, machine, { onEvent } = {}) {
    this.machine = machine;
    this.onEvent = onEvent || (() => {});
    this.store = new JsonStore(path.join(cfg.dataDir, 'wake.json'), { config: { ...WAKE_DEFAULTS }, devices: {}, fired: null });
    this.store.data.config = { ...WAKE_DEFAULTS, ...this.store.data.config };
    this.timer = null;
  }

  // Meldung eines Handys. id = Sitzungs-ID (gekürzt), next = Zeitpunkt in ms oder null (kein Wecker gestellt).
  report(id, name, next) {
    if (next !== null && !(Number.isFinite(next) && next > 0)) throw httpError(400, 'next: Zeitpunkt in ms oder null');
    const devices = this.store.data.devices;
    const prev = devices[id];
    devices[id] = { name: String(name || 'Handy').slice(0, 60), next: next ?? null, updated: Date.now(), enabled: prev ? prev.enabled : true };
    // höchstens 20 Geräte, älteste Meldungen fliegen raus
    const ids = Object.keys(devices).sort((a, b) => devices[b].updated - devices[a].updated);
    for (const old of ids.slice(20)) delete devices[old];
    this.store.save();
    return this.plan();
  }

  setConfig(config = {}, deviceToggles = {}) {
    const c = { ...this.store.data.config };
    if ('enabled' in config) c.enabled = Boolean(config.enabled);
    if ('leadMin' in config) {
      const n = Math.round(Number(config.leadMin));
      if (!(n >= 1 && n <= 120)) throw httpError(400, 'Vorlauf: 1 bis 120 Minuten');
      c.leadMin = n;
    }
    if ('steam' in config) c.steam = typeof config.steam === 'boolean' ? config.steam : null;
    for (const k of ['from', 'to']) {
      if (k in config) {
        if (!HHMM.test(String(config[k]))) throw httpError(400, `${k}: Uhrzeit HH:MM erwartet`);
        c[k] = String(config[k]);
      }
    }
    if ('days' in config) {
      const days = [...new Set((Array.isArray(config.days) ? config.days : []).map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
      c.days = days;
    }
    this.store.data.config = c;
    for (const [id, on] of Object.entries(deviceToggles || {})) {
      if (this.store.data.devices[id]) this.store.data.devices[id].enabled = Boolean(on);
    }
    this.store.save(0);
    return this.state();
  }

  removeDevice(id) {
    delete this.store.data.devices[id];
    this.store.save(0);
    return this.state();
  }

  // Zählt ein Wecker nach Tag und Zeitfenster?
  _counts(at) {
    const c = this.store.data.config;
    const d = new Date(at);
    const day = (d.getDay() + 6) % 7;
    if (!c.days.includes(day)) return false;
    const m = d.getHours() * 60 + d.getMinutes();
    const from = minutesOf(c.from);
    const to = minutesOf(c.to);
    return from <= to ? m >= from && m <= to : m >= from || m <= to; // Fenster über Mitternacht erlaubt
  }

  // Frühester berücksichtigter Wecker in der Zukunft und der Einschaltzeitpunkt dazu.
  plan(now = Date.now()) {
    const c = this.store.data.config;
    let best = null;
    for (const [id, dev] of Object.entries(this.store.data.devices)) {
      if (!dev.enabled || !dev.next || dev.next <= now) continue;
      if (!this._counts(dev.next)) continue;
      if (!best || dev.next < best.alarm) best = { alarm: dev.next, device: dev.name, id };
    }
    if (!best) return null;
    return { ...best, at: best.alarm - c.leadMin * 60e3 };
  }

  state() {
    return {
      config: this.store.data.config,
      devices: Object.entries(this.store.data.devices).map(([id, d]) => ({ id, ...d })),
      plan: this.store.data.config.enabled ? this.plan() : null,
    };
  }

  start() {
    this.stop();
    this.timer = setInterval(() => this.tick().catch((e) => log.warn(e.message)), 15000);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  // Einschalten, sobald der Vorlauf vor dem Wecker erreicht ist (auch wenn der Wecker kurzfristig gestellt wurde).
  async tick(now = Date.now()) {
    if (!this.store.data.config.enabled) return;
    const p = this.plan(now);
    if (!p || now < p.at) return;
    // Schon für diesen Wecker eingeschaltet (auch geschlummert)? Dann nicht erneut, auch wenn inzwischen jemand ausgeschaltet hat.
    const f = this.store.data.fired;
    if (f && f.id === p.id && p.alarm >= f.alarm && p.alarm - f.alarm < SNOOZE_MS) return;
    const m = this.machine.snapshot();
    if (!m.online) return; // nächster Versuch in 15 s
    const alarm = new Date(p.alarm);
    const when = `${p2(alarm.getHours())}:${p2(alarm.getMinutes())}`;
    try {
      if (m.statusKey === 'off' || m.statusKey === 'eco') {
        await this.machine.power('on', this.store.data.config.steam ?? undefined);
        log.info(`Eingeschaltet für Wecker ${when} (${p.device})`);
        this.onEvent({ topic: 'power', title: 'Wecker', body: `Xenia eingeschaltet – Wecker um ${when} (${p.device})`, tag: 'wake', at: new Date(now).toISOString() });
      }
      this.store.data.fired = { id: p.id, alarm: p.alarm };
      this.store.save(0);
    } catch (e) {
      log.warn(`Einschalten für Wecker ${when} fehlgeschlagen: ${e.message}`);
    }
  }
}
