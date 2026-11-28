// Mühle (Mahlkönig E64 WS): Status, Statistik, Rezepte, Mahlvorgänge, Bezüge (Grind-by-Sync), Meldungen, Downloads.
import { h, icon, fmt, fmtInt, snackbar, ago, dateTime } from '../ui.js';
import { api, store, subscribe } from '../api.js';
import { setTopActions } from '../app.js';
import { t } from '../../shared/i18n.js';

// Bezeichnungen zu den Werten der Mühle, erst beim Lesen nachgeschlagen (Sprache); Namen bleiben für bestehende Nutzer
export const TYPE_DE = {
  get SingleShot() { return t('shots.grinder.type.singleShot'); },
  get DoubleShot() { return t('shots.grinder.type.doubleShot'); },
  get Custom() { return t('shots.grinder.type.custom'); },
  get Filter() { return t('shots.grinder.type.filter'); },
  get SingleLongShot() { return t('shots.grinder.type.singleLongShot'); },
  get DoubleLongShot() { return t('shots.grinder.type.doubleLongShot'); },
};
const MODE_DE = {
  get ByWeight() { return t('shots.grinder.mode.byWeight'); },
  get ByTime() { return t('shots.grinder.mode.byTime'); },
  get Manually() { return t('shots.grinder.mode.manually'); },
};
export const TRIGGER_DE = {
  get StartButton() { return t('shots.grinder.trigger.startButton'); },
  get PortafilterDetection() { return t('shots.grinder.trigger.portafilterDetection'); },
  get PortafilterSwitch() { return t('shots.grinder.trigger.portafilterSwitch'); },
};
const ALERT_DE = {
  get HopperNotMounted() { return t('shots.grinder.alert.hopperNotMounted'); },
  get InternetConnectionFailed() { return t('shots.grinder.alert.internetConnectionFailed'); },
  get EspAliveFailed() { return t('shots.grinder.alert.espAliveFailed'); },
  get LoadCellCalibrationReminder() { return t('shots.grinder.alert.loadCellCalibrationReminder'); },
  get NewFirmwareUpdateAvailable() { return t('shots.grinder.alert.newFirmwareUpdateAvailable'); },
  get BrewEventIgnoredForGbs() { return t('shots.grinder.alert.brewEventIgnoredForGbs'); },
};

export function grinderView(root) {
  const box = h('div', {});
  root.append(box);
  const refreshBtn = h('button', { class: 'icon-btn', 'aria-label': t('shots.grinder.refresh'), onclick: refresh }, icon('refresh'));
  setTopActions(refreshBtn);

  async function refresh() {
    refreshBtn.disabled = true;
    try {
      store.grinder = await api('/api/grinder/refresh', { method: 'POST' });
      paint();
      snackbar(t('shots.grinder.refreshed'));
    } catch (e) {
      snackbar(e.message);
    } finally {
      refreshBtn.disabled = false;
    }
  }

  function paint() {
    const g = store.grinder;
    if (!g) return box.replaceChildren(h('div', { class: 'empty' }, t('shots.common.loading')));
    if (!g.enabled) return box.replaceChildren(h('div', { class: 'empty' }, t('shots.grinder.disabled')));
    const s = g.stats;
    const parts = [];
    parts.push(h('div', { class: 'card low row' },
      icon('grinder'),
      h('div', { class: 'grow' },
        h('div', {}, h('strong', {}, g.info?.typeName || 'Mahlkönig'), ' ', g.online ? h('span', { class: 'badge ok' }, t('shots.grinder.online')) : h('span', { class: 'badge bad' }, t('shots.grinder.offline'))),
        h('div', { class: 'small muted' }, [g.settings?.welcomeName, g.wifi?.ip, g.lastSync ? t('shots.grinder.asOf', { ago: ago(g.lastSync) }) : null].filter(Boolean).join(' · '))),
    ));
    if (g.error) parts.push(h('div', { class: 'offline-banner' }, icon('warn', 's20'), h('span', {}, g.error)));

    if (s) {
      parts.push(h('div', { class: 'tiles' },
        tile(t('shots.grinder.tileToday'), fmtInt(s.today), t('shots.grinder.tileGrinds')),
        tile(t('shots.grinder.tileToday'), fmt(s.todayCoffeeG, 0), 'g'),
        tile(t('shots.grinder.tileAvgDeviation'), s.avgDeviationG === null ? '–' : fmt(s.avgDeviationG, 2), 'g'),
        tile(t('shots.grinder.tileTotal'), fmtInt(s.successful), t('shots.grinder.tileGrinds')),
        tile(t('shots.grinder.tileCoffee'), fmt(s.totalCoffeeG / 1000, 2), 'kg'),
        tile(t('shots.grinder.tileAborted'), fmtInt(s.totalGrinds - s.successful), '')));
    }

    const active = (g.recipes || []).filter((r) => r.active);
    if (active.length) {
      parts.push(h('div', { class: 'section-title' }, t('shots.grinder.recipes')));
      parts.push(h('div', { class: 'list' }, active.map((r) => h('div', { class: 'list-item' },
        h('span', { class: 'lead' }, h('strong', {}, String(r.index))),
        h('div', { class: 'grow' },
          h('div', { class: 'title' }, `${TYPE_DE[r.type] || r.type || t('shots.grinder.recipe')} · ${r.mode === 'ByWeight' ? `${fmt(r.amount / 1000)} g` : r.mode === 'ByTime' ? `${fmt(r.amount / 1000)} s` : ''}`),
          h('div', { class: 'sub' }, recipeSub(r))),
        r.gbs ? h('span', { class: 'badge' }, 'GbS') : null,
        r.selected ? h('span', { class: 'badge ok' }, t('shots.grinder.active')) : null))));
    }

    const alerts = (g.alerts || []).filter((a) => a.active);
    if (alerts.length) {
      parts.push(h('div', { class: 'section-title' }, t('shots.grinder.alerts')));
      parts.push(h('div', { class: 'list' }, alerts.map((a) => h('div', { class: 'list-item' }, h('span', { class: 'lead' }, icon('warn')), h('div', { class: 'grow' }, h('div', { class: 'title' }, ALERT_DE[a.type] || a.type), h('div', { class: 'sub' }, dateTime(a.at)))))));
    }

    if (g.grinds?.length) {
      parts.push(h('div', { class: 'section-title' }, t('shots.grinder.lastGrinds')));
      parts.push(h('div', { class: 'list' }, g.grinds.slice(0, 15).map((x) => {
        const pct = x.targetG && x.weightG ? Math.min(100, (x.weightG / x.targetG) * 100) : 0;
        return h('div', { class: 'grind' },
          h('div', {}, h('strong', {}, `${TYPE_DE[x.type] || t('shots.grinder.recipeN', { n: x.recipe })}`), x.gbs ? h('span', { class: 'badge', style: { 'margin-left': '6px' } }, 'GbS') : null, x.success ? null : h('span', { class: 'badge bad', style: { 'margin-left': '6px' } }, t('shots.grinder.aborted'))),
          h('div', { class: 'w' }, x.weightG ? `${fmt(x.weightG)} g` : '–', x.targetG ? h('span', { class: 'muted small' }, ` / ${fmt(x.targetG)}`) : null),
          h('div', { class: 'meta' }, `${dateTime(x.at)} · ${fmt(x.durationMs / 1000)} s · ${TRIGGER_DE[x.trigger] || x.trigger}`),
          h('div', { class: 'meta', style: { 'text-align': 'right' } }, x.ddd != null ? `${fmtInt(x.ddd)} µm` : ''),
          x.targetG ? h('div', { class: 'bar' }, h('i', { style: { width: `${pct}%` } })) : null);
      })));
    }

    if (g.brews?.length) {
      parts.push(h('div', { class: 'section-title' }, t('shots.grinder.brews')));
      parts.push(h('div', { class: 'card low' }, h('dl', { class: 'kv' }, g.brews.slice(0, 8).flatMap((b) => [
        h('dt', {}, b.at ? dateTime(b.at) : t('shots.grinder.grindN', { id: b.grindId })),
        h('dd', {}, brewText(b)),
      ]))));
    }

    if (g.settings?.coffeeMachine) {
      const c = g.settings.coffeeMachine;
      parts.push(h('div', { class: 'section-title' }, t('shots.grinder.pairing')));
      parts.push(h('div', { class: 'card low' }, h('dl', { class: 'kv' },
        h('dt', {}, t('shots.grinder.machine')), h('dd', {}, `${c.manufacturer || '–'} @ ${c.host || '–'}`),
        h('dt', {}, t('shots.grinder.poll')), h('dd', {}, c.pollIntervalMs ? t('shots.grinder.pollEvery', { s: fmt(c.pollIntervalMs / 1000, 0) }) : '–'),
        h('dt', {}, t('shots.grinder.lastCalibration')), h('dd', {}, g.settings.lastGbwCalibration || '–'),
        h('dt', {}, t('shots.grinder.timezone')), h('dd', {}, g.settings.timezone || '–'))));
    }

    parts.push(h('div', { class: 'section-title' }, t('shots.grinder.downloads')));
    parts.push(h('div', { class: 'list' },
      dl(t('shots.grinder.dlGrinds'), '/api/grinder/grinds.csv'),
      dl(t('shots.grinder.dlLogs'), '/api/grinder/logs.zip'),
      store.server?.grinder?.databaseDownload ? dl(t('shots.grinder.dlDatabase'), '/api/grinder/database') : null));
    box.replaceChildren(...parts);
  }

  paint();
  const un = subscribe((part) => { if (part === 'grinder' || part === 'all') paint(); });
  return () => un();
}

// Untertitel eines Rezepts: Mahlgrad, Modus, optional Ziel-Bezugszeit und -gewicht
function recipeSub(r) {
  const p = { grind: fmtInt(r.coarseness), mode: MODE_DE[r.mode] || '', time: r.brewTimeMs ? fmt(r.brewTimeMs / 1000, 0) : null, weight: r.brewWeightG ? fmt(r.brewWeightG, 0) : null };
  if (p.time && p.weight) return t('shots.grinder.recipeSubTimeWeight', p);
  if (p.time) return t('shots.grinder.recipeSubTime', p);
  if (p.weight) return t('shots.grinder.recipeSubWeight', p);
  return t('shots.grinder.recipeSub', p);
}

// Bezug laut Mühle: Dauer, optional Gewicht, Hinweis bei ungültigen
function brewText(b) {
  const text = `${fmt(b.durationMs / 1000)} s${b.massG ? ` · ${fmt(b.massG)} g` : ''}`;
  return b.valid ? text : t('shots.grinder.invalid', { text });
}

function tile(k, v, u) {
  return h('div', { class: 'tile' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v, u ? h('span', { class: 'u' }, ' ' + u) : null));
}
function dl(label, href) {
  return h('a', { class: 'list-item clickable', href, download: '', style: { 'text-decoration': 'none', color: 'inherit' } }, h('span', { class: 'lead' }, icon('download')), h('span', { class: 'grow title' }, label));
}
