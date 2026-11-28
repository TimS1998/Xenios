// Bezugs-Protokoll: alle Bezüge dauerhaft (Server-Datei bzw. App-Speicher), Statistik, Filter, Pflege, CSV-Export.
// Ein Bezug öffnet die Analyse (Kurve mit Vergleich, Kennzahlen, Bewertung).
import { h, icon, fmt, fmtInt, snackbar, sheet, confirmDialog } from '../ui.js';
import { api, subscribe, hasPaddle } from '../api.js';
import { navigate } from '../app.js';
import { isHidden } from '../prefs.js';
import { shotMetrics, dialIn, brewSeconds } from '../../shared/shot-analysis.js';
import { TASTE } from '../../shared/machine-core.js';
import { quickRate, adviceNote } from './shot-detail.js';
import { t, locale } from '../../shared/i18n.js';

// Backflush starten (direkte Pumpensteuerung, auch aus dem Skripte-Tab): erst nachfragen, dann mit Stopp in der Meldung.
// Er trägt sich nach dem Lauf selbst als erledigt ein.
export async function startBackflush() {
  // Ohne direkte Pumpensteuerung (ältere Firmware der alten Xenia) gar nicht erst nachfragen
  if (!hasPaddle()) return snackbar(t('shots.backflush.noPaddle'));
  const content = h('div', {}, h('p', { class: 'muted' }, t('shots.backflush.checkBlank')), h('p', { class: 'muted' }, t('shots.backflush.checkTray')));
  if (!(await confirmDialog(t('shots.backflush.confirmTitle'), content, t('shots.backflush.start')))) return;
  try {
    await api('/api/maintenance/backflush/run', { method: 'POST' });
    snackbar(t('shots.backflush.running'), { action: t('shots.common.stop'), duration: 8000, onAction: stopBackflush });
  } catch (e) {
    snackbar(e.status === 502 ? t('shots.common.startFailed') : e.message);
  }
}

async function stopBackflush() {
  try { await api('/api/maintenance/backflush/stop', { method: 'POST' }); snackbar(t('shots.backflush.stopping')); } catch (e) { snackbar(e.message); }
}

export function shotsView(root) {
  const dial = h('div', {});
  const care = h('div', {});
  const box = h('div', {}, h('div', { class: 'empty' }, t('shots.list.loading')));
  const beansBox = h('div', {});
  root.append(dial, care, beansBox, box);
  // Anlegen steht unter „Bohnen“, der Export als eigene Option darunter – keine unbeschrifteten Knöpfe in der Kopfzeile
  const csvTile = () => h('div', { class: 'list', style: { 'margin-top': '12px', 'margin-bottom': '12px' } }, // gleicher Abstand oben (Bohnen) und unten (Statistik)
    h('a', { class: 'list-item clickable as-button', href: '/api/shots.csv', download: '' },
      h('span', { class: 'lead' }, icon('download')),
      h('div', { class: 'grow' }, h('div', { class: 'title' }, t('shots.list.csvTitle')), h('div', { class: 'sub' }, t('shots.list.csvSub'))),
      icon('right', 's20 muted')));
  let data = { shots: [], total: 0, beans: [] };
  let filter = 'all';
  let bean = '';

  async function load() {
    try {
      const r = await api('/api/shots');
      data = { shots: r.shots, total: r.total ?? r.shots.length, beans: r.beans || [], minShotS: r.minShotS ?? null };
      paint();
      paintDial();
    } catch (e) {
      box.replaceChildren(h('div', { class: 'empty' }, e.message));
    }
    loadCare();
  }

  // Pflege: Backflush-Erinnerung
  async function loadCare() {
    if (isHidden('care')) return care.replaceChildren();
    let m;
    try { m = (await api('/api/maintenance')).backflush; } catch { return care.replaceChildren(); }
    const intervalSel = h('select', { class: 'text small-select', 'aria-label': t('shots.care.reminderAria') },
      [3, 5, 7, 10, 14, 21, 30].map((d) => h('option', { value: d, selected: d === m.intervalDays }, t('shots.care.every', { n: d }))));
    intervalSel.addEventListener('change', async () => {
      try { await api('/api/maintenance', { method: 'PUT', body: { intervalDays: Number(intervalSel.value) } }); loadCare(); } catch (e) { snackbar(e.message); }
    });
    const done = h('button', { class: `btn ${m.due ? 'filled' : 'tonal'}`, onclick: async () => {
      try { await api('/api/maintenance/backflush', { method: 'POST' }); snackbar(t('shots.care.logged')); loadCare(); } catch (e) { snackbar(e.message); }
    } }, icon('check', 's18'), t('shots.care.done'));
    const run = h('button', { class: 'btn text', onclick: startBackflush }, icon('play', 's18'), t('shots.backflush.start'));
    const status = m.lastAt === null ? t('shots.care.never')
      : m.daysSince === 0 ? t('shots.care.sinceLessThanDay', { shots: fmtInt(m.shotsSince) })
        : t('shots.care.since', { n: m.daysSince, days: fmtInt(m.daysSince), shots: fmtInt(m.shotsSince) });
    care.replaceChildren(h('section', { class: `card care ${m.due ? 'due' : ''}` },
      h('div', { class: 'row' },
        icon(m.due ? 'warn' : 'check', 's20'),
        h('div', { class: 'grow' }, h('div', {}, m.due ? t('shots.care.due') : t('shots.care.title')), h('div', { class: 'small muted' }, status)),
        run, done),
      h('div', { class: 'row', style: { 'margin-top': '8px' } }, h('span', { class: 'small muted grow' }, t('shots.care.reminder')), intervalSel)));
  }

  // Einstell-Assistent: letzten Bezug mit einem Tipp bewerten, danach die Empfehlung für den nächsten
  function paintDial() {
    const last = data.shots[0];
    const age = last ? Date.now() - Date.parse(last.endedAt) : Infinity;
    if (!last || age > 24 * 3600e3) return dial.replaceChildren();
    const n = last.notes || {};
    if (!n.taste && !n.strength) {
      if (age > 3 * 3600e3) return dial.replaceChildren();
      const m = shotMetrics(last);
      const facts = [m.timeS !== null ? `${fmt(m.timeS)} s` : null, m.yieldG !== null ? `${fmt(m.yieldG)} g` : null, m.ratio !== null ? `1:${fmt(m.ratio)}` : null].filter(Boolean).join(' · ');
      return dial.replaceChildren(h('section', { class: 'card rate-card' },
        h('div', { class: 'row' }, icon('tune', 's20'), h('div', { class: 'grow' }, h('div', {}, t('shots.rate.askLast')), h('div', { class: 'small muted' }, [new Date(last.endedAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }), facts].filter(Boolean).join(' · ')))),
        h('div', { class: 'chips big-chips' }, Object.entries(TASTE).map(([k, label]) => h('button', { class: 'chip', onclick: () => quickRate(last.id, { taste: k, onChange: load }) }, label)))));
    }
    const a = dialIn(last, data.shots.slice(1));
    dial.replaceChildren(a ? h('section', { class: 'dial-card' }, h('div', { class: 'section-title' }, t('shots.rate.next')), adviceNote(a, last.dose?.recipe)) : null);
  }

  function paint() {
    const { shots, total } = data;
    if (!shots.length) {
      paintBeans(data.beans || []);
      box.replaceChildren(h('div', { class: 'empty' }, t('shots.list.empty')));
      return;
    }
    const day = (iso) => new Date(iso).toLocaleDateString(locale(), { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    const todayKey = new Date().toDateString();
    const weekAgo = Date.now() - 7 * 86400e3;
    const today = shots.filter((s) => new Date(s.endedAt).toDateString() === todayKey).length;
    const week = shots.filter((s) => Date.parse(s.endedAt) >= weekAgo).length;
    const recent = shots.filter((s) => !s.estimated).slice(0, 10);
    const avg = (f) => {
      const v = recent.map(f).filter((x) => Number.isFinite(x) && x > 0);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    const avgTime = avg((s) => (brewSeconds(s) || 0) * 1000); // Bezugszeit ohne Vorbrühen
    const avgRatio = avg((s) => shotMetrics(s).ratio);

    const beans = data.beans?.length ? data.beans : [...new Set(shots.map((s) => s.notes?.bean).filter(Boolean))].map((n) => ({ name: n }));
    const visible = shots.filter((s) => (filter === 'rated' ? s.notes?.rating || s.notes?.taste : filter === 'ref' ? s.notes?.reference : true) && (!bean || s.notes?.bean === bean));
    const chip = (key, label) => h('button', { class: 'chip', 'aria-pressed': String(filter === key), onclick: () => { filter = key; paint(); } }, label);
    const beanSel = beans.length ? h('select', { class: 'text small-select', 'aria-label': t('shots.list.beanAria') },
      h('option', { value: '' }, t('shots.list.allBeans')), beans.map((b) => h('option', { value: b.name, selected: b.name === bean }, b.name))) : null;
    paintBeans(beans);
    beanSel?.addEventListener('change', () => { bean = beanSel.value; paint(); });

    const groups = [];
    for (const s of visible) {
      const key = new Date(s.endedAt).toDateString();
      if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, label: day(s.endedAt), items: [] });
      groups[groups.length - 1].items.push(s);
    }
    box.replaceChildren(
      h('div', { class: 'card' },
        h('div', { class: 'kpis' },
          kpi(t('shots.list.kpiToday'), fmtInt(today)), kpi(t('shots.list.kpiWeek'), fmtInt(week)), kpi(t('shots.list.kpiTotal'), fmtInt(total)),
          kpi(t('shots.list.kpiAvgTime'), avgTime ? `${fmt(avgTime / 1000)} s` : '–'), kpi(t('shots.list.kpiAvgRatio'), avgRatio ? `1:${fmt(avgRatio)}` : '–')),
        h('p', { class: 'muted small' }, t('shots.list.hint')),
        data.minShotS ? h('button', { class: 'btn text', onclick: () => navigate('/einstellungen/bezuege') }, icon('tune', 's18'), t('shots.list.hiddenShort', { s: fmtInt(data.minShotS) })) : null),
      h('div', { class: 'row filter-row' }, h('div', { class: 'chips grow' }, chip('all', t('shots.list.filterAll')), chip('rated', t('shots.list.filterRated')), chip('ref', t('shots.list.filterRef'))), beanSel),
      visible.length ? null : h('div', { class: 'empty' }, t('shots.list.noneForFilter')),
      ...groups.flatMap((g) => [
        h('div', { class: 'section-title' }, g.label),
        h('div', { class: 'list' }, g.items.map((s) => shotRow(s))),
      ]),
      total > shots.length ? h('p', { class: 'muted small', style: { 'text-align': 'center' } }, t('shots.list.shownOf', { shown: shots.length, total })) : null);
  }

  function paintBeans(beans) {
    if (!beans.length) {
      beansBox.replaceChildren(h('section', { class: 'card' },
        h('div', { class: 'row' }, icon('coffeeLine', 's20'),
          h('div', { class: 'grow' }, h('div', {}, t('shots.beans.title')), h('div', { class: 'small muted' }, t('shots.beans.emptySub'))),
          h('button', { class: 'btn tonal', onclick: () => editBean() }, icon('add', 's18'), t('shots.beans.create')))), csvTile());
      return;
    }
    beansBox.replaceChildren(h('section', { class: 'card' },
      h('div', { class: 'row' }, icon('coffeeLine', 's20'), h('div', { class: 'grow' }, h('strong', {}, t('shots.beans.title'))),
        h('button', { class: 'btn text', onclick: () => editBean() }, icon('add', 's18'), t('shots.beans.new'))),
      h('div', { class: 'list', style: { 'margin-top': '8px' } }, beans.map((b) => h('div', { class: 'list-item' },
        h('div', { class: 'grow' }, h('div', { class: 'title' }, b.name), b.roaster ? h('div', { class: 'sub' }, b.roaster) : null),
        h('button', { class: 'icon-btn', 'aria-label': t('shots.beans.renameAria', { name: b.name }), title: t('shots.beans.renameTitle'), onclick: () => editBean(b) }, icon('edit', 's20')),
        h('button', { class: 'icon-btn', 'aria-label': t('shots.beans.removeAria', { name: b.name }), title: t('shots.beans.removeTitle'), onclick: () => removeBean(b) }, icon('del', 's20')))))), csvTile());
  }

  function editBean(existing = null) {
    const name = h('input', { class: 'text', maxlength: 60, required: true, value: existing?.name || '', placeholder: t('shots.beans.namePlaceholder') });
    const roaster = h('input', { class: 'text', maxlength: 60, value: existing?.roaster || '', placeholder: t('shots.beans.roasterPlaceholder') });
    const err = h('p', { class: 'error', role: 'alert' });
    const ok = h('button', { class: 'btn filled wide', type: 'submit' }, existing ? t('common.save') : t('shots.beans.create'));
    const form = h('form', { class: 'stack' },
      h('label', { class: 'field' }, h('span', {}, t('shots.beans.name')), name),
      h('label', { class: 'field' }, h('span', {}, t('shots.beans.roaster')), roaster),
      err, ok);
    const close = sheet(existing ? t('shots.beans.editTitle') : t('shots.beans.newTitle'), form);
    setTimeout(() => name.focus(), 200);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      ok.disabled = true;
      try {
        const body = existing
          ? { name: name.value.trim(), roaster: roaster.value.trim(), rename: existing.name }
          : { name: name.value.trim(), roaster: roaster.value.trim() };
        const r = await api('/api/beans', { method: existing ? 'PUT' : 'POST', body });
        data.beans = r.beans;
        close();
        paint();
        snackbar(existing ? t('shots.beans.changed') : t('shots.beans.created'));
      } catch (ex) {
        err.textContent = ex.message;
        ok.disabled = false;
      }
    });
  }

  async function removeBean(b) {
    if (!(await confirmDialog(t('shots.beans.removeConfirmTitle'), t('shots.beans.removeConfirmText', { name: b.name }), t('shots.beans.remove'), 'danger'))) return;
    try {
      const r = await api(`/api/beans/${encodeURIComponent(b.name)}`, { method: 'DELETE' });
      data.beans = r.beans;
      if (bean === b.name) bean = '';
      paint();
    } catch (e) { snackbar(e.message); }
  }

  function shotRow(s) {
    const time = new Date(s.endedAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
    const m = shotMetrics(s);
    const amount = m.yieldG ? `${fmt(m.yieldG)} g` : s.volumeMl ? `${fmt(s.volumeMl, 0)} ml` : '–';
    const n = s.notes || {};
    return h('button', { class: 'list-item clickable as-button shot-item', type: 'button', onclick: () => navigate(`/bezuege/bezug?id=${encodeURIComponent(s.id)}`) },
      h('span', { class: 'lead' }, icon(n.reference ? 'check' : 'coffeeLine')),
      h('div', { class: 'grow' },
        h('div', { class: 'title' }, `${time} · ${m.timeS ? `${fmt(m.timeS)} s` : '–'} · ${amount}${m.ratio ? ` · 1:${fmt(m.ratio)}` : ''}`),
        h('div', { class: 'sub' },
          [s.maxPressure ? t('shots.row.maxPressure', { v: fmt(s.maxPressure) }) : null, m.doseG ? t('shots.row.dose', { v: fmt(m.doseG) }) : null, s.script?.title || null, n.bean || null, s.no ? t('shots.row.no', { n: fmtInt(s.no) }) : null].filter(Boolean).join(' · '),
          n.rating ? h('span', { class: 'mini-stars', 'aria-label': t('shots.row.stars', { n: n.rating }) }, ` ${'★'.repeat(n.rating)}`) : null,
          s.estimated ? h('span', { class: 'badge', style: { 'margin-left': '6px' } }, t('shots.row.estimated')) : null)),
      icon('right', 's20'));
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
