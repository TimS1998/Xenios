// Konfiguration: config.json (oder --config <datei> / XENIOS_CONFIG) über die Standardwerte legen.
// Geheimnisse (Mühlen-Passwort, privater Push-Schlüssel) stehen verschlüsselt in der Datei (AES-256-GCM).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULTS = {
  // Klartext-HTTP nur auf Loopback: dort verbindet sich cloudflared. Nie ungeschützt ins Netz legen.
  http: { enabled: true, host: '127.0.0.1', port: 8080 },
  // Optional: unverschlüsseltes HTTP im Heimnetz (z. B. http://192.168.178.32/ für die Android-App zu Hause).
  // Getrennt vom Tunnel-Port: Proxy-Header werden hier nie ausgewertet.
  lan: { enabled: false, host: '0.0.0.0', port: 80 },
  // HTTPS fürs Heimnetz (selbstsigniertes Zertifikat, wird beim ersten Start erzeugt).
  // hosts: zusätzliche Namen/IPs fürs Zertifikat (z. B. die LAN-IP des Docker-Hosts)
  https: { enabled: true, host: '0.0.0.0', port: 8443, hosts: [], cert: null, key: null }, // null = <dataDir>/tls-*.pem
  // Grind-by-Sync-Vermittler: Xenios antwortet der Mühle als Xenia (die E64 WS fragt immer Port 80 ab).
  // Nur Verbindungen von grinderIp werden angenommen; null = IP aus grinder.url.
  gbs: { enabled: false, host: '0.0.0.0', port: 80, grinderIp: null },
  auth: {
    passwordHash: null,       // scrypt-Hash, wird bei der Einrichtung (Web oder "npm run setup") gesetzt
    sessionDays: 90,          // Wie lange ein Gerät angemeldet bleibt (gleitend)
    maxSessions: 20,
  },
  // Wer als Proxy vertraut wird (für CF-Connecting-IP / X-Forwarded-Proto), nur auf dem HTTP-Port.
  // "loopback" = cloudflared auf demselben Rechner · "private" = cloudflared im Docker-/Heimnetz · "all" · "none"
  trustProxy: 'loopback',
  machine: {
    url: 'http://192.168.178.55',
    timeoutMs: 6000,
    pollActiveMs: 1000,       // App offen und Maschine an / Bezug läuft
    pollIdleMs: 4000,         // App offen, Maschine aus
    pollBackgroundMs: 10000,  // Keine App offen (nur für Push-Benachrichtigungen)
    slowPollMs: 60000,        // Einstellungen, Zähler, Tank
  },
  grinder: {
    enabled: true,
    url: 'https://192.168.178.54',
    password: '',             // Owner-Passwort der Mühle (verschlüsselt gespeichert, verlässt den Server nie)
    timeoutMs: 8000,
    pollMs: 30000,
    allowDatabaseDownload: false,
  },
  features: {
    paddle: true,             // Paddle-Steuerung (Pumpe direkt) in der App
    scriptEditor: true,       // Skripte anlegen/ändern/löschen
    settings: true,           // Temperaturen & Maschineneinstellungen ändern
    clockSync: true,          // Uhrzeit der Maschine stellen
  },
  push: {
    subject: 'mailto:xenia@example.com',
    publicKey: null,
    privateKey: null,         // verschlüsselt gespeichert
  },
  publicUrl: null,           // Adresse über den Cloudflare-Tunnel, z. B. https://xenios.deine-domain.de
  timezone: null,             // IANA-Zeitzone für Zeitplan und Wecker, z. B. "Europe/Berlin"; null = System bzw. TZ
  dataDir: 'data',
  logLevel: 'info',
};

// Diese Werte werden verschlüsselt in config.json abgelegt.
export const SECRET_PATHS = ['grinder.password', 'push.privateKey'];

// Umgebungsvariablen (praktisch für Docker) überschreiben die Datei; solche Werte sind in der Web-Oberfläche gesperrt.
export const ENV_OVERRIDES = [
  ['XENIOS_MACHINE_URL', 'machine.url'],
  ['XENIOS_GRINDER_URL', 'grinder.url'],
  ['XENIOS_GRINDER_PASSWORD', 'grinder.password'],
  ['XENIOS_HTTP_HOST', 'http.host'],
  ['XENIOS_HTTP_PORT', 'http.port', Number],
  ['XENIOS_HTTPS_HOST', 'https.host'],
  ['XENIOS_HTTPS_PORT', 'https.port', Number],
  ['XENIOS_LAN_PORT', 'lan.port', Number],
  ['XENIOS_GBS_PORT', 'gbs.port', Number],
  ['XENIOS_TRUST_PROXY', 'trustProxy'],
  ['XENIOS_DATA_DIR', 'dataDir'],
  ['XENIOS_LOG_LEVEL', 'logLevel'],
];

function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

export function deepMerge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = isObject(v) && isObject(base?.[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

export function getPath(obj, p) {
  return p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setPath(obj, p, value) {
  const keys = p.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (!isObject(o[k])) o[k] = {};
    o = o[k];
  }
  o[keys.at(-1)] = value;
}

export function configPath(argv = process.argv) {
  const i = argv.indexOf('--config');
  if (i !== -1 && argv[i + 1]) return path.resolve(argv[i + 1]);
  if (process.env.XENIOS_CONFIG) return path.resolve(process.env.XENIOS_CONFIG);
  return path.join(ROOT, 'config.json');
}

// --- Verschlüsselung der Geheimnisse ----------------------------------------------------------
// Schlüssel: XENIOS_SECRET_KEY bzw. XENIOS_SECRET_KEY_FILE (z. B. Docker-Secret), sonst <dataDir>/secret.key (wird erzeugt).
// Liegt der Schlüssel neben config.json, schützt das vor dem Weitergeben/Sichern der Konfiguration allein,
// nicht vor jemandem mit Zugriff auf das ganze Datenverzeichnis.
const ENC_PREFIX = 'enc:v1:';

function decodeKey(text) {
  const s = text.trim();
  if (/^[0-9a-f]{64}$/i.test(s)) return Buffer.from(s, 'hex');
  const b = Buffer.from(s, 'base64');
  if (b.length === 32 && /^[A-Za-z0-9+/_-]+=*$/.test(s)) return b;
  return crypto.createHash('sha256').update(s, 'utf8').digest(); // beliebige Passphrase
}

export function secretBox(dataDir) {
  let key = null;
  const keyFile = path.join(dataDir, 'secret.key');
  const source = () => (process.env.XENIOS_SECRET_KEY ? 'env' : process.env.XENIOS_SECRET_KEY_FILE ? 'file-env' : 'file');
  function getKey(create) {
    if (key) return key;
    if (process.env.XENIOS_SECRET_KEY) key = decodeKey(process.env.XENIOS_SECRET_KEY);
    else if (process.env.XENIOS_SECRET_KEY_FILE) key = decodeKey(fs.readFileSync(process.env.XENIOS_SECRET_KEY_FILE, 'utf8'));
    else if (fs.existsSync(keyFile)) key = decodeKey(fs.readFileSync(keyFile, 'utf8'));
    else if (create) {
      fs.mkdirSync(dataDir, { recursive: true });
      const fresh = crypto.randomBytes(32).toString('base64');
      fs.writeFileSync(keyFile, fresh + '\n', { mode: 0o600, flag: 'wx' });
      key = decodeKey(fresh);
    }
    return key;
  }
  return {
    source,
    keyFile,
    isEncrypted: (v) => typeof v === 'string' && v.startsWith(ENC_PREFIX),
    encrypt(plain, aad = '') {
      if (plain === null || plain === undefined || plain === '') return plain;
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', getKey(true), iv);
      c.setAAD(Buffer.from(aad));
      const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
      return ENC_PREFIX + [iv, c.getAuthTag(), ct].map((b) => b.toString('base64url')).join(':');
    },
    decrypt(value, aad = '') {
      if (typeof value !== 'string' || !value.startsWith(ENC_PREFIX)) return value;
      const k = getKey(false);
      if (!k) throw new Error('Verschlüsselte Werte in der Konfiguration, aber kein Schlüssel (secret.key / XENIOS_SECRET_KEY) gefunden');
      const [iv, tag, ct] = value.slice(ENC_PREFIX.length).split(':').map((s) => Buffer.from(s, 'base64url'));
      try {
        const d = crypto.createDecipheriv('aes-256-gcm', k, iv);
        d.setAAD(Buffer.from(aad));
        d.setAuthTag(tag);
        return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
      } catch {
        throw new Error(`"${aad}" lässt sich nicht entschlüsseln – falscher Schlüssel (secret.key / XENIOS_SECRET_KEY)?`);
      }
    },
  };
}

// --- Laden und Speichern ------------------------------------------------------------------------
export function readConfigFile(file) {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${file} ist kein gültiges JSON: ${e.message}`);
  }
}

export function loadConfig(file = configPath()) {
  const user = readConfigFile(file);
  const cfg = deepMerge(DEFAULTS, user);
  cfg._file = file;
  cfg._exists = fs.existsSync(file);
  cfg._locked = [];
  for (const [name, p, conv] of ENV_OVERRIDES) {
    const v = process.env[name];
    if (v === undefined || v === '') continue;
    setPath(cfg, p, conv ? conv(v) : v);
    cfg._locked.push(p);
  }
  const baseDir = path.dirname(file);
  cfg.dataDir = path.resolve(baseDir, cfg.dataDir);
  cfg.https.cert = cfg.https.cert ? path.resolve(baseDir, cfg.https.cert) : path.join(cfg.dataDir, 'tls-cert.pem');
  cfg.https.key = cfg.https.key ? path.resolve(baseDir, cfg.https.key) : path.join(cfg.dataDir, 'tls-key.pem');
  cfg.machine.url = cfg.machine.url.replace(/\/+$/, '');
  cfg.grinder.url = cfg.grinder.url.replace(/\/+$/, '');
  cfg._box = secretBox(cfg.dataDir);
  for (const p of SECRET_PATHS) {
    if (cfg._locked.includes(p)) continue;
    setPath(cfg, p, cfg._box.decrypt(getPath(cfg, p), p));
  }
  return cfg;
}

// Schreibt nur die übergebenen Änderungen in die Datei (Pfad → Wert), Geheimnisse verschlüsselt, atomar.
// Umgebungs-Overrides und aufgelöste Pfade landen so nie in config.json.
export function updateConfigFile(file, changes, box) {
  const raw = readConfigFile(file);
  for (const [p, v] of Object.entries(changes)) {
    setPath(raw, p, SECRET_PATHS.includes(p) && box ? box.encrypt(v, p) : v);
  }
  writeConfigFile(file, raw);
  return raw;
}

export function writeConfigFile(file, data) {
  const clean = JSON.parse(JSON.stringify(data, (k, v) => (k.startsWith('_') ? undefined : v)));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(clean, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

// Klartext-Geheimnisse aus älteren Versionen verschlüsseln.
export function migrateSecrets(cfg) {
  const raw = readConfigFile(cfg._file);
  const plain = SECRET_PATHS.filter((p) => {
    const v = getPath(raw, p);
    return typeof v === 'string' && v !== '' && !cfg._box.isEncrypted(v);
  });
  if (plain.length) updateConfigFile(cfg._file, Object.fromEntries(plain.map((p) => [p, getPath(raw, p)])), cfg._box);
  return plain;
}

// Zeitzone für Zeitplan/Wecker (Node übernimmt eine Änderung von process.env.TZ sofort).
const SYSTEM_TZ = process.env.TZ;
export function applyTimezone(tz) {
  if (tz) process.env.TZ = tz;
  else if (SYSTEM_TZ) process.env.TZ = SYSTEM_TZ;
  else delete process.env.TZ;
}

export function isTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
