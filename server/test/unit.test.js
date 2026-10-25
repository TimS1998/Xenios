// Einheitentests: Passwort, Sperre, Push-Verschlüsselung, Skript-Format, Zeit-Codierung, SQLite-Leser, Zertifikat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword, verifyPassword, LoginLimiter, parseCookies, sessionCookie } from '../src/auth.js';
import { encryptPayload, vapidHeader, generateVapidKeys } from '../src/push.js';
import { parseScript, buildScript, isScriptNameValid, clockToIso, timerToMinutes, scriptType } from '../src/machine.js';
import { openSqlite } from '../src/sqlite-read.js';
import { createSelfSignedCert } from '../src/tls.js';
import { unzip } from '../src/grinder.js';
import { makeZip, packBackup, readBackup } from '../src/backup.js';
import { compareVersions, helperAlive, requestUpdate, readUpdate, resetLatestCache, fetchLatest } from '../src/update.js';
import { tunnelTokenFromPaste, requestTunnelToken, tunnelTokenFile, waitForTunnelApplied } from '../src/tunnel-token.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('Passwort-Hash: richtig/falsch, Salz zufällig', () => {
  const a = hashPassword('kaffee-ist-gut');
  const b = hashPassword('kaffee-ist-gut');
  assert.notEqual(a, b);
  assert.ok(verifyPassword('kaffee-ist-gut', a));
  assert.ok(!verifyPassword('kaffee-ist-gut ', a));
  assert.ok(!verifyPassword('', a));
  assert.ok(!verifyPassword('x', 'kaputt'));
});

test('Login-Sperre greift nach 5 Fehlversuchen und verdoppelt sich', () => {
  const l = new LoginLimiter();
  for (let i = 0; i < 4; i++) l.fail('1.2.3.4');
  assert.equal(l.retryAfter('1.2.3.4'), 0);
  l.fail('1.2.3.4');
  const w1 = l.retryAfter('1.2.3.4');
  assert.ok(w1 > 55e3 && w1 <= 60e3);
  l.fail('1.2.3.4');
  assert.ok(l.retryAfter('1.2.3.4') > 110e3);
  assert.equal(l.retryAfter('5.6.7.8'), 0);
  l.success('1.2.3.4');
  assert.equal(l.retryAfter('1.2.3.4'), 0);
});

test('Cookies', () => {
  assert.deepEqual(parseCookies('a=1; xs=abc%20d; b=2'), { a: '1', xs: 'abc d', b: '2' });
  assert.match(sessionCookie('t', { secure: true, maxAgeDays: 1 }), /^__Host-xs=t; Path=\/; HttpOnly; SameSite=Lax; Secure; Max-Age=86400$/);
  assert.doesNotMatch(sessionCookie('t', { secure: false }), /Secure/);
});

// Gegenstück (Browser-Seite) zu RFC 8291, um die Verschlüsselung unabhängig zu prüfen
function decryptAes128gcm(body, uaEcdh, authSecret) {
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  assert.equal(rs, 4096);
  const shared = uaEcdh.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaEcdh.getPublicKey(), asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2);
  return plain.subarray(0, -1).toString();
}

test('Web Push: Verschlüsselung (RFC 8291) und VAPID-Signatur', () => {
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const msg = JSON.stringify({ title: 'Xenia ist bereit', body: '93,0 °C ☕' });
  const enc = encryptPayload(msg, { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') });
  assert.equal(decryptAes128gcm(enc, ua, auth), msg);

  const keys = generateVapidKeys();
  const hdr = vapidHeader('https://fcm.googleapis.com/fcm/send/x', { subject: 'mailto:a@b.c', ...keys });
  const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(hdr);
  assert.equal(k, keys.publicKey);
  const [h, p, s] = jwt.split('.');
  const pub = Buffer.from(keys.publicKey, 'base64url');
  const key = crypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') } });
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
  assert.equal(JSON.parse(Buffer.from(p, 'base64url')).aud, 'https://fcm.googleapis.com');
});

test('Skript-Format: Lesen und Schreiben (Einheiten wie Original-UI)', () => {
  const content = '1;13;3 40 2000;12 4000;4 9000 25000;27 36;6;7;';
  const steps = parseScript(content);
  assert.deepEqual(steps, [
    { op: 13, args: [] }, { op: 3, args: [40, 2] }, { op: 12, args: [4] }, { op: 4, args: [9, 25] }, { op: 27, args: [36] }, { op: 6, args: [] },
  ]);
  assert.equal(buildScript(steps), content);
  // Grenzen werden eingehalten
  assert.equal(buildScript([{ op: 4, args: [15, 100] }]), '1;4 10000 45000;7;');
  assert.throws(() => buildScript([{ op: 99, args: [] }]));
  assert.throws(() => buildScript([{ op: 1, args: [] }]));
  assert.ok(isScriptNameValid('Blooming 9#bar_1'));
  assert.ok(!isScriptNameValid(' führend'));
  assert.ok(!isScriptNameValid('Kaffee ä'));
  assert.equal(scriptType(12), 'standard');
  assert.equal(scriptType(160), 'pressure');
  assert.equal(scriptType(201), 'paddle');
  assert.equal(scriptType(8), 'builtin');
});

test('Zeit-Codierung der Firmware', () => {
  // Echte Werte aus der Maschine: MA_CLOCK 589844, MA_CALENDAR 117966826
  assert.equal(clockToIso(589844, 117966826), '2026-08-07T09:00:20');
  assert.equal(timerToMinutes((7 << 16) | (45 << 8)), 7 * 60 + 45);
  assert.equal(timerToMinutes(0), null);
});

test('SQLite-Leser liest die Mühlen-Datenbank vollständig', () => {
  const db = openSqlite(fs.readFileSync(path.join(HERE, '../mock/fixtures/grinder-mock.db')));
  assert.ok(db.tables.includes('grind_log'));
  const grinds = db.rows('grind_log');
  assert.equal(grinds.length, 180);
  assert.equal(grinds[0].grind_id, 1);
  assert.equal(grinds.at(-1).grind_id, 180);
  assert.equal(db.rows('recipe_icons').find((r) => r.recipe_icon_name === 'DoubleCup').recipe_icon_id, 3);
  assert.equal(db.rows('recipe_entries').length, 6); // WITHOUT ROWID
  assert.ok(db.rows('recipe_entries')[1].recipe_gbs_data instanceof Uint8Array);
  assert.equal(grinds.filter((g) => g.grind_debug_data && g.grind_debug_data.length === 2000).length > 0, true); // Überlaufseiten
  assert.throws(() => openSqlite(Buffer.from('kein sqlite')));
});

test('ZIP lesen (wie im Browser: DecompressionStream)', async () => {
  const zip = makeZip({ 'a.csv': Buffer.from('x,y\n1,2\n'), 'b.txt': Buffer.alloc(5000, 65) });
  const files = await unzip(zip);
  assert.equal(new TextDecoder().decode(files['a.csv']), 'x,y\n1,2\n');
  assert.equal(files['b.txt'].length, 5000);
});

test('Versionsvergleich und Update-Dateien', async () => {
  assert.equal(compareVersions('2.1.0', '2.2.0'), -1);
  assert.equal(compareVersions('v2.2.0', '2.2.0'), 0);
  assert.equal(compareVersions('2.10.0', '2.9.1'), 1);
  assert.equal(helperAlive({ at: Date.now() - 10e3 }), true);
  assert.equal(helperAlive({ at: Date.now() - 120e3 }), false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenia-upd-'));
  try {
    const r = requestUpdate(dir);
    assert.equal(r.requested, true);
    assert.equal(r.job.state, 'queued');
    assert.equal(readUpdate(dir).requested, true);
    resetLatestCache();
    const latest = await fetchLatest({
      version: '2.1.0',
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ tag_name: 'v2.2.0', name: '2.2.0', html_url: 'https://github.com/TimS1998/Xenios/releases/tag/v2.2.0' }) }),
    });
    assert.equal(latest.latest.version, '2.2.0');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    resetLatestCache();
  }
});

test('Tunnel-Token wird aus dem cloudflared-Befehl gelesen, der Befehl bleibt Text', () => {
  const token = Buffer.from(JSON.stringify({ a: 'acct', t: '11111111-1111-1111-1111-111111111111', s: 'secret' })).toString('base64');
  const cmd = `sudo cloudflared service install ${token}`;
  assert.equal(tunnelTokenFromPaste(cmd), token);
  assert.equal(tunnelTokenFromPaste(`docker run cloudflare/cloudflared tunnel run --token ${token}`), token);
  assert.equal(tunnelTokenFromPaste(token), token);
  assert.equal(tunnelTokenFromPaste(''), '');
  assert.equal(tunnelTokenFromPaste('sudo cloudflared service install nicht-der-token'), null);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenios-token-'));
  try {
    requestTunnelToken(dir, token);
    assert.equal(fs.readFileSync(tunnelTokenFile(dir), 'utf8'), `${token}\n`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Token übernehmen wartet, bis das Host-Skript die Datei löscht', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenios-token-wait-'));
  const token = Buffer.from(JSON.stringify({ a: 'acct', t: '11111111-1111-1111-1111-111111111111', s: 'secret' })).toString('base64');
  try {
    requestTunnelToken(dir, token);
    setTimeout(() => fs.rmSync(tunnelTokenFile(dir)), 50);
    assert.equal(await waitForTunnelApplied(dir, { timeoutMs: 1000, intervalMs: 20 }), true);
    requestTunnelToken(dir, token);
    assert.equal(await waitForTunnelApplied(dir, { timeoutMs: 80, intervalMs: 20 }), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Selbstsigniertes Zertifikat ist gültig und enthält IPs', () => {
  const { cert } = createSelfSignedCert({ ips: ['192.168.178.20'], dnsNames: ['xenia.local'] });
  const x = new crypto.X509Certificate(cert);
  assert.ok(x.verify(x.publicKey));
  assert.equal(x.checkIP('192.168.178.20'), '192.168.178.20');
  assert.equal(x.checkHost('xenia.local'), 'xenia.local');
  assert.ok(new Date(x.validTo) > new Date(Date.now() + 365 * 86400e3));
});

test('Sicherung: ZIP packen und wieder lesen', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenios-bak-'));
  try {
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ logLevel: 'warn', dataDir: '.' }) + '\n');
    fs.writeFileSync(path.join(dir, 'shots.json'), JSON.stringify({ shots: [{ id: 's1' }] }));
    fs.writeFileSync(path.join(dir, 'secret.key'), 'test-key\n');
    const { buffer, filename } = packBackup({ configFile: path.join(dir, 'config.json'), dataDir: dir, version: '2.1.0' });
    assert.match(filename, /^xenios-\d{4}-\d{2}-\d{2}\.zip$/);
    const parsed = await readBackup(buffer);
    assert.equal(parsed.manifest.kind, 'xenios-backup');
    assert.equal(parsed.manifest.app, '2.1.0');
    assert.equal(parsed.config.logLevel, 'warn');
    assert.ok(parsed.files['secret.key']);
    assert.match(parsed.files['shots.json'].toString('utf8'), /s1/);
    await assert.rejects(() => readBackup(Buffer.from('kein zip')), /Sicherung|ZIP/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
