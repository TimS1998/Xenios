// Wochen-Timer (Auto-Ein/Aus pro Tag, Brühen/Dampf), Eco- und Abschalt-Timer, Uhr der Maschine.
import { h, icon, snackbar, switchEl, sliderRow, hhmm, fromHhmm, fmtInt, sheet, pickTimeDialog, withZone } from '../ui.js';
import { api, store, isClassic } from '../api.js';

const DAY_DE = { MONDAY: 'Montag', TUESDAY: 'Dienstag', WEDNESDAY: 'Mittwoch', THUSRDAY: 'Donnerstag', FRIDAY: 'Freitag', SATURDAY: 'Samstag', SUNDAY: 'Sonntag' };

export function timerView(root) {
  const direct = store.server?.mode === 'direct';
  let data = null;
  let dirty = false;
  const box = h('div', {}, h('div', { class: 'empty' }, 'Lade Timer …'));
  const saveBar = h('div', { class: 'savebar', hidden: true },
    h('button', { class: 'btn text', onclick: () => load() }, 'Verwerfen'),
    h('button', { class: 'btn filled', onclick: save }, icon('check', 's18'), 'Speichern'));
  root.append(box, saveBar);

  const markDirty = () => {
    dirty = true;
    saveBar.hidden = false;
  };

  function clockCard() {
    const mc = data.clock ? new Date(data.clock) : null;
    const drift = mc ? Math.round((mc.getTime() - Date.now()) / 60000) : null;
    const bad = drift !== null && Math.abs(drift) > 2;
    const features = store.server?.features || {};
    return h('div', { class: `card ${bad ? '' : 'low'}` },
      h('div', { class: 'row' },
        icon(bad ? 'warn' : 'clock'),
        h('div', { class: 'grow' },
          h('div', {}, 'Uhr der Maschine: ', h('strong', {}, mc ? mc.toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'unbekannt')),
          bad ? h('div', { class: 'small', style: { color: 'var(--danger)' } }, `Weicht ${fmtInt(Math.abs(drift))} min ab – Timer schalten zur falschen Zeit.`) : h('div', { class: 'small muted' }, 'Die Timer laufen nach dieser Uhr.')),
        features.clockSync ? h('button', { class: bad ? 'btn filled' : 'btn text', onclick: () => syncClock() }, 'Uhr stellen') : null),
      features.clockSync ? h('button', { class: 'btn text', onclick: pickTimezone }, icon('clock', 's18'), 'Zeitzone ändern') : null);
  }

  // Zeitzone wählen wie auf der Seite „System“ der Original-Oberfläche; stellt zugleich die Uhr.
  async function pickTimezone() {
    let tz;
    try {
      tz = await api('/api/machine/timezones');
    } catch (e) {
      return snackbar(e.message);
    }
    const search = h('input', { class: 'text', type: 'search', placeholder: 'Suchen (z. B. Berlin)', 'aria-label': 'Zeitzone suchen' });
    const list = h('div', { class: 'list tz-list' });
    let closeSheet;
    const paint = () => {
      const q = search.value.trim().toLowerCase();
      const items = tz.list.filter((t) => !q || t.name.toLowerCase().includes(q)).slice(0, 80);
      list.replaceChildren(...items.map((t) => h('button', { class: `list-item clickable ${t.index === tz.current ? 'sel' : ''}`, onclick: async () => {
        closeSheet();
        await syncClock(t.index);
      } }, h('span', { class: 'grow title' }, t.name), t.index === tz.current ? icon('check', 's18') : null)));
    };
    search.addEventListener('input', paint);
    paint();
    closeSheet = sheet('Zeitzone der Maschine', h('div', {}, search, list));
    search.focus();
  }

  async function syncClock(tzIndex) {
    try {
      const r = await api('/api/machine/clock/sync', { method: 'POST', body: tzIndex === undefined ? {} : { tz: tzIndex } });
      snackbar(`Uhrzeit gestellt (${r.timezone})`);
      setTimeout(load, 1500);
    } catch (e) {
      snackbar(e.message);
    }
  }

  function dayCard(d) {
    const card = h('div', { class: `card timer-card ${d.enabled ? '' : 'off'}` });
    const paint = () => {
      card.className = `card timer-card ${d.enabled ? '' : 'off'}`;
      const timeBtn = h('button', { class: 'time', onclick: () => pickTime(d.on, (m) => { d.on = m; if (m !== null && !d.enabled) { d.enabled = true; if (!d.brew && !d.steam) d.brew = true; } markDirty(); paint(); }) }, d.on === null ? 'Nicht geplant' : hhmm(d.on));
      const offBtn = h('button', { class: 'off-time', onclick: () => pickTime(d.off, (m) => { d.off = m; markDirty(); paint(); }, true) }, d.off !== null ? `Aus um ${hhmm(d.off)}` : 'Keine Ausschaltzeit');
      const sw = switchEl({ checked: d.enabled, label: `${DAY_DE[d.day]} aktiv`, onChange: (on) => {
        d.enabled = on;
        if (on && d.on === null) d.on = 7 * 60;
        if (on && !d.brew && !d.steam) { d.brew = true; d.steam = true; }
        markDirty();
        paint();
      } });
      const chip = (label, ic, key) => h('button', { class: 'chip', 'aria-pressed': String(d[key]), disabled: !d.enabled, onclick: () => {
        d[key] = !d[key];
        if (!d.brew && !d.steam) d[key === 'brew' ? 'steam' : 'brew'] = true;
        markDirty();
        paint();
      } }, icon(ic, 's18'), label);
      const brewChip = data.machineType === 1 ? null : chip('Brühen', 'drop', 'brew');
      card.replaceChildren(
        h('div', { class: 'row between' }, h('div', {}, h('div', { class: 'day' }, DAY_DE[d.day]), timeBtn), sw),
        d.enabled ? h('div', { class: 'row between', style: { 'margin-top': '6px' } }, h('div', { class: 'chips' }, brewChip, chip('Dampf', 'cloud', 'steam')), offBtn) : null);
    };
    paint();
    return card;
  }

  function sysCard() {
    const row = (label, key, hint) => {
      const val = data[key] || 0;
      const num = h('input', { class: 'text', type: 'number', min: 1, max: 240, value: val || 20, disabled: !val, style: { width: '96px' } });
      num.addEventListener('input', () => { data[key] = Math.max(1, Math.min(240, Number(num.value) || 1)); markDirty(); });
      const sw = switchEl({ checked: Boolean(val), label, onChange: (on) => { data[key] = on ? Number(num.value) || 20 : 0; num.disabled = !on; markDirty(); } });
      return h('div', { class: 'row', style: { padding: '6px 0' } }, h('div', { class: 'grow' }, h('div', {}, label), h('div', { class: 'small muted' }, hint)), num, h('span', { class: 'muted small' }, 'min'), sw);
    };
    return h('div', { class: 'card' },
      h('h3', {}, 'Automatik'),
      row('Eco-Modus nach', 'ecoAfterMin', 'Ohne Bezug in den Eco-Modus wechseln'),
      row('Ausschalten nach', 'offAfterMin', 'Ohne Bezug komplett ausschalten'));
  }

  function paintAll() {
    const weekly = data.weekly !== false && !isClassic();
    box.replaceChildren(
      weekly ? clockCard() : h('div', { class: 'card low muted small' }, 'Die alte Xenia hat keinen Wochenplan über die API. Eco- und Ausschalt-Timer unten, zusätzliche Zeiten über den Server.'),
      weekly ? h('div', { class: 'section-title' }, 'Wochenplan (Maschine)') : null,
      ...(weekly ? data.days.map(dayCard) : []),
      ...(direct ? [h('div', { class: 'section-title' }, 'Weitere Schaltzeiten & Wecker'), h('div', { class: 'card low muted small' }, 'Zusätzliche Schaltzeiten und das Einschalten vor dem Wecker übernimmt der Server. Im Direkt-Modus der App gibt es nur den Wochenplan der Maschine.')]
        : [h('div', { class: 'section-title' }, 'Weitere Schaltzeiten (Server)'), scheduleBox, h('div', { class: 'section-title' }, 'Wecker'), wakeBox]),
      h('div', { class: 'section-title' }, 'System-Timer'),
      sysCard(),
      weekly ? h('p', { class: 'muted small' }, 'Hinweis: Eine Ausschaltzeit gilt nur an aktiven Tagen. „Brühen“ heizt den Brühkessel, „Dampf“ den Dampfkessel.') : null);
  }

  async function load() {
    dirty = false;
    saveBar.hidden = true;
    try {
      data = await api('/api/machine/timers');
      paintAll();
    } catch (e) {
      box.replaceChildren(h('div', { class: 'empty' }, e.message));
    }
  }

  async function save() {
    try {
      await api('/api/machine/timers', { method: 'PUT', body: { days: data.days, ecoAfterMin: data.ecoAfterMin, offAfterMin: data.offAfterMin } });
      snackbar('Timer gespeichert');
      load();
    } catch (e) {
      snackbar(e.message);
    }
  }

  // --- Zusätzliche Schaltzeiten: beliebig viele, der Server schaltet zur Minute ---
  const scheduleBox = h('div', {}, h('div', { class: 'empty' }, 'Lade Schaltzeiten …'));
  let rules = [];
  let rulesDirty = false;
  const rulesSave = h('button', { class: 'btn filled wide', disabled: true, onclick: saveRules }, icon('check', 's18'), 'Schaltzeiten speichern');
  const markRules = () => { rulesDirty = true; rulesSave.disabled = false; };
  const DAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const ACTION_LABEL = { on: 'Ein', eco: 'Eco', off: 'Aus' };

  function ruleCard(r, i) {
    const card = h('div', { class: `card timer-card ${r.enabled ? '' : 'off'}` });
    const paint = () => {
      card.className = `card timer-card ${r.enabled ? '' : 'off'}`;
      const timeBtn = h('button', { class: 'time', onclick: () => pickTime(fromHhmm(r.time), (m) => { r.time = hhmm(m); markRules(); paint(); }) }, r.time);
      const sw = switchEl({ checked: r.enabled, label: `Schaltzeit ${r.time} aktiv`, onChange: (on) => { r.enabled = on; markRules(); paint(); } });
      const actions = h('div', { class: 'chips' }, Object.entries(ACTION_LABEL).map(([a, label]) =>
        h('button', { class: 'chip', 'aria-pressed': String(r.action === a), onclick: () => { r.action = a; markRules(); paint(); } }, label)));
      const days = h('div', { class: 'chips days' }, DAY_SHORT.map((d, di) =>
        h('button', { class: 'chip', 'aria-pressed': String(r.days.includes(di)), onclick: () => {
          r.days = r.days.includes(di) ? r.days.filter((x) => x !== di) : [...r.days, di].sort();
          markRules();
          paint();
        } }, d)));
      const label = h('input', { class: 'text', value: r.label || '', maxlength: 40, placeholder: 'Bezeichnung (optional)', 'aria-label': 'Bezeichnung' });
      label.addEventListener('input', () => { r.label = label.value; markRules(); });
      card.replaceChildren(
        h('div', { class: 'row' }, timeBtn, h('div', { class: 'grow' }), sw,
          h('button', { class: 'icon-btn', 'aria-label': 'Schaltzeit löschen', onclick: () => { rules.splice(i, 1); markRules(); paintRules(); } }, icon('del', 's20'))),
        actions, days, label);
    };
    paint();
    return card;
  }

  function paintRules() {
    scheduleBox.replaceChildren(
      h('p', { class: 'muted small' }, 'Zusätzlich zum Wochenplan der Maschine (eine Zeit pro Tag) schaltet der Server zu diesen Zeiten ein, in Eco oder aus. Der Server-PC muss dafür laufen. Ein laufender Bezug wird nicht abgebrochen.'),
      ...rules.map(ruleCard),
      h('button', { class: 'btn outlined wide', onclick: () => {
        rules.push({ time: '12:00', days: [0, 1, 2, 3, 4], action: 'on', enabled: true, label: '' });
        markRules();
        paintRules();
      } }, icon('add', 's18'), 'Schaltzeit hinzufügen'),
      h('div', { style: { height: '8px' } }),
      rulesSave);
  }

  async function loadRules() {
    try {
      rules = (await api('/api/schedule')).rules.map((r) => ({ ...r, days: [...r.days] }));
      rulesDirty = false;
      rulesSave.disabled = true;
      paintRules();
    } catch (e) {
      scheduleBox.replaceChildren(h('div', { class: 'empty' }, e.message));
    }
  }

  async function saveRules() {
    rulesSave.disabled = true;
    try {
      rules = (await api('/api/schedule', { method: 'PUT', body: { rules } })).rules;
      rulesDirty = false;
      snackbar('Schaltzeiten gespeichert');
      paintRules();
    } catch (e) {
      snackbar(e.message);
      rulesSave.disabled = false;
    }
  }

  // --- Wecker: Android-Apps melden den nächsten Wecker, der Server schaltet vorher ein ---
  const wakeBox = h('div', {}, h('div', { class: 'empty' }, 'Lade Wecker …'));
  let wake = null;
  let wakeDirty = false;
  const deviceToggles = {};
  const wakeSave = h('button', { class: 'btn filled wide', disabled: true, onclick: saveWake }, icon('check', 's18'), 'Wecker-Einstellungen speichern');
  const markWake = () => { wakeDirty = true; wakeSave.disabled = false; };
  const inApp = typeof window.XeniaApp?.checkAlarm === 'function';
  // „Wecker prüfen“: in der Android-App meldet dieses Handy sofort seinen nächsten Wecker; sonst nur neu laden.
  const checkBtn = h('button', { class: 'btn tonal', onclick: async () => {
    checkBtn.disabled = true;
    try {
      if (inApp) {
        const next = Number(window.XeniaApp.checkAlarm());
        snackbar(next > 0 ? `Nächster Wecker auf diesem Handy: ${when(next)}` : 'Auf diesem Handy ist kein Wecker gestellt');
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (wakeDirty) snackbar('Ungespeicherte Änderungen bleiben erhalten');
      else await loadWake();
    } finally {
      checkBtn.disabled = false;
    }
  } }, icon('refresh', 's18'), 'Wecker prüfen');
  const when = (ms) => (ms ? new Date(ms).toLocaleString('de-DE', withZone({ weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })) : '–');

  function paintWake() {
    const c = wake.config;
    const plan = wake.plan;
    const planText = !c.enabled ? 'Aus' : plan ? `Einschalten ${when(plan.at)} – Wecker ${when(plan.alarm)} (${plan.device})` : 'Kein passender Wecker gemeldet';
    const timeField = (key, label) => {
      const btn = h('button', { type: 'button', class: 'text time-field', 'aria-label': label }, c[key]);
      btn.addEventListener('click', () => pickTime(fromHhmm(c[key]), (m) => { c[key] = hhmm(m); btn.textContent = c[key]; markWake(); }));
      return h('div', { class: 'field grow' }, h('span', {}, label), btn);
    };
    const steamSel = h('select', { class: 'text', 'aria-label': 'Dampfkessel' },
      [['', 'Wie Startmodus der Maschine'], ['true', 'Mit Dampfkessel'], ['false', 'Ohne Dampfkessel']].map(([v, t]) =>
        h('option', { value: v, selected: String(c.steam ?? '') === v }, t)));
    steamSel.addEventListener('change', () => { c.steam = steamSel.value === '' ? null : steamSel.value === 'true'; markWake(); });
    const devices = wake.devices.length
      ? wake.devices.map((d) => h('div', { class: 'row', style: { padding: '6px 0' } },
        icon('bell', 's20'),
        h('div', { class: 'grow' },
          h('div', {}, d.name),
          h('div', { class: 'small muted' }, d.next ? `Nächster Wecker ${when(d.next)}` : 'Kein Wecker gestellt', ` · gemeldet ${when(d.updated)}`)),
        switchEl({ checked: deviceToggles[d.id] ?? d.enabled, label: `${d.name} berücksichtigen`, onChange: (on) => { deviceToggles[d.id] = on; markWake(); } }),
        h('button', { class: 'icon-btn', 'aria-label': `${d.name} entfernen`, onclick: async () => {
          try { wake = await api(`/api/wake/devices/${d.id}`, { method: 'DELETE' }); paintWake(); } catch (e) { snackbar(e.message); }
        } }, icon('del', 's20'))))
      : [h('div', { class: 'muted small' }, 'Noch kein Handy hat einen Wecker gemeldet. Das macht die Android-App automatisch, sobald sie eingerichtet ist.')];
    wakeBox.replaceChildren(h('div', { class: 'card' },
      h('div', { class: 'row' }, h('div', { class: 'grow' }, h('strong', {}, 'Vor dem ersten Wecker einschalten'), h('div', { class: 'small muted' }, planText)),
        switchEl({ checked: c.enabled, label: 'Wecker-Automatik', onChange: (on) => { c.enabled = on; markWake(); } })),
      sliderRow({ label: 'Vorlauf', min: 1, max: 60, step: 1, value: c.leadMin, unit: 'min', digits: 0, onInput: (v) => { c.leadMin = v; markWake(); } }),
      h('label', { class: 'field', style: { 'margin-top': '8px' } }, h('span', {}, 'Dampfkessel'), steamSel),
      h('div', { class: 'small muted', style: { 'margin-top': '12px' } }, 'Nur Wecker in diesem Zeitfenster zählen (z. B. keinen Mittagsschlaf-Wecker):'),
      h('div', { class: 'row' }, timeField('from', 'Frühester Wecker'), timeField('to', 'Spätester Wecker')),
      h('div', { class: 'chips days', style: { 'margin-top': '8px' } }, DAY_SHORT.map((d, di) =>
        h('button', { class: 'chip', 'aria-pressed': String(c.days.includes(di)), onclick: () => {
          c.days = c.days.includes(di) ? c.days.filter((x) => x !== di) : [...c.days, di].sort();
          markWake();
          paintWake();
        } }, d))),
      h('div', { class: 'row', style: { 'margin-top': '16px' } }, h('h3', { class: 'grow', style: { margin: 0 } }, 'Handys'), checkBtn),
      ...devices,
      inApp ? h('button', { class: 'btn text', onclick: () => window.XeniaApp.showAlarms() }, icon('clock', 's18'), 'Alle Wecker in der Uhr-App ansehen') : null,
      h('p', { class: 'muted small' }, 'Android verrät pro Handy nur den nächsten Wecker, nicht die ganze Liste. Jedes Handy meldet ihn selbst, sobald er sich ändert. „Wecker prüfen“ fragt das Handy ab, auf dem du gerade bist. Es zählt der früheste Wecker der ausgewählten Handys. Wird ein Wecker kurzfristig gestellt, schaltet der Server sofort ein. Läuft die Maschine schon, passiert nichts.'),
      wakeSave));
  }

  async function loadWake() {
    try {
      wake = await api('/api/wake');
      wakeDirty = false;
      wakeSave.disabled = true;
      paintWake();
    } catch (e) {
      wakeBox.replaceChildren(h('div', { class: 'empty' }, e.message));
    }
  }

  async function saveWake() {
    wakeSave.disabled = true;
    try {
      const { enabled, leadMin, steam, from, to, days } = wake.config;
      wake = await api('/api/wake', { method: 'PUT', body: { config: { enabled, leadMin, steam, from, to, days }, devices: deviceToggles } });
      for (const k of Object.keys(deviceToggles)) delete deviceToggles[k];
      wakeDirty = false;
      snackbar('Wecker-Einstellungen gespeichert');
      paintWake();
    } catch (e) {
      snackbar(e.message);
      wakeSave.disabled = false;
    }
  }

  load();
  if (!direct) {
    loadRules();
    loadWake();
  }
  return () => {
    if (dirty || rulesDirty || wakeDirty) snackbar('Timer-Änderungen nicht gespeichert');
  };
}

// Zeitwähler der App (statt des Browser-Popups, das am Desktop irgendwo am Bildschirmrand aufgeht)
async function pickTime(current, onPick, allowClear = false) {
  const v = await pickTimeDialog({ title: 'Uhrzeit', value: current, allowClear });
  if (v !== undefined) onPick(v);
}
