// Sicherung der Konfiguration und der JSON-Datenbanken als ZIP (ohne Abhängigkeiten).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { unzip } from './grinder.js';
import { DEFAULTS, SECRET_PATHS, getPath, readConfigFile, writeConfigFile, secretBox, loadConfig } from './config.js';
import { httpError } from './machine.js';

const inflateRaw = promisify(zlib.inflateRaw);
const bad = (msg) => httpError(400, msg);

export const BACKUP_KIND = 'xenios-backup';
export const BACKUP_FORMAT = 1;
export const BACKUP_MAX = 32 * 1024 * 1024;

// Dateien im Datenordner, die zur Sicherung gehören (kein Update-Kram, keine .tmp).
export const DATA_FILES = [
  'secret.key',
  'shots.json',
  'schedule.json',
  'wake.json',
  'gbs.json',
  'grinder-pin.json',
  'push-subscriptions.json',
  'sessions.json',
  'tunnel.token',
  'tls-cert.pem',
  'tls-key.pem',
];

const ALLOWED = new Set(['manifest.json', 'config.json', ...DATA_FILES]);

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const names = Object.keys(files);
  for (const name of names) {
    const data = Buffer.isBuffer(files[name]) ? files[name] : Buffer.from(files[name]);
    const nameBuf = Buffer.from(name);
    const comp = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lh, nameBuf, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(names.length, 8); end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

function safeName(name) {
  if (typeof name !== 'string' || name !== path.posix.basename(name) || name.includes('\\') || name.includes('..')) {
    throw bad('Ungültiger Dateiname in der Sicherung');
  }
  return name;
}

export function collectBackup({ configFile, dataDir, version }) {
  const files = {};
  const listed = ['manifest.json'];
  if (configFile && fs.existsSync(configFile)) {
    files['config.json'] = fs.readFileSync(configFile);
    listed.push('config.json');
  }
  for (const name of DATA_FILES) {
    const p = path.join(dataDir, name);
    try {
      if (fs.statSync(p).isFile()) {
        files[name] = fs.readFileSync(p);
        listed.push(name);
      }
    } catch { /* fehlt */ }
  }
  files['manifest.json'] = Buffer.from(JSON.stringify({
    kind: BACKUP_KIND,
    version: BACKUP_FORMAT,
    app: version || null,
    created: new Date().toISOString(),
    files: listed.filter((n) => n !== 'manifest.json'),
  }, null, 2) + '\n');
  return files;
}

export function packBackup(opts) {
  const files = collectBackup(opts);
  const day = new Date().toISOString().slice(0, 10);
  return { buffer: makeZip(files), filename: `xenios-${day}.zip`, files };
}

export async function readBackup(buf) {
  const raw = buf instanceof Uint8Array ? buf : Buffer.from(buf || []);
  if (!raw.length || raw.length > BACKUP_MAX) throw bad('Sicherung fehlt oder ist zu groß');
  let unpacked;
  try {
    unpacked = await unzip(raw, inflateRaw);
  } catch {
    throw bad('Das ist keine gültige ZIP-Datei');
  }
  const files = {};
  for (const [name, data] of Object.entries(unpacked)) {
    const n = safeName(name);
    if (!ALLOWED.has(n)) continue;
    files[n] = Buffer.from(data);
  }
  let manifest;
  try {
    manifest = JSON.parse(files['manifest.json']?.toString('utf8') || '');
  } catch {
    throw bad('Das ist keine Xenios-Sicherung (manifest.json fehlt oder ist ungültig)');
  }
  if (!manifest || manifest.kind !== BACKUP_KIND) throw bad('Das ist keine Xenios-Sicherung');
  if (!files['config.json']) throw bad('In der Sicherung fehlt config.json');
  let config;
  try {
    config = JSON.parse(files['config.json'].toString('utf8'));
  } catch {
    throw bad('config.json in der Sicherung ist ungültig');
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw bad('config.json in der Sicherung ist ungültig');
  return { manifest, files, config };
}

function checkSecrets(config, keyText, liveBox) {
  const envKey = Boolean(process.env.XENIOS_SECRET_KEY || process.env.XENIOS_SECRET_KEY_FILE);
  const box = envKey ? liveBox : keyText ? secretBox('.', keyText) : liveBox;
  if (!box) return;
  for (const p of SECRET_PATHS) {
    const v = getPath(config, p);
    if (!box.isEncrypted(v)) continue;
    try {
      box.decrypt(v, p);
    } catch {
      throw bad('Die Sicherung passt nicht zum Schlüssel (secret.key / XENIOS_SECRET_KEY)');
    }
  }
}

function writeAtomic(dest, buf) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.tmp';
  fs.writeFileSync(tmp, buf, { mode: 0o600 });
  fs.renameSync(tmp, dest);
}

export async function applyBackupFiles({ buf, configFile, dataDir, box }) {
  const { files, config, manifest } = await readBackup(buf);
  checkSecrets(config, files['secret.key']?.toString('utf8'), box);
  const current = readConfigFile(configFile);
  if (current.dataDir !== undefined) config.dataDir = current.dataDir;
  if (config.https) {
    delete config.https.cert;
    delete config.https.key;
  }
  writeConfigFile(configFile, config);
  const written = ['config.json'];
  for (const name of DATA_FILES) {
    if (!files[name]) continue;
    writeAtomic(path.join(dataDir, name), files[name]);
    written.push(name);
  }
  return { written, manifest };
}

// Übernimmt die gespeicherte config.json in das laufende cfg-Objekt, ohne Referenzen (features, machine, …) zu zerreißen.
export function refreshLiveConfig(cfg) {
  const fresh = loadConfig(cfg._file);
  for (const key of Object.keys(DEFAULTS)) {
    if (key === 'dataDir') continue;
    const src = fresh[key];
    const dst = cfg[key];
    if (src && typeof src === 'object' && !Array.isArray(src) && dst && typeof dst === 'object' && !Array.isArray(dst)) {
      Object.assign(dst, src);
    } else {
      cfg[key] = src;
    }
  }
  cfg._box = fresh._box;
  cfg._locked = fresh._locked;
}
