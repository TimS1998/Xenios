// Mühle im Server: gemeinsamer Geräte-Code (public/shared/grinder-core.js) mit Node-HTTPS-Transport und Zertifikats-Pinning.
import https from 'node:https';
import http from 'node:http';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { Grinder as GrinderCore } from '../web/shared/grinder-core.js';
import { logger } from './log.js';

const log = logger('muehle');
const inflateRaw = promisify(zlib.inflateRaw);

export { ALERT_TEXT, unzip } from '../web/shared/grinder-core.js';

// Die Mühle nutzt ein selbstsigniertes Zertifikat. Die Verbindung bleibt verschlüsselt, das Zertifikat wird per
// "Pinning" geprüft (Fingerprint beim ersten Kontakt gemerkt). Die Prüfung läuft direkt nach dem TLS-Handshake,
// bevor Header, Sitzungs-Cookie oder Passwort gesendet werden.
export class GrinderHttp {
  constructor({ url, timeoutMs = 8000, pinnedFingerprint = null }) {
    this.base = new URL(url);
    this.timeoutMs = timeoutMs;
    this.cookies = new Map();
    this.pinned = pinnedFingerprint;
    // maxCachedSessions 0: ohne TLS-Sitzungswiederaufnahme liefert jeder Handshake das Zertifikat für die Prüfung
    this.agent = this.base.protocol === 'https:'
      ? new https.Agent({ keepAlive: true, maxSockets: 2, rejectUnauthorized: false, maxCachedSessions: 0 })
      : new http.Agent({ keepAlive: true, maxSockets: 2 });
    this.onFingerprint = null;
  }

  // Fehler bei abweichendem Zertifikat, sonst null (erstes Zertifikat wird gemerkt).
  _checkPin(fp) {
    if (!fp) return new Error('Mühle sendet kein Zertifikat');
    if (!this.pinned) {
      this.pinned = fp;
      this.onFingerprint?.(fp);
      return null;
    }
    if (this.pinned === fp) return null;
    return Object.assign(new Error('Zertifikat der Mühle hat sich geändert – möglicher Angriff. In den Server-Einstellungen prüfen und ggf. „Zertifikat vergessen“.'), { status: 502, expose: true });
  }

  request(method, path, { body, form, headers = {}, binary = false } = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.base);
      let payload = null;
      const h = { Accept: '*/*', 'User-Agent': 'xenios', ...headers };
      if (form) {
        payload = Buffer.from(new URLSearchParams(form).toString());
        h['Content-Type'] = 'application/x-www-form-urlencoded';
      } else if (body !== undefined) {
        payload = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
        h['Content-Type'] = 'application/json';
      }
      if (payload) h['Content-Length'] = payload.length;
      if (this.cookies.size) h.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
      const tls = url.protocol === 'https:';
      const req = (tls ? https : http).request(url, { method, headers: h, agent: this.agent, timeout: this.timeoutMs }, (res) => {
        for (const c of res.headers['set-cookie'] || []) {
          const [pair] = c.split(';');
          const i = pair.indexOf('=');
          if (i > 0) {
            const k = pair.slice(0, i).trim();
            const v = pair.slice(i + 1).trim();
            if (/max-age=0|expires=Thu, 01 Jan 1970/i.test(c) || v === 'deleted') this.cookies.delete(k);
            else this.cookies.set(k, v);
          }
        }
        const chunks = [];
        let size = 0;
        res.on('data', (d) => {
          size += d.length;
          if (size > 20 * 1024 * 1024) {
            req.destroy();
            reject(new Error('Antwort zu groß'));
          } else chunks.push(d);
        });
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          resolve({ status: res.statusCode, headers: res.headers, buffer: buf, text: binary ? null : buf.toString('utf8') });
        });
      });
      req.on('timeout', () => req.destroy(new Error('Zeitüberschreitung (Mühle)')));
      req.on('error', reject);
      // Header und Body gehen erst nach erfolgreicher Zertifikatsprüfung raus.
      const send = () => {
        if (payload) req.write(payload);
        req.end();
      };
      if (!tls) return send();
      req.on('socket', (sock) => {
        const verify = () => {
          const err = this._checkPin(sock.getPeerCertificate?.()?.fingerprint256);
          if (err) req.destroy(err);
          else send();
        };
        // Wiederverwendete Keep-Alive-Verbindung: Handshake ist schon durch
        if (sock.getPeerCertificate?.()?.fingerprint256) verify();
        else sock.once('secureConnect', verify);
      });
    });
  }

  close() {
    this.agent.destroy();
  }
}

export class Grinder extends GrinderCore {
  constructor(cfg, { pinStore } = {}) {
    super(cfg, { http: null, inflateRaw: (data) => inflateRaw(data) });
    this.pinStore = pinStore;
    this._makeTransport();
  }

  _makeTransport() {
    this.http?.close?.();
    const t = new GrinderHttp({ url: this.cfg.url, timeoutMs: this.cfg.timeoutMs, pinnedFingerprint: this.pinStore?.data?.fingerprint || null });
    t.onFingerprint = (fp) => {
      log.info(`Zertifikat der Mühle gemerkt: ${fp}`);
      if (this.pinStore) {
        this.pinStore.data.fingerprint = fp;
        this.pinStore.save(0);
      }
    };
    this.http = t;
    this._urlKey = this.cfg.url;
  }

  get pinnedFingerprint() {
    return this.pinStore?.data?.fingerprint || null;
  }

  // Gemerktes Zertifikat verwerfen (z. B. nach Firmware-Update oder Tausch der Mühle).
  unpin() {
    if (this.pinStore) {
      delete this.pinStore.data.fingerprint;
      this.pinStore.save(0);
    }
    this._makeTransport();
    this.loggedIn = false;
  }

  // Nach Änderung von Adresse/Passwort/An-Aus in den Server-Einstellungen.
  reconfigure() {
    const urlChanged = this._urlKey !== this.cfg.url;
    if (urlChanged) {
      // Andere Adresse = anderes Gerät: Zertifikat neu lernen
      if (this.pinStore) {
        delete this.pinStore.data.fingerprint;
        this.pinStore.save(0);
      }
      this._makeTransport();
      this.state.info = null;
    }
    this.loggedIn = false;
    this.loginBlockedUntil = 0;
    this.state.enabled = Boolean(this.cfg.enabled);
    this.state.configured = Boolean(this.cfg.password);
    this.state.error = null;
    if (!this.cfg.enabled) {
      this._stopped = true; // auch eine gerade laufende Abfrage plant danach nichts mehr ein
      clearTimeout(this._timer);
      this.state.online = false;
      this.emit('state');
      return;
    }
    this._stopped = false;
    this.kick(100);
  }
}
