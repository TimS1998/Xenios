// Grind-by-Sync-Vermittler: Xenios gibt sich der Mahlkönig E64 WS gegenüber als Xenia aus (Port 80, nur für die IP
// der Mühle) und reicht ihre Anfragen an die echte Xenia weiter. Nur der Start per Drehknopf (scripts/execute
// {"ID":9}) wird gegen das in der App gewählte Profil getauscht. Das Profil stoppt wie Skript 9 beim Zielgewicht
// des Mühlenrezepts (Befehl 27), damit die Mühle weiter aus der Bezugszeit lernt.
// Eigene Umsetzung nach der Protokollbeschreibung in docs/API-Xenia.md (Abschnitt 14).
import path from 'node:path';
import net from 'node:net';
import { buildScript, httpError } from './machine.js';
import { JsonStore } from './store.js';
import { logger } from './log.js';

const log = logger('gbs');

export const HELPER_NAME = 'Xenios GbS';
const MAX_BODY = 4096;
const HOLD_S = 30;

// Was die Mühle bei der Xenia abfragt bzw. auslöst. Alles andere wird nicht weitergereicht:
// Wer die IP der Mühle vortäuscht, kommt so nicht an Skripte löschen, WLAN oder Einstellungen.
const PASS = new Set([
  'GET /api/v2/machine', 'GET /api/v2/mako', 'GET /api/v2/info', 'GET /api/v2/status',
  'GET /api/v2/overview', 'GET /api/v2/overview_single', 'GET /api/v2/diagram/get',
  'POST /api/v2/brewratio', 'POST /api/v2/scripts/execute',
]);

// Schritte des Ersatz-Skripts. Befehl 27 („Bezug stoppen bei“) ist in der Firmware ein
// blockierendes Warten auf das Gewicht – vorn, vor Ventil und Pumpe, läuft kein Wasser
// (56 s bei 0 bar). Wie in den Original-Beispielen deshalb erst Pumpe, 27 direkt vor „Pumpe aus“.
// extend: letzte Druckstufe +30 s, damit 27 noch Gewicht sehen kann, statt nach fester Profilzeit.
export function gbsSteps(steps, weight, { extend = true } = {}) {
  const out = steps.filter((s) => s.op !== 27).map((s) => ({ op: s.op, args: [...(s.args || [])] }));
  if (extend) {
    const last = out.findLastIndex((s) => s.op === 4);
    if (last >= 0) out.splice(last + 1, 0, { op: 4, args: [out[last].args[0], HOLD_S] });
  }
  const stop = { op: 27, args: [Math.round(weight)] };
  const off = out.findLastIndex((s) => s.op === 6);
  if (off >= 0) out.splice(off, 0, stop);
  else out.push(stop);
  return out;
}

// Körper der Mühle: JSON-Text (bei jQuery-Art mit Formular-Content-Type), notfalls ID=9 als Formular
export function parseBody(text) {
  if (!text) return {};
  try {
    const j = JSON.parse(text);
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
  } catch {
    return Object.fromEntries(new URLSearchParams(text));
  }
}

const plainIp = (ip) => String(ip || '').replace(/^::ffff:/, '');

export class GbsProxy {
  constructor(cfg, machine, { store } = {}) {
    this.cfg = cfg;
    this.machine = machine;
    this.store = store || new JsonStore(path.join(cfg.dataDir, 'gbs.json'), { scriptId: null, extend: true, lastGrind: null, helper: null });
    this.state = { lastContact: null, lastStart: null, lastError: null, refused: null };
    this._chain = Promise.resolve();
    this._unknown = new Set();
  }

  // Erlaubte IP: fest eingetragen oder aus der Adresse der Mühle (nur wenn dort eine IP steht)
  grinderIp() {
    if (this.cfg.gbs.grinderIp) return plainIp(this.cfg.gbs.grinderIp);
    try {
      const h = new URL(this.cfg.grinder.url).hostname.replace(/^\[|\]$/g, '');
      return net.isIP(h) ? h : null;
    } catch {
      return null;
    }
  }

  allowed(remote) {
    const want = this.grinderIp();
    return Boolean(want) && plainIp(remote) === want;
  }

  refuse(remote) {
    const ip = plainIp(remote);
    if (this.state.refused?.ip !== ip) log.warn(`Verbindung von ${ip} abgewiesen (erlaubt ist nur die Mühle: ${this.grinderIp() || 'IP fehlt'})`);
    this.state.refused = { ip, at: new Date().toISOString() };
  }

  // Ein Ablauf nach dem anderen (Hilfsskript anlegen/ändern)
  _serial(fn) {
    const p = this._chain.then(fn, fn);
    this._chain = p.catch(() => {});
    return p;
  }

  // Ersatz für Skript 9 bereitstellen: { id, title, steps, weight } oder null (= Original-Skript 9)
  async plan() {
    const { scriptId, extend, lastGrind } = this.store.data;
    const weight = Number(lastGrind?.weight);
    if (!scriptId || !(weight >= 1 && weight <= 400)) return null;
    const src = await this.machine.readScript(scriptId).catch((e) => {
      throw new Error(`Profil (Skript ${scriptId}) nicht lesbar – gelöscht? (${e.message})`);
    });
    if (!src.steps?.length) throw new Error(`Profil (Skript ${scriptId}) ist leer`);
    const steps = gbsSteps(src.steps, weight, { extend });
    const instruction = buildScript(steps);
    const helpers = (await this.machine.scripts()).filter((s) => s.title === HELPER_NAME);
    const known = this.store.data.helper;
    let id = helpers.find((s) => s.id === known?.id)?.id ?? helpers.at(-1)?.id ?? null;
    if (id === null || known?.id !== id || known.instruction !== instruction) {
      await this.machine.writeScript({ id: id ?? undefined, name: HELPER_NAME, instruction });
      if (id === null) {
        id = (await this.machine.scripts()).filter((s) => s.title === HELPER_NAME).at(-1)?.id ?? null;
        if (id === null) throw new Error('Hilfsskript ließ sich nicht anlegen');
      }
      this.store.data.helper = { id, instruction };
      this.store.save();
      log.info(`Hilfsskript ${id} („${HELPER_NAME}“) = ${src.title}, Stopp bei ${Math.round(weight)} g`);
    }
    return { id, title: src.title, steps, weight };
  }

  prepare() {
    return this._serial(() => this.plan()).catch((e) => {
      this.state.lastError = e.message;
      log.warn(`Ersatz-Skript nicht vorbereitet: ${e.message}`);
    });
  }

  view() {
    const d = this.store.data;
    return {
      enabled: Boolean(this.cfg.gbs.enabled), port: this.cfg.gbs.port, grinderIp: this.grinderIp(),
      scriptId: d.scriptId, extend: d.extend !== false, helperId: d.helper?.id ?? null, helperName: HELPER_NAME,
      lastGrind: d.lastGrind, ...this.state,
    };
  }

  setChoice({ scriptId, extend }) {
    const d = this.store.data;
    if (scriptId !== undefined) {
      if (scriptId !== null) {
        const n = Number(scriptId);
        if (!Number.isInteger(n) || n < 10 || n > 199) throw httpError(400, 'Profil: eigenes Skript (ID 10–199) oder keins');
        if (!this.cfg.features.scriptEditor) throw httpError(403, 'Skript-Editor ist deaktiviert (das Profil wird als Skript auf der Maschine angelegt)');
        if (n === d.helper?.id) throw httpError(400, 'Das Hilfsskript selbst kann nicht gewählt werden');
        scriptId = n;
      }
      d.scriptId = scriptId;
    }
    if (extend !== undefined) {
      if (typeof extend !== 'boolean') throw httpError(400, 'extend: an/aus erwartet');
      d.extend = extend;
    }
    this.state.lastError = null;
    this.store.save();
    if (d.scriptId && d.lastGrind) this.prepare();
    return this.view();
  }

  // --- Anfragen der Mühle ---
  async handle(req, res) {
    const remote = req.socket.remoteAddress;
    if (!this.allowed(remote)) {
      this.refuse(remote);
      return req.socket.destroy();
    }
    const send = (status, type, body) => {
      res.writeHead(status, { 'Content-Type': type || 'application/json', 'Cache-Control': 'no-store' });
      res.end(body);
    };
    // Browser-Header: eine Webseite soll nicht als Mühle auftreten
    if (req.headers.origin || req.headers['sec-fetch-site']) return send(403, null, '{}');
    let text;
    try {
      text = await readBody(req);
    } catch {
      return send(413, null, '{}');
    }
    const p = new URL(req.url, 'http://x').pathname.replace(/\/+$/, '');
    const key = `${req.method} ${p}`;
    this.state.lastContact = new Date().toISOString();
    if (!PASS.has(key)) {
      if (!this._unknown.has(key)) {
        this._unknown.add(key);
        log.info(`Anfrage der Mühle nicht weitergereicht: ${key}`);
      }
      return send(404, null, '{}');
    }
    const type = req.headers['content-type'];
    try {
      if (key === 'POST /api/v2/brewratio') {
        const r = await this.machine.client.raw('POST', p, text, type);
        const j = parseBody(text);
        const weight = Number(j.SYNC_BEVERAGE_WEIGHT);
        this.store.data.lastGrind = { weight: Number.isFinite(weight) ? weight : null, filter: j.SYNC_FILTER ?? null, at: new Date().toISOString() };
        this.store.save();
        log.info(`Mühle meldet Mahlvorgang: Ziel ${Number.isFinite(weight) ? `${weight} g` : 'unbekannt'}`);
        if (this.store.data.scriptId) this.prepare();
        return send(r.status, r.type, r.body);
      }
      if (key === 'POST /api/v2/scripts/execute') return await this._start(p, text, type, send);
      const r = await this.machine.client.raw(req.method, p, req.method === 'GET' ? undefined : text, type);
      return send(r.status, r.type, r.body);
    } catch (e) {
      log.warn(`${key}: ${e.message}`);
      return send(502, null, '{}');
    }
  }

  async _start(p, text, type, send) {
    const id = Number(parseBody(text).ID);
    if (id !== 9) {
      log.warn(`Mühle wollte Skript ${parseBody(text).ID} starten – nur Skript 9 wird weitergereicht`);
      return send(403, null, '{}');
    }
    let plan = null;
    try {
      plan = await this._serial(() => this.plan());
    } catch (e) {
      this.state.lastError = e.message;
      log.warn(`Profil nicht startbar, starte das Original-Skript 9: ${e.message}`);
    }
    const body = plan ? JSON.stringify({ ID: plan.id }) : text;
    const r = await this.machine.client.raw('POST', p, body, type || 'application/x-www-form-urlencoded; charset=UTF-8');
    const ok = r.status >= 200 && r.status < 300;
    if (ok) {
      if (plan) this.machine.noteScript(plan.id, { title: `GbS: ${plan.title}`, steps: plan.steps });
      else this.machine.noteScript(9, { title: 'Grind-by-Sync', steps: null });
      if (plan) this.state.lastError = null;
    }
    this.state.lastStart = { at: new Date().toISOString(), swapped: Boolean(plan), title: plan?.title ?? null, weight: plan ? Math.round(plan.weight) : null, ok };
    log.info(plan ? `Drehknopf: „${plan.title}“ bis ${Math.round(plan.weight)} g gestartet (Skript ${plan.id})` : 'Drehknopf: Original-Skript 9 gestartet');
    return send(r.status, r.type, r.body);
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('zu groß'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function gbsRoutes(route, { gbs }) {
  route('GET', '/api/gbs', async () => gbs.view());
  route('PUT', '/api/gbs', async ({ body }) => gbs.setChoice({ scriptId: body.scriptId, extend: body.extend }));
}
