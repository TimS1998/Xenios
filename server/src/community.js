// Profile aus der Community von visualizer.coffee: Suche und Abruf über den Server.
// Zwischenspeicher, weil Visualizer ausführliche Abfragen auf etwa 10 pro Minute begrenzt; nur dieser eine Host.
import { summarize, profileFromShot } from '../web/shared/visualizer.js';
import { targetCurve } from '../web/shared/shot-analysis.js';
import { httpError } from './machine.js';

const BASE = 'https://visualizer.coffee';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function communityRoutes(route, { version = '', fetchImpl = (...a) => globalThis.fetch(...a) } = {}) {
  const cache = new Map(); // URL → { at, data }

  async function get(path, ttlMs) {
    const url = BASE + path;
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < ttlMs) return hit.data;
    let res;
    try {
      res = await fetchImpl(url, {
        headers: { Accept: 'application/json', 'User-Agent': `Xenios/${version} (+https://github.com/TimS1998/Xenios)` },
        redirect: 'error',
        signal: AbortSignal.timeout(12000),
      });
    } catch (e) {
      const why = e.name === 'TimeoutError' ? 'Zeitüberschreitung' : e.cause?.code || e.message;
      throw httpError(502, `visualizer.coffee nicht erreichbar (${why})`);
    }
    if (res.status === 429) throw httpError(429, 'visualizer.coffee bremst gerade (zu viele Anfragen). Bitte eine Minute warten.');
    if (res.status === 404) throw httpError(404, 'Auf visualizer.coffee nicht gefunden');
    if (!res.ok) throw httpError(502, `visualizer.coffee antwortet mit HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > 3e6) throw httpError(502, 'Antwort von visualizer.coffee zu groß');
    let data;
    try { data = JSON.parse(text); } catch { throw httpError(502, 'Unerwartete Antwort von visualizer.coffee'); }
    cache.set(url, { at: Date.now(), data });
    if (cache.size > 100) cache.delete(cache.keys().next().value);
    return data;
  }

  // Suche: Profilname, Röster, Bohne, Mindestbewertung (0–100), Seite
  route('GET', '/api/community/shots', async ({ query }) => {
    const page = Math.min(50, Math.max(1, Math.round(Number(query.get('page')) || 1)));
    const q = new URLSearchParams({ items: '20', page: String(page), full: 'true' });
    for (const [key, param] of [['profile', 'profile_title'], ['roaster', 'bean_brand'], ['bean', 'bean_type']]) {
      const v = String(query.get(key) || '').trim().slice(0, 60);
      if (v) q.set(param, v);
    }
    const min = Math.round(Number(query.get('min')) || 0);
    if (min > 0 && min <= 100) q.set('min_enjoyment', String(min));
    const r = await get(`/api/shots?${q}`, 10 * 60e3);
    const items = (Array.isArray(r?.data) ? r.data : []).map(summarize);
    return { items, page, more: items.length === 20 };
  });

  // Ein Bezug als Profil für die Xenia: Druckstufen aus dem gemessenen Verlauf, Vorschau, Eckdaten
  route('GET', '/api/community/shots/:id', async ({ params }) => {
    if (!UUID.test(params.id)) throw httpError(400, 'Ungültige ID');
    const shot = await get(`/api/shots/${params.id}`, 60 * 60e3);
    const p = profileFromShot(shot);
    if (!p) throw httpError(422, 'Dieser Bezug hat keinen Druckverlauf');
    // Link nur aus der geprüften ID, nie aus der Antwort
    return { ...p, info: { ...p.info, id: params.id, url: `${BASE}/shots/${params.id}` }, target: targetCurve(p.steps) };
  });
}
