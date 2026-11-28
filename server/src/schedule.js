// Zusätzliche Schaltzeiten, die der Server selbst ausführt (die Firmware kennt nur eine Ein-/Aus-Zeit pro Tag).
import path from 'node:path';
import { JsonStore } from './store.js';
import { logger } from './log.js';
import { httpError } from './machine.js';
import { t } from '../web/shared/i18n.js';

const log = logger('zeitplan');
export const SCHEDULE_ACTION_KEYS = ['on', 'eco', 'off'];
// Namen der Aktionen (Text erst beim Gebrauch, optional in einer anderen Sprache)
export function scheduleActions(lang) {
  return { on: t('server.schedule.actions.on', null, lang), eco: t('server.schedule.actions.eco', null, lang), off: t('server.schedule.actions.off', null, lang) };
}
// Benachrichtigung, wenn eine Schaltzeit ausgeführt wurde
export function scheduleEventText(action, time, label, lang) {
  const a = scheduleActions(lang)[action];
  return {
    title: t('server.schedule.title', null, lang),
    body: label ? t('server.schedule.firedLabel', { action: a, time, label }, lang) : t('server.schedule.fired', { action: a, time }, lang),
  };
}
const DAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

export class Scheduler {
  constructor(cfg, machine, { onEvent } = {}) {
    this.machine = machine;
    this.onEvent = onEvent || (() => {});
    this.store = new JsonStore(path.join(cfg.dataDir, 'schedule.json'), { rules: [] });
    this.lastRun = new Map(); // id -> "YYYY-MM-DD HH:MM"
    this.timer = null;
  }

  list() {
    return this.store.data.rules;
  }

  save(rules) {
    if (!Array.isArray(rules) || rules.length > 50) throw httpError(400, t('server.schedule.tooMany'));
    const clean = rules.map((r, i) => {
      const time = String(r.time || '');
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw httpError(400, t('server.schedule.badTime', { n: i + 1 }));
      if (!SCHEDULE_ACTION_KEYS.includes(r.action)) throw httpError(400, t('server.schedule.badAction', { n: i + 1 }));
      const days = [...new Set((Array.isArray(r.days) ? r.days : []).map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
      if (!days.length) throw httpError(400, t('server.schedule.noDays', { n: i + 1 }));
      return {
        id: /^[a-z0-9]{1,12}$/.test(String(r.id || '')) ? String(r.id) : Math.random().toString(36).slice(2, 10),
        enabled: r.enabled !== false,
        time,
        days,
        action: r.action,
        steam: r.action === 'on' && typeof r.steam === 'boolean' ? r.steam : null,
        label: String(r.label || '').slice(0, 40),
      };
    });
    this.store.data.rules = clean;
    this.store.save(0);
    return clean;
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

  // Läuft alle 15 s; jede Regel höchstens einmal pro Minute. Schlägt das Schalten fehl, wird es in derselben Minute erneut versucht.
  async tick(now = new Date()) {
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const key = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()} ${hhmm}`;
    const day = (now.getDay() + 6) % 7; // Montag = 0
    for (const r of this.list()) {
      if (!r.enabled || r.time !== hhmm || !r.days.includes(day) || this.lastRun.get(r.id) === key) continue;
      const m = this.machine.snapshot();
      if (r.action !== 'on' && m.shot?.running) continue; // laufenden Bezug nicht abbrechen
      try {
        await this.machine.power(r.action, r.steam ?? undefined);
        this.lastRun.set(r.id, key);
        log.info(`${scheduleActions()[r.action]} (${hhmm}${r.label ? `, ${r.label}` : ''})`);
        this.onEvent({ topic: 'power', ...scheduleEventText(r.action, hhmm, r.label), tag: 'schedule', at: now.toISOString() });
      } catch (e) {
        log.warn(`${scheduleActions()[r.action]} um ${hhmm} fehlgeschlagen: ${e.message}`);
      }
    }
  }

  // Nächstes geplantes Einschalten (Aktion „on“) in den kommenden 7 Tagen, für Widgets.
  nextOn(now = new Date()) {
    let best = null;
    for (const r of this.list()) {
      if (!r.enabled || r.action !== 'on') continue;
      const [hh, mm] = r.time.split(':').map(Number);
      for (let i = 0; i < 8; i++) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, hh, mm);
        if (d <= now || !r.days.includes((d.getDay() + 6) % 7)) continue;
        if (!best || d.getTime() < best.at) best = { at: d.getTime(), reason: r.label || t('server.schedule.title') };
        break;
      }
    }
    return best;
  }

  describe(r) {
    return `${r.days.map((d) => DAY_SHORT[d]).join(', ')} ${r.time} ${scheduleActions()[r.action]}`;
  }
}
