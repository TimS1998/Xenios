// Versionsvergleich und der Austausch mit dem Host-Update-Dienst (install.sh --apply-requested).
// Die App schreibt nur Dateien unter dataDir; das Skript auf dem Rechner holt Image/Git und startet neu.
import fs from 'node:fs';
import path from 'node:path';

export const GITHUB_REPO = 'TimS1998/Xenios';
const HELPER_MAX_AGE_MS = 90e3;
const cache = { at: 0, latest: null, error: null };

export function compareVersions(a, b) {
  const pa = parts(a);
  const pb = parts(b);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

function parts(v) {
  return String(v || '').replace(/^v/i, '').split(/[.+-]/).map((x) => {
    const n = parseInt(x, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

export function helperAlive(helper, now = Date.now()) {
  const at = Number(helper?.at);
  return Boolean(at && now - at < HELPER_MAX_AGE_MS);
}

export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj) + '\n');
}

export function updatePaths(dataDir) {
  return {
    request: path.join(dataDir, 'update.request'),
    status: path.join(dataDir, 'update.json'),
    helper: path.join(dataDir, 'update-helper.json'),
  };
}

export function readUpdate(dataDir) {
  const p = updatePaths(dataDir);
  const helper = readJson(p.helper);
  const job = readJson(p.status);
  const requested = fs.existsSync(p.request);
  return {
    helper: helper && { at: helper.at, host: helper.host || null },
    job: job && { state: job.state || null, at: job.at || null, version: job.version || null, error: job.error || null },
    requested,
    helperAlive: helperAlive(helper),
  };
}

export function requestUpdate(dataDir) {
  const p = updatePaths(dataDir);
  const at = Date.now();
  writeJson(p.request, { at });
  writeJson(p.status, { state: 'queued', at });
  return readUpdate(dataDir);
}

export async function fetchLatest({ version = '', fetchImpl = globalThis.fetch, ttlMs = 300e3 } = {}) {
  const useCache = fetchImpl === globalThis.fetch;
  if (useCache && cache.at && Date.now() - cache.at < ttlMs) return { latest: cache.latest, error: cache.error };
  let latest = null;
  let error = null;
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `Xenios/${version} (+https://github.com/${GITHUB_REPO})`,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404) {
      latest = null;
    } else if (!res.ok) {
      error = res.status === 403 ? 'GitHub bremst gerade' : `GitHub antwortet HTTP ${res.status}`;
    } else {
      const data = await res.json();
      const tag = String(data.tag_name || '').replace(/^v/i, '');
      if (tag) latest = { version: tag, name: data.name || tag, url: data.html_url || `https://github.com/${GITHUB_REPO}/releases` };
    }
  } catch (e) {
    error = e.name === 'TimeoutError' ? 'GitHub antwortet nicht' : (e.cause?.code || e.message);
  }
  if (useCache) {
    cache.at = Date.now();
    cache.latest = latest;
    cache.error = error;
  }
  return { latest, error };
}

export function resetLatestCache() {
  cache.at = 0;
  cache.latest = null;
  cache.error = null;
}

export async function updateInfo({ dataDir, version, fetchImpl }) {
  const local = readUpdate(dataDir);
  const { latest, error } = await fetchLatest({ version, fetchImpl });
  const newer = latest?.version ? compareVersions(version, latest.version) < 0 : false;
  return {
    current: version,
    latest: latest?.version || null,
    latestName: latest?.name || null,
    latestUrl: latest?.url || null,
    latestError: error,
    newer,
    helper: local.helperAlive,
    helperAt: local.helper?.at || null,
    requested: local.requested,
    job: local.job,
  };
}
