// Cloudflare-Tunnel-Token aus dem Einrichten-Dialog.
// Der Befehl „cloudflared service install <Token>“ wird nicht ausgeführt;
// daraus wird nur der Token gelesen und vom Host-Skript in die Docker-Umgebung geschrieben.
import fs from 'node:fs';
import path from 'node:path';

const TOKEN_RE = /^[A-Za-z0-9+/=_-]{40,}$/;

export function tunnelTokenFile(dataDir) {
  return path.join(dataDir, 'tunnel.token');
}

// Leerer Text → '' (nichts eintragen). Unbrauchbarer Text → null.
export function tunnelTokenFromPaste(raw) {
  const text = String(raw ?? '').replace(/\r/g, '').trim();
  if (!text) return '';
  const marked = text.match(/(?:service\s+install|--token(?:=|\s+))\s*['"]?([A-Za-z0-9+/=_-]+)['"]?/i);
  const token = marked ? marked[1] : (/\s/.test(text) ? '' : text);
  if (!TOKEN_RE.test(token)) return null;
  let json;
  try {
    json = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
  } catch {
    return null;
  }
  if (!json || typeof json.a !== 'string' || typeof json.t !== 'string' || typeof json.s !== 'string') return null;
  if (!json.a || !json.t || !json.s) return null;
  return token;
}

export function requestTunnelToken(dataDir, token) {
  const file = tunnelTokenFile(dataDir);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, `${token}\n`, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* Windows kennt die Modi nur eingeschränkt */ }
}
