// Bezugs-Protokoll: alle Bezüge dauerhaft (Server-Datei bzw. App-Speicher), Statistik, Druckkurven, CSV-Export.
import { h, icon, fmt, fmtInt } from '../ui.js';
import { api, subscribe } from '../api.js';
import { sparkline } from '../gauge.js';
import { setTopActions } from '../app.js';

export function shotsView(root) {
  const box = h('div', {}, h('div', { class: 'empty' }, 'Lade Bezüge …'));
  root.append(box);
  setTopActions(h('a', { class: 'icon-btn', href: '/api/shots.csv', download: '', 'aria-label': 'Als CSV exportieren', title: 'Als CSV exportieren' }, icon('download')));
  const open = new Set();
  let lastCount = -1;

  async function load() {
    try {
      const { shots, total } = await api('/api/shots');
      lastCount = total ?? shots.length;
      paint(shots, total ?? shots.length);
    } catch (e) {
      box.replaceChildren(h('div', { class: 'empty' }, e.message));
    }
  }

  function paint(shots, total) {
    if (!shots.length) {
      box.replaceChildren(h('div', { class: 'empty' }, 'Noch keine Bezüge protokolliert. Ab jetzt wird jeder Bezug gespeichert – auch über Neustarts von Maschine und Server hinweg.'));
      return;
    }
    const day = (iso) => new Date(iso).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    const todayKey = new Date().toDateString();
    const weekAgo = Date.now() - 7 * 86400e3;
    const today = shots.filter((s) => new Date(s.endedAt).toDateString() === todayKey).length;
    const week = shots.filter((s) => Date.parse(s.endedAt) >= weekAgo).length;
    const recent = shots.filter((s) => !s.estimated).slice(0, 10);
    const avg = (k) => {
      const v = recent.map((s) => s[k]).filter((x) => Number.isFinite(x) && x > 0);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    const avgTime = avg('timeMs');
    const avgWeight = avg('weight');

    const groups = [];
    for (const s of shots) {
      const key = new Date(s.endedAt).toDateString();
      if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, label: day(s.endedAt), items: [] });
      groups[groups.length - 1].items.push(s);
    }
    box.replaceChildren(
      h('div', { class: 'card' },
        h('div', { class: 'kpis' },
          kpi('Heute', fmtInt(today)), kpi('7 Tage', fmtInt(week)), kpi('Gesamt', fmtInt(total)),
          kpi('Ø Zeit', avgTime ? `${fmt(avgTime / 1000)} s` : '–'), kpi('Ø Gewicht', avgWeight ? `${fmt(avgWeight)} g` : '–')),
        h('p', { class: 'muted small' }, 'Die Liste bleibt auch nach einem Neustart von Maschine oder Server erhalten. Bezüge, die nicht live mitverfolgt werden konnten, erkennt die App am Bezugszähler der Maschine (markiert mit „nachträglich“).')),
      ...groups.flatMap((g) => [
        h('div', { class: 'section-title' }, g.label),
        h('div', { class: 'list' }, g.items.map((s) => shotRow(s))),
      ]),
      total > shots.length ? h('p', { class: 'muted small', style: { 'text-align': 'center' } }, `Angezeigt: die letzten ${shots.length} von ${total}. Alle stehen im CSV-Export.`) : null);
  }

  function shotRow(s) {
    const id = s.endedAt;
    const isOpen = open.has(id);
    const time = new Date(s.endedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const amount = s.weight ? `${fmt(s.weight)} g` : s.volumeMl ? `${fmt(s.volumeMl, 0)} ml` : '–';
    const row = h('div', { class: 'shot-row' },
      h('button', { class: 'list-item clickable', type: 'button', onclick: () => { isOpen ? open.delete(id) : open.add(id); row.replaceWith(shotRow(s)); } },
        h('span', { class: 'lead' }, icon('coffee')),
        h('div', { class: 'grow' },
          h('div', { class: 'title' }, `${time} · ${s.timeMs ? `${fmt(s.timeMs / 1000)} s` : '–'} · ${amount}`),
          h('div', { class: 'sub' },
            s.maxPressure ? `max. ${fmt(s.maxPressure)} bar` : '',
            s.groupTemp ? ` · ${fmt(s.groupTemp)} °C` : '',
            s.no ? ` · Nr. ${fmtInt(s.no)}` : '',
            s.estimated ? h('span', { class: 'badge', style: { 'margin-left': '6px' } }, 'nachträglich') : null)),
        s.curve?.length ? icon(isOpen ? 'less' : 'more', 's20') : null),
      isOpen && s.curve?.length ? h('div', { class: 'shot-curve' }, sparkline(s.curve, { height: 90 }), h('div', { class: 'muted small' }, 'Druck (bar) und Gewicht (g) über die Zeit')) : null);
    return row;
  }

  load();
  // Neuer Bezug → Liste aktualisieren
  const un = subscribe((part, ev) => {
    if (part === 'event' && ev?.topic === 'shot') load();
  });
  return un;
}

function kpi(k, v) {
  return h('div', { class: 'kpi' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v));
}
