// Mühle (Mahlkönig E64 WS): Status, Statistik, Rezepte, Mahlvorgänge, Bezüge (Grind-by-Sync), Meldungen, Downloads.
import { h, icon, fmt, fmtInt, snackbar, ago, dateTime } from '../ui.js';
import { api, store, subscribe } from '../api.js';
import { setTopActions } from '../app.js';

export const TYPE_DE = { SingleShot: 'Einfach', DoubleShot: 'Doppelt', Custom: 'Eigenes', Filter: 'Filter', SingleLongShot: 'Einfach lang', DoubleLongShot: 'Doppelt lang' };
const MODE_DE = { ByWeight: 'nach Gewicht (GbW)', ByTime: 'nach Zeit (GbT)', Manually: 'manuell' };
export const TRIGGER_DE = { StartButton: 'Starttaste', PortafilterDetection: 'Siebträger erkannt', PortafilterSwitch: 'Siebträger-Schalter' };
const ALERT_DE = {
  HopperNotMounted: 'Bohnenbehälter nicht aufgesetzt', InternetConnectionFailed: 'Keine Internetverbindung', EspAliveFailed: 'Interner Funkchip antwortet nicht',
  LoadCellCalibrationReminder: 'Waage bitte neu kalibrieren', NewFirmwareUpdateAvailable: 'Firmware-Update verfügbar', BrewEventIgnoredForGbs: 'Bezug für Grind-by-Sync ignoriert',
};

export function grinderView(root) {
  const box = h('div', {});
  root.append(box);
  const refreshBtn = h('button', { class: 'icon-btn', 'aria-label': 'Aktualisieren', onclick: refresh }, icon('refresh'));
  setTopActions(refreshBtn);

  async function refresh() {
    refreshBtn.disabled = true;
    try {
      store.grinder = await api('/api/grinder/refresh', { method: 'POST' });
      paint();
      snackbar('Mühle aktualisiert');
    } catch (e) {
      snackbar(e.message);
    } finally {
      refreshBtn.disabled = false;
    }
  }

  function paint() {
    const g = store.grinder;
    if (!g) return box.replaceChildren(h('div', { class: 'empty' }, 'Lade …'));
    if (!g.enabled) return box.replaceChildren(h('div', { class: 'empty' }, 'Die Mühle ist in der Server-Konfiguration deaktiviert.'));
    const s = g.stats;
    const parts = [];
    parts.push(h('div', { class: 'card low row' },
      icon('grinder'),
      h('div', { class: 'grow' },
        h('div', {}, h('strong', {}, g.info?.typeName || 'Mahlkönig'), ' ', g.online ? h('span', { class: 'badge ok' }, 'online') : h('span', { class: 'badge bad' }, 'offline')),
        h('div', { class: 'small muted' }, [g.settings?.welcomeName, g.wifi?.ip, g.lastSync ? `Stand ${ago(g.lastSync)}` : null].filter(Boolean).join(' · '))),
    ));
    if (g.error) parts.push(h('div', { class: 'offline-banner' }, icon('warn', 's20'), h('span', {}, g.error)));

    if (s) {
      parts.push(h('div', { class: 'tiles' },
        tile('Heute', fmtInt(s.today), 'Mahlvorg.'),
        tile('Heute', fmt(s.todayCoffeeG, 0), 'g'),
        tile('Ø Abweichung', s.avgDeviationG === null ? '–' : fmt(s.avgDeviationG, 2), 'g'),
        tile('Gesamt', fmtInt(s.successful), 'Mahlvorg.'),
        tile('Kaffee', fmt(s.totalCoffeeG / 1000, 2), 'kg'),
        tile('Abbrüche', fmtInt(s.totalGrinds - s.successful), '')));
    }

    const active = (g.recipes || []).filter((r) => r.active);
    if (active.length) {
      parts.push(h('div', { class: 'section-title' }, 'Rezepte'));
      parts.push(h('div', { class: 'list' }, active.map((r) => h('div', { class: 'list-item' },
        h('span', { class: 'lead' }, h('strong', {}, String(r.index))),
        h('div', { class: 'grow' },
          h('div', { class: 'title' }, `${TYPE_DE[r.type] || r.type || 'Rezept'} · ${r.mode === 'ByWeight' ? `${fmt(r.amount / 1000)} g` : r.mode === 'ByTime' ? `${fmt(r.amount / 1000)} s` : ''}`),
          h('div', { class: 'sub' }, `Mahlgrad ${fmtInt(r.coarseness)} · ${MODE_DE[r.mode] || ''}${r.brewTimeMs ? ` · Ziel ${fmt(r.brewTimeMs / 1000, 0)} s` : ''}${r.brewWeightG ? ` / ${fmt(r.brewWeightG, 0)} g` : ''}`)),
        r.gbs ? h('span', { class: 'badge' }, 'GbS') : null,
        r.selected ? h('span', { class: 'badge ok' }, 'aktiv') : null))));
    }

    const alerts = (g.alerts || []).filter((a) => a.active);
    if (alerts.length) {
      parts.push(h('div', { class: 'section-title' }, 'Meldungen'));
      parts.push(h('div', { class: 'list' }, alerts.map((a) => h('div', { class: 'list-item' }, h('span', { class: 'lead' }, icon('warn')), h('div', { class: 'grow' }, h('div', { class: 'title' }, ALERT_DE[a.type] || a.type), h('div', { class: 'sub' }, dateTime(a.at)))))));
    }

    if (g.grinds?.length) {
      parts.push(h('div', { class: 'section-title' }, 'Letzte Mahlvorgänge'));
      parts.push(h('div', { class: 'list' }, g.grinds.slice(0, 15).map((x) => {
        const pct = x.targetG && x.weightG ? Math.min(100, (x.weightG / x.targetG) * 100) : 0;
        return h('div', { class: 'grind' },
          h('div', {}, h('strong', {}, `${TYPE_DE[x.type] || 'Rezept ' + x.recipe}`), x.gbs ? h('span', { class: 'badge', style: { 'margin-left': '6px' } }, 'GbS') : null, x.success ? null : h('span', { class: 'badge bad', style: { 'margin-left': '6px' } }, 'abgebrochen')),
          h('div', { class: 'w' }, x.weightG ? `${fmt(x.weightG)} g` : '–', x.targetG ? h('span', { class: 'muted small' }, ` / ${fmt(x.targetG)}`) : null),
          h('div', { class: 'meta' }, `${dateTime(x.at)} · ${fmt(x.durationMs / 1000)} s · ${TRIGGER_DE[x.trigger] || x.trigger}`),
          h('div', { class: 'meta', style: { 'text-align': 'right' } }, x.ddd != null ? `${fmtInt(x.ddd)} µm` : ''),
          x.targetG ? h('div', { class: 'bar' }, h('i', { style: { width: `${pct}%` } })) : null);
      })));
    }

    if (g.brews?.length) {
      parts.push(h('div', { class: 'section-title' }, 'Bezüge (Grind-by-Sync)'));
      parts.push(h('div', { class: 'card low' }, h('dl', { class: 'kv' }, g.brews.slice(0, 8).flatMap((b) => [
        h('dt', {}, b.at ? dateTime(b.at) : `Mahlvorgang ${b.grindId}`),
        h('dd', {}, `${fmt(b.durationMs / 1000)} s${b.massG ? ` · ${fmt(b.massG)} g` : ''}${b.valid ? '' : ' (ungültig)'}`),
      ]))));
    }

    if (g.settings?.coffeeMachine) {
      const c = g.settings.coffeeMachine;
      parts.push(h('div', { class: 'section-title' }, 'Kopplung'));
      parts.push(h('div', { class: 'card low' }, h('dl', { class: 'kv' },
        h('dt', {}, 'Maschine'), h('dd', {}, `${c.manufacturer || '–'} @ ${c.host || '–'}`),
        h('dt', {}, 'Abfrage'), h('dd', {}, c.pollIntervalMs ? `alle ${fmt(c.pollIntervalMs / 1000, 0)} s` : '–'),
        h('dt', {}, 'Letzte Waagen-Kalibrierung'), h('dd', {}, g.settings.lastGbwCalibration || '–'),
        h('dt', {}, 'Zeitzone'), h('dd', {}, g.settings.timezone || '–'))));
    }

    parts.push(h('div', { class: 'section-title' }, 'Downloads'));
    parts.push(h('div', { class: 'list' },
      dl('Mahl-Log (CSV)', '/api/grinder/grinds.csv'),
      dl('Maschinen-Logs (ZIP)', '/api/grinder/logs.zip'),
      store.server?.grinder?.databaseDownload ? dl('Datenbank (SQLite, enthält WLAN-Passwort!)', '/api/grinder/database') : null));
    box.replaceChildren(...parts);
  }

  paint();
  const un = subscribe((part) => { if (part === 'grinder' || part === 'all') paint(); });
  return () => un();
}

function tile(k, v, u) {
  return h('div', { class: 'tile' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v, u ? h('span', { class: 'u' }, ' ' + u) : null));
}
function dl(label, href) {
  return h('a', { class: 'list-item clickable', href, download: '', style: { 'text-decoration': 'none', color: 'inherit' } }, h('span', { class: 'lead' }, icon('download')), h('span', { class: 'grow title' }, label));
}
