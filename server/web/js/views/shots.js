// Bezugs-Protokoll: alle Bezüge dauerhaft (Server-Datei bzw. App-Speicher), Statistik, Filter, Pflege, CSV-Export.
// Ein Bezug öffnet die Analyse (Kurve mit Vergleich, Kennzahlen, Bewertung).
import { h, icon, fmt, fmtInt, snackbar, sheet, confirmDialog } from '../ui.js';
import { api, subscribe } from '../api.js';
import { setTopActions } from '../app.js';
import { shotMetrics, dialIn } from '../../shared/shot-analysis.js';
import { TASTE } from '../../shared/machine-core.js';
import { openShot, quickRate, adviceNote } from './shot-detail.js';

export function shotsView(root) {
  const dial = h('div', {});
  const care = h('div', {});
  const box = h('div', {}, h('div', { class: 'empty' }, 'Lade Bezüge …'));
  const beansBox = h('div', {});
  root.append(dial, care, beansBox, box);
  setTopActions(
    h('button', { class: 'icon-btn', 'aria-label': 'Bohne anlegen', title: 'Bohne anlegen', onclick: () => editBean() }, icon('add')),
    h('a', { class: 'icon-btn', href: '/api/shots.csv', download: '', 'aria-label': 'Als CSV exportieren', title: 'Als CSV exportieren' }, icon('download')));
  let data = { shots: [], total: 0, beans: [] };
  let filter = 'all';
  let bean = '';

  async function load() {
    try {
      const r = await api('/api/shots');
      data = { shots: r.shots, total: r.total ?? r.shots.length, beans: r.beans || [] };
      paint();
      paintDial();
    } catch (e) {
      box.replaceChildren(h('div', { class: 'empty' }, e.message));
    }
    loadCare();
  }

  // Pflege: Backflush-Erinnerung
  async function loadCare() {
    let m;
    try { m = (await api('/api/maintenance')).backflush; } catch { return care.replaceChildren(); }
    const intervalSel = h('select', { class: 'text small-select', 'aria-label': 'Erinnerung alle' },
      [3, 5, 7, 10, 14, 21, 30].map((d) => h('option', { value: d, selected: d === m.intervalDays }, `alle ${d} Tage`)));
    intervalSel.addEventListener('change', async () => {
      try { await api('/api/maintenance', { method: 'PUT', body: { intervalDays: Number(intervalSel.value) } }); loadCare(); } catch (e) { snackbar(e.message); }
    });
    const done = h('button', { class: `btn ${m.due ? 'filled' : 'tonal'}`, onclick: async () => {
      try { await api('/api/maintenance/backflush', { method: 'POST' }); snackbar('Backflush eingetragen'); loadCare(); } catch (e) { snackbar(e.message); }
    } }, icon('check', 's18'), 'Erledigt');
    const status = m.lastAt === null ? 'Noch nie eingetragen'
      : `Vor ${m.daysSince === 0 ? 'weniger als einem Tag' : `${fmtInt(m.daysSince)} ${m.daysSince === 1 ? 'Tag' : 'Tagen'}`} · ${fmtInt(m.shotsSince)} Bezüge seitdem`;
    care.replaceChildren(h('section', { class: `card care ${m.due ? 'due' : ''}` },
      h('div', { class: 'row' },
        icon(m.due ? 'warn' : 'check', 's20'),
        h('div', { class: 'grow' }, h('div', {}, m.due ? 'Backflush fällig' : 'Backflush'), h('div', { class: 'small muted' }, status)),
        done),
      h('div', { class: 'row', style: { 'margin-top': '8px' } }, h('span', { class: 'small muted grow' }, 'Erinnerung'), intervalSel)));
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
        h('div', { class: 'row' }, icon('tune', 's20'), h('div', { class: 'grow' }, h('div', {}, 'Wie war der letzte Bezug?'), h('div', { class: 'small muted' }, [new Date(last.endedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }), facts].filter(Boolean).join(' · ')))),
        h('div', { class: 'chips big-chips' }, Object.entries(TASTE).map(([k, label]) => h('button', { class: 'chip', onclick: () => quickRate(last.id, { taste: k, onChange: load }) }, label)))));
    }
    const a = dialIn(last, data.shots.slice(1));
    dial.replaceChildren(a ? h('section', { class: 'dial-card' }, h('div', { class: 'section-title' }, 'Nächster Bezug'), adviceNote(a, last.dose?.recipe)) : null);
  }

  function paint() {
    const { shots, total } = data;
    if (!shots.length) {
      paintBeans(data.beans || []);
      box.replaceChildren(h('div', { class: 'empty' }, 'Noch keine Bezüge protokolliert. Ab jetzt wird jeder Bezug gespeichert – auch über Neustarts von Maschine und Server hinweg.'));
      return;
    }
    const day = (iso) => new Date(iso).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    const todayKey = new Date().toDateString();
    const weekAgo = Date.now() - 7 * 86400e3;
    const today = shots.filter((s) => new Date(s.endedAt).toDateString() === todayKey).length;
    const week = shots.filter((s) => Date.parse(s.endedAt) >= weekAgo).length;
    const recent = shots.filter((s) => !s.estimated).slice(0, 10);
    const avg = (f) => {
      const v = recent.map(f).filter((x) => Number.isFinite(x) && x > 0);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    const avgTime = avg((s) => s.timeMs);
    const avgRatio = avg((s) => shotMetrics(s).ratio);

    const beans = data.beans?.length ? data.beans : [...new Set(shots.map((s) => s.notes?.bean).filter(Boolean))].map((n) => ({ name: n }));
    const visible = shots.filter((s) => (filter === 'rated' ? s.notes?.rating || s.notes?.taste : filter === 'ref' ? s.notes?.reference : true) && (!bean || s.notes?.bean === bean));
    const chip = (key, label) => h('button', { class: 'chip', 'aria-pressed': String(filter === key), onclick: () => { filter = key; paint(); } }, label);
    const beanSel = beans.length ? h('select', { class: 'text small-select', 'aria-label': 'Bohne' },
      h('option', { value: '' }, 'Alle Bohnen'), beans.map((b) => h('option', { value: b.name, selected: b.name === bean }, b.name))) : null;
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
          kpi('Heute', fmtInt(today)), kpi('7 Tage', fmtInt(week)), kpi('Gesamt', fmtInt(total)),
          kpi('Ø Zeit', avgTime ? `${fmt(avgTime / 1000)} s` : '–'), kpi('Ø Verhältnis', avgRatio ? `1:${fmt(avgRatio)}` : '–')),
        h('p', { class: 'muted small' }, 'Einen Bezug antippen für Kurve, Vergleich, Kennzahlen und Bewertung. Die Dosis kommt automatisch von der Mühle, wenn kurz vorher gemahlen wurde.')),
      h('div', { class: 'row filter-row' }, h('div', { class: 'chips grow' }, chip('all', 'Alle'), chip('rated', 'Bewertet'), chip('ref', 'Referenzen')), beanSel),
      visible.length ? null : h('div', { class: 'empty' }, 'Keine Bezüge für diesen Filter.'),
      ...groups.flatMap((g) => [
        h('div', { class: 'section-title' }, g.label),
        h('div', { class: 'list' }, g.items.map((s) => shotRow(s))),
      ]),
      total > shots.length ? h('p', { class: 'muted small', style: { 'text-align': 'center' } }, `Angezeigt: die letzten ${shots.length} von ${total}. Alle stehen im CSV-Export.`) : null);
  }

  function paintBeans(beans) {
    if (!beans.length) {
      beansBox.replaceChildren(h('section', { class: 'card' },
        h('div', { class: 'row' }, icon('coffee', 's20'),
          h('div', { class: 'grow' }, h('div', {}, 'Bohnen'), h('div', { class: 'small muted' }, 'Anlegen, dann in der Bewertung auswählen.')),
          h('button', { class: 'btn tonal', onclick: () => editBean() }, icon('add', 's18'), 'Anlegen'))));
      return;
    }
    beansBox.replaceChildren(h('section', { class: 'card' },
      h('div', { class: 'row' }, icon('coffee', 's20'), h('div', { class: 'grow' }, h('strong', {}, 'Bohnen')),
        h('button', { class: 'btn text', onclick: () => editBean() }, icon('add', 's18'), 'Neu')),
      h('div', { class: 'list', style: { 'margin-top': '8px' } }, beans.map((b) => h('div', { class: 'list-item' },
        h('div', { class: 'grow' }, h('div', { class: 'title' }, b.name), b.roaster ? h('div', { class: 'sub' }, b.roaster) : null),
        h('button', { class: 'icon-btn', 'aria-label': `${b.name} umbenennen`, title: 'Umbenennen', onclick: () => editBean(b) }, icon('edit', 's20')),
        h('button', { class: 'icon-btn', 'aria-label': `${b.name} entfernen`, title: 'Aus der Liste nehmen', onclick: () => removeBean(b) }, icon('del', 's20')))))));
  }

  function editBean(existing = null) {
    const name = h('input', { class: 'text', maxlength: 60, required: true, value: existing?.name || '', placeholder: 'z. B. Kenia AA' });
    const roaster = h('input', { class: 'text', maxlength: 60, value: existing?.roaster || '', placeholder: 'optional' });
    const err = h('p', { class: 'error', role: 'alert' });
    const ok = h('button', { class: 'btn filled wide', type: 'submit' }, existing ? 'Speichern' : 'Anlegen');
    const form = h('form', { class: 'stack' },
      h('label', { class: 'field' }, h('span', {}, 'Name'), name),
      h('label', { class: 'field' }, h('span', {}, 'Rösterei'), roaster),
      err, ok);
    const close = sheet(existing ? 'Bohne ändern' : 'Neue Bohne', form);
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
        snackbar(existing ? 'Bohne geändert' : 'Bohne angelegt');
      } catch (ex) {
        err.textContent = ex.message;
        ok.disabled = false;
      }
    });
  }

  async function removeBean(b) {
    if (!(await confirmDialog('Bohne aus der Liste nehmen?', `„${b.name}“ bleibt an den bewerteten Bezügen stehen, erscheint aber nicht mehr zur Auswahl.`, 'Entfernen', 'danger'))) return;
    try {
      const r = await api(`/api/beans/${encodeURIComponent(b.name)}`, { method: 'DELETE' });
      data.beans = r.beans;
      if (bean === b.name) bean = '';
      paint();
    } catch (e) { snackbar(e.message); }
  }

  function shotRow(s) {
    const time = new Date(s.endedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const m = shotMetrics(s);
    const amount = m.yieldG ? `${fmt(m.yieldG)} g` : s.volumeMl ? `${fmt(s.volumeMl, 0)} ml` : '–';
    const n = s.notes || {};
    return h('button', { class: 'list-item clickable as-button shot-item', type: 'button', onclick: () => openShot(s.id, { onChange: load }) },
      h('span', { class: 'lead' }, icon(n.reference ? 'check' : 'coffee')),
      h('div', { class: 'grow' },
        h('div', { class: 'title' }, `${time} · ${s.timeMs ? `${fmt(s.timeMs / 1000)} s` : '–'} · ${amount}${m.ratio ? ` · 1:${fmt(m.ratio)}` : ''}`),
        h('div', { class: 'sub' },
          [s.maxPressure ? `max. ${fmt(s.maxPressure)} bar` : null, m.doseG ? `${fmt(m.doseG)} g Dosis` : null, s.script?.title || null, n.bean || null, s.no ? `Nr. ${fmtInt(s.no)}` : null].filter(Boolean).join(' · '),
          n.rating ? h('span', { class: 'mini-stars', 'aria-label': `${n.rating} Sterne` }, ` ${'★'.repeat(n.rating)}`) : null,
          s.estimated ? h('span', { class: 'badge', style: { 'margin-left': '6px' } }, 'nachträglich') : null)),
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
