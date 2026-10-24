// HTTP-Hilfen: Sicherheits-Header, JSON, Body-Limit, statische Dateien.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export function securityHeaders(res, { secure }) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}

export function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

export function readJson(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const ct = String(req.headers['content-type'] || '');
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('Anfrage zu groß'), { status: 413, expose: true }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!size) return resolve({});
      if (!ct.includes('application/json')) return reject(Object.assign(new Error('JSON erwartet'), { status: 415, expose: true }));
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Ungültiges JSON'), { status: 400, expose: true }));
      }
    });
    req.on('error', reject);
  });
}

export function makeStatic(rootDir) {
  const cache = new Map();
  function load(file) {
    const st = fs.statSync(file);
    const hit = cache.get(file);
    if (hit && hit.mtime === st.mtimeMs) return hit;
    const buf = fs.readFileSync(file);
    const entry = { buf, mtime: st.mtimeMs, etag: '"' + crypto.createHash('sha1').update(buf).digest('base64url').slice(0, 20) + '"' };
    cache.set(file, entry);
    return entry;
  }
  return function serve(req, res, urlPath) {
    let rel;
    try {
      rel = decodeURIComponent(urlPath);
    } catch {
      return false; // kaputte %-Kodierung → 404
    }
    if (rel.includes('\0')) return false;
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(rootDir, rel));
    if (!file.startsWith(rootDir + path.sep)) return false;
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
    const ext = path.extname(file).toLowerCase();
    const { buf, etag } = load(file);
    // App-Code immer per ETag nachprüfen (304 ist billig), sonst sehen Browser/Cloudflare tagelang alte Versionen.
    const noCache = ['.html', '.webmanifest', '.js', '.mjs', '.css'].includes(ext);
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': noCache ? 'no-cache' : 'public, max-age=86400',
      ETag: etag,
    };
    if (rel === '/sw.js') headers['Service-Worker-Allowed'] = '/';
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      res.end();
      return true;
    }
    headers['Content-Length'] = buf.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : buf);
    return true;
  };
}
