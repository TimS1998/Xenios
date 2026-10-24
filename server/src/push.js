// Web Push ohne Abhängigkeiten: VAPID (RFC 8292) + aes128gcm-Verschlüsselung (RFC 8291).
import crypto from 'node:crypto';
import path from 'node:path';
import { JsonStore } from './store.js';
import { logger } from './log.js';

const log = logger('push');
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url');

export function generateVapidKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

function vapidKeyObject(publicKey, privateKey) {
  const pub = unb64u(publicKey);
  return crypto.createPrivateKey({
    format: 'jwk',
    key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)), d: privateKey },
  });
}

export function vapidHeader(endpoint, { subject, publicKey, privateKey }, expSeconds = 12 * 3600) {
  const aud = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + expSeconds, sub: subject }));
  const data = `${header}.${payload}`;
  const sig = crypto.sign('sha256', Buffer.from(data), {
    key: vapidKeyObject(publicKey, privateKey),
    dsaEncoding: 'ieee-p1363',
  });
  return `vapid t=${data}.${b64u(sig)}, k=${publicKey}`;
}

// Verschlüsselt eine Nachricht für ein Abo (keys.p256dh, keys.auth) nach RFC 8291.
export function encryptPayload(plaintext, keys, { salt = crypto.randomBytes(16), ecdh } = {}) {
  const uaPublic = unb64u(keys.p256dh);
  const authSecret = unb64u(keys.auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('Ungültige Push-Schlüssel');
  const local = ecdh || crypto.createECDH('prime256v1');
  if (!ecdh) local.generateKeys();
  const asPublic = local.getPublicKey();
  const shared = local.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

export const PUSH_TOPICS = {
  heated: 'Maschine aufgeheizt',
  shot: 'Bezug fertig',
  steam: 'Dampf bereit',
  tank: 'Wassertank leer',
  power: 'Ein-/Ausgeschaltet (Timer)',
  fault: 'Störung',
  offline: 'Maschine/Mühle nicht erreichbar',
  grinder: 'Mühle',
};

export class PushService {
  constructor(cfg) {
    this.cfg = cfg.push;
    this.store = new JsonStore(path.join(cfg.dataDir, 'push-subscriptions.json'), { subs: [] });
  }

  get enabled() {
    return Boolean(this.cfg.publicKey && this.cfg.privateKey);
  }

  subscribe(sub, prefs, sessionId) {
    if (!isPushEndpoint(sub?.endpoint) || typeof sub.keys?.p256dh !== 'string' || typeof sub.keys?.auth !== 'string' || sub.keys.p256dh.length > 200 || sub.keys.auth.length > 100) {
      throw Object.assign(new Error('Ungültiges Push-Abo'), { status: 400, expose: true });
    }
    const list = this.store.data.subs.filter((s) => s.endpoint !== sub.endpoint);
    list.push({
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      prefs: normalizePrefs(prefs),
      session: sessionId,
      created: Date.now(),
    });
    this.store.data.subs = list.slice(-50);
    this.store.save(0);
  }

  unsubscribe(endpoint) {
    this.store.data.subs = this.store.data.subs.filter((s) => s.endpoint !== endpoint);
    this.store.save(0);
  }

  prefsFor(endpoint) {
    return this.store.data.subs.find((s) => s.endpoint === endpoint)?.prefs || null;
  }

  async sendToSub(sub, message, { ttl = 3600, urgency = 'high' } = {}) {
    const body = encryptPayload(JSON.stringify(message), sub.keys);
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        TTL: String(ttl),
        Urgency: urgency,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        Authorization: vapidHeader(sub.endpoint, this.cfg),
        ...(message.tag ? { Topic: String(message.tag).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) } : {}),
      },
      body,
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 404 || res.status === 410) {
      log.info('Abo abgelaufen, entfernt');
      this.unsubscribe(sub.endpoint);
      return false;
    }
    if (!res.ok) {
      log.warn(`Push fehlgeschlagen: HTTP ${res.status} ${await res.text().catch(() => '')}`.slice(0, 300));
      return false;
    }
    return true;
  }

  // Sendet an alle Abos, die das Thema eingeschaltet haben.
  async notify(topic, message) {
    if (!this.enabled) return 0;
    const subs = this.store.data.subs.filter((s) => s.prefs?.[topic] !== false);
    let ok = 0;
    await Promise.all(
      subs.map(async (s) => {
        try {
          if (await this.sendToSub(s, { topic, ...message })) ok++;
        } catch (e) {
          log.warn(`Push-Fehler: ${e.message}`);
        }
      }),
    );
    return ok;
  }
}

// Nur echte Push-Dienste der Browser (sonst könnte man den Server beliebige HTTPS-Adressen aufrufen lassen).
const PUSH_HOSTS = [/(^|\.)googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
export function isPushEndpoint(endpoint) {
  try {
    const u = new URL(String(endpoint));
    return u.protocol === 'https:' && !u.port && String(endpoint).length < 1024 && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

export function normalizePrefs(prefs) {
  const out = {};
  for (const k of Object.keys(PUSH_TOPICS)) out[k] = prefs?.[k] !== false;
  return out;
}
