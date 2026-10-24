// Passwort-Login, Sitzungen (Cookie) und Schutz gegen Durchprobieren.
import crypto from 'node:crypto';
import path from 'node:path';
import { JsonStore } from './store.js';

const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password.normalize('NFC'), salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password.normalize('NFC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
  });
  return crypto.timingSafeEqual(expected, actual);
}

// Mindestanforderung ans App-Passwort; null = ok.
export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'mindestens 10 Zeichen';
  if (pw.length > 256) return 'höchstens 256 Zeichen';
  if (/^(.)\1+$/.test(pw)) return 'nicht nur ein Zeichen wiederholen';
  if (/^(0123456789|1234567890|passwort\d*|password\d*|qwertz\w*|qwerty\w*)$/i.test(pw)) return 'zu leicht zu erraten';
  return null;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export class Sessions {
  constructor(cfg) {
    this.days = cfg.auth.sessionDays;
    this.max = cfg.auth.maxSessions;
    this.store = new JsonStore(path.join(cfg.dataDir, 'sessions.json'), { sessions: {} });
    this.prune();
  }

  create(meta) {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    this.store.data.sessions[sha256(token)] = {
      created: now,
      lastSeen: now,
      expires: now + this.days * 86400e3,
      ua: String(meta.ua || '').slice(0, 160),
      ip: String(meta.ip || ''),
      ...(meta.device ? { device: String(meta.device).slice(0, 60) } : {}),
    };
    this.prune();
    this.store.save(0);
    return token;
  }

  // Liefert die Sitzung (und verlängert sie gleitend) oder null.
  check(token) {
    if (!token || typeof token !== 'string' || token.length > 100) return null;
    const id = sha256(token);
    const s = this.store.data.sessions[id];
    if (!s) return null;
    const now = Date.now();
    if (s.expires < now) {
      delete this.store.data.sessions[id];
      this.store.save();
      return null;
    }
    if (now - s.lastSeen > 3600e3) {
      s.lastSeen = now;
      s.expires = now + this.days * 86400e3;
      this.store.save();
    }
    return { id, ...s };
  }

  destroy(token) {
    if (!token) return;
    delete this.store.data.sessions[sha256(token)];
    this.store.save(0);
  }

  // Alle Sitzungen beenden, optional bis auf eine (z. B. nach Passwortwechsel die eigene behalten).
  destroyAll(exceptId = null) {
    const keep = exceptId && this.store.data.sessions[exceptId];
    this.store.data.sessions = keep ? { [exceptId]: keep } : {};
    this.store.save(0);
  }

  // Sitzung über die gekürzte ID aus list() beenden.
  destroyShort(shortId) {
    const id = Object.keys(this.store.data.sessions).find((k) => k.slice(0, 8) === shortId);
    if (!id) return null;
    delete this.store.data.sessions[id];
    this.store.save(0);
    return id;
  }

  list(currentId = null) {
    return Object.entries(this.store.data.sessions)
      .map(([id, s]) => ({ ...s, id: id.slice(0, 8), current: id === currentId }))
      .sort((a, b) => b.lastSeen - a.lastSeen);
  }

  prune() {
    const now = Date.now();
    const entries = Object.entries(this.store.data.sessions).filter(([, s]) => s.expires > now);
    entries.sort((a, b) => b[1].lastSeen - a[1].lastSeen);
    this.store.data.sessions = Object.fromEntries(entries.slice(0, this.max));
  }
}

// Gestaffelte Sperre pro IP plus globale Bremse gegen verteiltes Durchprobieren.
export class LoginLimiter {
  constructor() {
    this.byIp = new Map();
    this.globalFails = [];
  }

  // Gibt die Wartezeit in ms zurück (0 = Versuch erlaubt).
  retryAfter(ip) {
    const now = Date.now();
    this.globalFails = this.globalFails.filter((t) => now - t < 10 * 60e3);
    if (this.globalFails.length >= 30) return 10 * 60e3 - (now - this.globalFails[0]);
    const e = this.byIp.get(ip);
    if (e && e.until > now) return e.until - now;
    return 0;
  }

  fail(ip) {
    const now = Date.now();
    this.globalFails.push(now);
    const e = this.byIp.get(ip) || { fails: 0, until: 0 };
    e.fails += 1;
    if (e.fails >= 5) {
      // 5 Fehlversuche: 1 min, danach jeweils verdoppelt bis max. 1 h
      const lock = Math.min(60e3 * 2 ** (e.fails - 5), 3600e3);
      e.until = now + lock;
    }
    this.byIp.set(ip, e);
    if (this.byIp.size > 5000) this.byIp.delete(this.byIp.keys().next().value);
  }

  success(ip) {
    this.byIp.delete(ip);
  }
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!(k in out)) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function sessionCookie(token, { secure, maxAgeDays }) {
  const name = secure ? '__Host-xs' : 'xs';
  const attrs = [`${name}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (secure) attrs.push('Secure');
  if (maxAgeDays === 0) attrs.push('Max-Age=0');
  else if (maxAgeDays) attrs.push(`Max-Age=${Math.round(maxAgeDays * 86400)}`);
  return attrs.join('; ');
}

// Cookie (Browser/WebView) oder "Authorization: Bearer <token>" (Android-Widgets, Schnelleinstellungen).
export function tokenFromRequest(req) {
  const auth = String(req.headers.authorization || '');
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim() || null;
  const c = parseCookies(req.headers.cookie);
  return c['__Host-xs'] || c.xs || null;
}
