// API-Routen für Maschine und Mühle – gemeinsam für den Server und den Direkt-Modus der Android-App.
// Downloads geben { download: { data, filename, type } } zurück; Server bzw. App liefern die Datei aus.
import { SCRIPT_OPS, BUILTIN_SCRIPTS, httpError } from './machine-core.js';

// Nur lesende Original-Endpunkte (für Diagnose). Gefährliche GETs sind hier bewusst nicht enthalten.
export const RAW_READ = ['status', 'overview', 'overview_single', 'diagram/get', 'general', 'machine', 'info', 'switches', 'scriptslist', 'timer2', 'network', 'mako', 'language', 'brewgroup/pid', 'brewboiler/pid', 'pump/pid', 'steamboiler/pid', 'mahlkonig/get', 'upload/status'];

export function intParam(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 999) throw httpError(400, 'Ungültige ID');
  return n;
}

const enc = (s) => new TextEncoder().encode(s);

export function deviceRoutes(route, { machine, grinder, cfg }) {
  route('GET', '/api/shots', async () => ({ shots: machine.shots(500, { curves: 20 }), total: machine.history.data.shots.length, beans: machine.listBeans() }));
  route('GET', '/api/shots/:id', async ({ params }) => machine.shotDetail(params.id));
  route('PUT', '/api/shots/:id/notes', async ({ params, body }) => machine.annotateShot(params.id, body));
  route('GET', '/api/beans', async () => ({ beans: machine.listBeans() }));
  route('POST', '/api/beans', async ({ body }) => machine.saveBean({ name: body.name, roaster: body.roaster }));
  route('PUT', '/api/beans', async ({ body }) => machine.saveBean({ name: body.name, roaster: body.roaster, rename: body.rename }));
  route('DELETE', '/api/beans/:name', async ({ params }) => machine.deleteBean(params.name));
  route('GET', '/api/maintenance', async () => machine.maintenance());
  route('PUT', '/api/maintenance', async ({ body }) => machine.setMaintenance(body));
  route('POST', '/api/maintenance/backflush', async () => machine.markBackflush());
  route('GET', '/api/shots.csv', async () => ({ download: { data: enc(machine.shotsCsv()), filename: `Xenia-Bezuege-${new Date().toISOString().slice(0, 10)}.csv`, type: 'text/csv; charset=utf-8' } }));

  // Maschine
  route('POST', '/api/machine/power', async ({ body }) => machine.power(body.mode, body.steam));
  route('POST', '/api/machine/steam', async ({ body }) => machine.steam(Boolean(body.on)));
  route('POST', '/api/machine/temperature', async ({ body }) => machine.setTemperature(body.group, body.boiler));
  route('GET', '/api/machine/settings', async () => ({ settings: await machine.client.get('/api/v2/general') }));
  route('POST', '/api/machine/settings', async ({ body }) => machine.updateSettings(body.changes || {}));
  route('GET', '/api/machine/scripts', async () => ({ scripts: await machine.scripts(), ops: SCRIPT_OPS, builtin: BUILTIN_SCRIPTS }));
  route('GET', '/api/machine/scripts/:id', async ({ params }) => machine.readScript(intParam(params.id)));
  route('GET', '/api/machine/scripts/:id/export', async ({ params }) => {
    const { title, file } = await machine.exportScript(intParam(params.id));
    const safe = title.replace(/[^A-Za-z0-9\-_# ]/g, '_');
    return { download: { data: enc(file), filename: `Xenia-${safe}.script`, type: 'application/json; charset=utf-8' } };
  });
  route('POST', '/api/machine/scripts/import', async ({ body }) => machine.importScript(body.file, { name: body.name, kind: body.kind }));
  route('POST', '/api/machine/scripts/stop', async () => machine.stopScript());
  route('POST', '/api/machine/scripts/:id/run', async ({ params }) => machine.runScript(intParam(params.id)));
  route('POST', '/api/machine/scripts', async ({ body }) => machine.saveScript({ name: body.name, steps: body.steps, kind: body.kind }));
  route('PUT', '/api/machine/scripts/:id', async ({ params, body }) => machine.saveScript({ id: intParam(params.id), name: body.name, steps: body.steps, kind: body.kind }));
  route('DELETE', '/api/machine/scripts/:id', async ({ params }) => machine.deleteScript(intParam(params.id)));
  route('GET', '/api/machine/switches', async () => machine.switches());
  route('PUT', '/api/machine/switches', async ({ body }) => machine.setSwitches({ singleDoseG: body.singleDoseG, doubleDoseG: body.doubleDoseG, buttons: body.buttons }));
  route('GET', '/api/machine/timers', async () => machine.timers());
  route('PUT', '/api/machine/timers', async ({ body }) => machine.saveTimers(body));
  route('POST', '/api/machine/clock/sync', async ({ body }) => machine.syncClock(body.tz));
  route('GET', '/api/machine/timezones', async () => machine.timezones());
  route('GET', '/api/machine/paddle', async () => machine.paddleState());
  route('POST', '/api/machine/paddle', async ({ body }) => machine.paddlePower(body.level));
  route('POST', '/api/machine/paddle/stop', async () => machine.paddleStop());
  route('GET', '/api/machine/details', async () => machine.details());
  route('GET', '/api/raw/machine/(.+)', async ({ rawMatch }) => {
    const name = rawMatch[1];
    if (!RAW_READ.includes(name)) throw httpError(403, 'Dieser Endpunkt ist nicht freigegeben');
    return machine.client.get(`/api/v2/${name}`);
  });

  // Mühle
  route('GET', '/api/grinder', async () => grinder.snapshot());
  route('POST', '/api/grinder/refresh', async () => {
    await grinder.sync();
    return grinder.snapshot();
  });
  route('GET', '/api/grinder/logs.zip', async () => {
    const { buffer, filename } = await grinder.downloadLogs();
    return { download: { data: buffer, filename, type: 'application/zip' } };
  });
  route('GET', '/api/grinder/grinds.csv', async () => {
    const { files } = await grinder.downloadLogs();
    const name = Object.keys(files).find((n) => /GrindLogs/i.test(n));
    if (!name) throw httpError(404, 'Keine Mahl-Logs gefunden');
    return { download: { data: files[name], filename: name, type: 'text/csv; charset=utf-8' } };
  });
  route('GET', '/api/grinder/database', async () => {
    if (!cfg.grinder.allowDatabaseDownload) throw httpError(403, 'Datenbank-Download ist deaktiviert (enthält WLAN-Passwort). In config.json grinder.allowDatabaseDownload = true setzen.');
    const { buffer, filename } = await grinder.downloadDatabase();
    return { download: { data: buffer, filename, type: 'application/octet-stream' } };
  });
}

// Einfacher Router: Muster mit :param oder Regex-Gruppen.
export function createRouter() {
  const routes = [];
  const route = (method, pattern, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, handler, auth: opts.auth !== false });
  };
  const match = (method, path) => {
    const r = routes.find((x) => x.method === method && x.re.test(path));
    if (!r) return { exists: routes.some((x) => x.re.test(path)) };
    const m = r.re.exec(path);
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    return { route: r, params, rawMatch: m };
  };
  return { route, match };
}
