// Selbstsigniertes TLS-Zertifikat (ECDSA P-256) ohne OpenSSL: minimaler DER/ASN.1-Bau.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function derLen(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const der = (tag, ...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), derLen(body.length), body]);
};
const seq = (...p) => der(0x30, ...p);
const set = (...p) => der(0x31, ...p);
function oid(str) {
  const nums = str.split('.').map(Number);
  const bytes = [40 * nums[0] + nums[1]];
  for (const n of nums.slice(2)) {
    const enc = [n & 0x7f];
    let v = n >> 7;
    while (v > 0) {
      enc.unshift((v & 0x7f) | 0x80);
      v >>= 7;
    }
    bytes.push(...enc);
  }
  return der(0x06, Buffer.from(bytes));
}
function integer(buf) {
  let b = Buffer.from(buf);
  while (b.length > 1 && b[0] === 0 && !(b[1] & 0x80)) b = b.subarray(1);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return der(0x02, b);
}
function time(date) {
  const y = date.getUTCFullYear();
  const p = (n) => String(n).padStart(2, '0');
  const s = `${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`;
  return y < 2050 ? der(0x17, Buffer.from(String(y).slice(2) + s)) : der(0x18, Buffer.from(String(y) + s));
}
const utf8 = (s) => der(0x0c, Buffer.from(s, 'utf8'));
const name = (cn) => seq(set(seq(oid('2.5.4.3'), utf8(cn))), set(seq(oid('2.5.4.10'), utf8('Xenios'))));

function ipBytes(ip) {
  if (ip.includes(':')) {
    const [head, tail = ''] = ip.split('::');
    const h = head ? head.split(':') : [];
    const t = tail ? tail.split(':') : [];
    const full = [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
    return Buffer.from(full.flatMap((g) => { const v = parseInt(g || '0', 16); return [v >> 8, v & 0xff]; }));
  }
  return Buffer.from(ip.split('.').map(Number));
}


export function localAddresses() {
  const out = new Set(['127.0.0.1']);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' || a.family === 4) out.add(a.address);
  }
  return [...out];
}

export function createSelfSignedCert({ commonName = 'xenios', dnsNames = [], ips = [], days = 825 } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const now = new Date(Date.now() - 60e3);
  const until = new Date(now.getTime() + days * 86400e3);
  const sigAlg = seq(oid('1.2.840.10045.4.3.2'));
  const altNames = seq(
    ...[...new Set(['localhost', commonName, ...dnsNames])].map((d) => der(0x82, Buffer.from(d))),
    ...[...new Set(ips)].map((ip) => der(0x87, ipBytes(ip))),
  );
  const extensions = der(0xa3, seq(
    seq(oid('2.5.29.19'), der(0x01, Buffer.from([0xff])), der(0x04, seq())),
    seq(oid('2.5.29.15'), der(0x01, Buffer.from([0xff])), der(0x04, der(0x03, Buffer.from([0x07, 0x80])))),
    seq(oid('2.5.29.37'), der(0x04, seq(oid('1.3.6.1.5.5.7.3.1')))),
    seq(oid('2.5.29.17'), der(0x04, altNames)),
  ));
  const tbs = seq(
    der(0xa0, integer(Buffer.from([2]))),
    integer(crypto.randomBytes(16)),
    sigAlg,
    name(commonName),
    seq(time(now), time(until)),
    name(commonName),
    spki,
    extensions,
  );
  const signature = crypto.sign('sha256', tbs, privateKey);
  const cert = seq(tbs, sigAlg, der(0x03, Buffer.concat([Buffer.from([0]), signature])));
  const pem = `-----BEGIN CERTIFICATE-----\n${cert.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
  return { cert: pem, key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}

// Zertifikat erzeugen, wenn es fehlt, bald abläuft oder gewünschte Namen/IPs (hosts) nicht enthält.
export function ensureCert(certFile, keyFile, { hosts = [], force = false } = {}) {
  const names = [...new Set(hosts.map((x) => String(x).trim()).filter(Boolean))];
  if (!force && fs.existsSync(certFile) && fs.existsSync(keyFile)) {
    try {
      const x = new crypto.X509Certificate(fs.readFileSync(certFile));
      const san = x.subjectAltName || '';
      const covered = names.every((n) => san.includes(isIp(n) ? `IP Address:${n}` : `DNS:${n}`));
      if (covered && new Date(x.validTo).getTime() - Date.now() > 14 * 86400e3) return { created: false };
    } catch { /* neu erzeugen */ }
  }
  const { cert, key } = createSelfSignedCert({
    ips: [...localAddresses(), ...names.filter(isIp)],
    dnsNames: [os.hostname(), ...names.filter((n) => !isIp(n))],
  });
  fs.mkdirSync(path.dirname(certFile), { recursive: true });
  fs.writeFileSync(certFile, cert);
  fs.writeFileSync(keyFile, key, { mode: 0o600 });
  return { created: true };
}

export const isIp = (s) => /^(\d{1,3}\.){3}\d{1,3}$/.test(s) || (s.includes(':') && /^[0-9a-f:]+$/i.test(s));

export function certInfo(certFile) {
  try {
    const x = new crypto.X509Certificate(fs.readFileSync(certFile));
    return {
      fingerprint: x.fingerprint256,
      validTo: new Date(x.validTo).toISOString(),
      names: (x.subjectAltName || '').split(', ').map((n) => n.replace(/^(DNS|IP Address):/, '')).filter(Boolean),
    };
  } catch {
    return null;
  }
}

export function certFingerprint(certFile) {
  return certInfo(certFile)?.fingerprint ?? null;
}
