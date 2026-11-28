// Wochen-Timer (Auto-Ein/Aus pro Tag, Brühen/Dampf), Eco- und Abschalt-Timer, Uhr der Maschine.
import { h, icon, snackbar, switchEl, sliderRow, hhmm, fromHhmm, fmtInt, sheet, pickTimeDialog, withZone } from '../ui.js';
import { api, store, isClassic } from '../api.js';
import { t, tRaw, locale } from '../../shared/i18n.js';

const DAY_DE = () => ({ MONDAY: t('home.timer.days.monday'), TUESDAY: t('home.timer.days.tuesday'), WEDNESDAY: t('home.timer.days.wednesday'), THUSRDAY: t('home.timer.days.thursday'), FRIDAY: t('home.timer.days.friday'), SATURDAY: t('home.timer.days.saturday'), SUNDAY: t('home.timer.days.sunday') });

export function timerView(root) {
  const direct = store.server?.mode === 'direct';
  let data = null;
  let dirty = false;
  const box = h('div', {}, h('div', { class: 'empty' }, t('home.timer.loading')));
  const saveBar = h('div', { class: 'savebar', hidden: true },
    h('button', { class: 'btn text', onclick: () => load() }, t('home.timer.discard')),
    h('button', { class: 'btn filled', onclick: save }, icon('check', 's18'), t('common.save')));
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
          h('div', {}, t('home.timer.clock'), h('strong', {}, mc ? mc.toLocaleString(locale(), { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : t('home.timer.unknown'))),
          bad ? h('div', { class: 'small', style: { color: 'var(--danger)' } }, t('home.timer.drift', { n: fmtInt(Math.abs(drift)) })) : h('div', { class: 'small muted' }, t('home.timer.clockHint'))),
        features.clockSync ? h('button', { class: bad ? 'btn filled' : 'btn text', onclick: () => syncClock() }, t('home.timer.setClock')) : null),
      features.clockSync ? h('button', { class: 'btn text', onclick: pickTimezone }, icon('clock', 's18'), t('home.timer.changeZone')) : null);
  }

  // Zeitzone wählen wie auf der Seite „System“ der Original-Oberfläche; stellt zugleich die Uhr.
  async function pickTimezone() {
    let tz;
    try {
      tz = await api('/api/machine/timezones');
    } catch (e) {
      return snackbar(e.message);
    }
    const search = h('input', { class: 'text', type: 'search', placeholder: t('home.timer.zoneSearch'), 'aria-label': t('home.timer.zoneSearchLabel') });
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
    closeSheet = sheet(t('home.timer.zoneTitle'), h('div', {}, search, list));
    search.focus();
  }

  async function syncClock(tzIndex) {
    try {
      const r = await api('/api/machine/clock/sync', { method: 'POST', body: tzIndex === undefined ? {} : { tz: tzIndex } });
      snackbar(t('home.timer.clockSet', { zone: r.timezone }));
      setTimeout(load, 1500);
    } catch (e) {
      snackbar(e.message);
    }
  }

  function dayCard(d) {
    const card = h('div', { class: `card timer-card ${d.enabled ? '' : 'off'}` });
    const paint = () => {
      card.className = `card timer-card ${d.enabled ? '' : 'off'}`;
      const timeBtn = h('button', { class: 'time', onclick: () => pickTime(d.on, (m) => { d.on = m; if (m !== null && !d.enabled) { d.enabled = true; if (!d.brew && !d.steam) d.brew = true; } markDirty(); paint(); }) }, d.on === null ? t('home.timer.notPlanned') : hhmm(d.on));
      const offBtn = h('button', { class: 'off-time', onclick: () => pickTime(d.off, (m) => { d.off = m; markDirty(); paint(); }, true) }, d.off !== null ? t('home.timer.offAt', { time: hhmm(d.off) }) : t('home.timer.noOffTime'));
      const sw = switchEl({ checked: d.enabled, label: t('home.timer.dayActive', { day: DAY_DE()[d.day] }), onChange: (on) => {
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
      const brewChip = data.machineType === 1 ? null : chip(t('home.timer.brew'), 'drop', 'brew');
      card.replaceChildren(
        h('div', { class: 'row between' }, h('div', {}, h('div', { class: 'day' }, DAY_DE()[d.day]), timeBtn), sw),
        d.enabled ? h('div', { class: 'row between', style: { 'margin-top': '6px' } }, h('div', { class: 'chips' }, brewChip, chip(t('home.timer.steam'), 'cloud', 'steam')), offBtn) : null);
    };
    paint();
    return card;
  }

  // Xenia DBL: zwei Einschaltzeiten je Tag (wie „Start timer 1/2“ der Original-Seite), je mit Kesselwahl
  function dblDayCard(d) {
    const card = h('div', { class: 'card timer-card' });
    const paint = () => {
      const any = d.starts.some((st) => st.enabled);
      card.className = `card timer-card ${any ? '' : 'off'}`;
      const row = (st, n) => {
        const timeBtn = h('button', { class: 'time', onclick: () => pickTime(st.on, (m) => {
          st.on = m;
          st.enabled = m !== null;
          if (st.enabled && !st.brew && !st.steam) { st.brew = true; st.steam = true; }
          markDirty(); paint();
        }, true) }, st.enabled && st.on !== null ? hhmm(st.on) : t('home.timer.notPlanned'));
        const sw = switchEl({ checked: st.enabled, label: t('home.timer.dblStart', { day: DAY_DE()[d.day], n }), onChange: (on) => {
          st.enabled = on;
          if (on && st.on === null) st.on = n === 1 ? 7 * 60 : 13 * 60;
          if (on && !st.brew && !st.steam) { st.brew = true; st.steam = true; }
          markDirty(); paint();
        } });
        const chip = (label, ic, key) => h('button', { class: 'chip', 'aria-pressed': String(st[key]), disabled: !st.enabled, onclick: () => {
          st[key] = !st[key];
          if (!st.brew && !st.steam) st[key === 'brew' ? 'steam' : 'brew'] = true;
          markDirty(); paint();
        } }, icon(ic, 's18'), label);
        return h('div', { class: 'dbl-start' },
          h('div', { class: 'row between' }, h('div', {}, h('div', { class: 'small muted' }, t('home.timer.startN', { n })), timeBtn), sw),
          st.enabled ? h('div', { class: 'chips', style: { 'margin-top': '4px' } }, data.machineType === 1 ? null : chip(t('home.timer.brewBoiler'), 'drop', 'brew'), chip(t('home.timer.steamBoiler'), 'cloud', 'steam')) : null);
      };
      card.replaceChildren(h('div', { class: 'day' }, DAY_DE()[d.day]), ...d.starts.map((st, i) => row(st, i + 1)));
    };
    paint();
    return card;
  }

  function sysCard() {
    const row = (label, key, hint) => {
      if (data.weekly === 'starts') {
        // DBL: beide Timer sind immer aktiv (1–240 min), Abschalten muss nach Eco kommen
        const num = h('input', { class: 'text', type: 'number', min: 1, max: 240, value: data[key] ?? 10, style: { width: '96px' } });
        num.addEventListener('input', () => { data[key] = Math.max(1, Math.min(240, Number(num.value) || 1)); markDirty(); });
        return h('div', { class: 'row', style: { padding: '6px 0' } }, h('div', { class: 'grow' }, h('div', {}, label), h('div', { class: 'small muted' }, hint)), num, h('span', { class: 'muted small' }, 'min'));
      }
      const val = data[key] || 0;
      const num = h('input', { class: 'text', type: 'number', min: 1, max: 240, value: val || 20, disabled: !val, style: { width: '96px' } });
      num.addEventListener('input', () => { data[key] = Math.max(1, Math.min(240, Number(num.value) || 1)); markDirty(); });
      const sw = switchEl({ checked: Boolean(val), label, onChange: (on) => { data[key] = on ? Number(num.value) || 20 : 0; num.disabled = !on; markDirty(); } });
      return h('div', { class: 'row', style: { padding: '6px 0' } }, h('div', { class: 'grow' }, h('div', {}, label), h('div', { class: 'small muted' }, hint)), num, h('span', { class: 'muted small' }, 'min'), sw);
    };
    return h('div', { class: 'card' },
      h('h3', {}, t('home.timer.auto')),
      row(t('home.timer.ecoAfter'), 'ecoAfterMin', t('home.timer.ecoAfterHint')),
      row(t('home.timer.offAfter'), 'offAfterMin', t('home.timer.offAfterHint')));
  }

  function paintAll() {
    const dbl = data.weekly === 'starts';
    const weekly = dbl || (data.weekly !== false && !isClassic());
    box.replaceChildren(
      dbl ? h('div', { class: 'card low muted small' }, t('home.timer.dblNote'))
        : weekly ? clockCard() : h('div', { class: 'card low muted small' }, t('home.timer.noWeekly')),
      weekly ? h('div', { class: 'section-title' }, t('home.timer.weekly')) : null,
      ...(weekly ? data.days.map(dbl ? dblDayCard : dayCard) : []),
      ...(direct ? [h('div', { class: 'section-title' }, t('home.timer.moreDirect')), h('div', { class: 'card low muted small' }, t('home.timer.moreDirectNote'))]
        : [h('div', { class: 'section-title' }, t('home.timer.moreServer')), scheduleBox, h('div', { class: 'section-title' }, t('home.timer.alarm')), wakeBox]),
      h('div', { class: 'section-title' }, t('home.timer.system')),
      sysCard(),
      weekly && !dbl ? h('p', { class: 'muted small' }, t('home.timer.note')) : null);
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
      snackbar(t('home.timer.saved'));
      load();
    } catch (e) {
      snackbar(e.message);
    }
  }

  // --- Zusätzliche Schaltzeiten: beliebig viele, der Server schaltet zur Minute ---
  const scheduleBox = h('div', {}, h('div', { class: 'empty' }, t('home.timer.rulesLoading')));
  let rules = [];
  let rulesDirty = false;
  const rulesSave = h('button', { class: 'btn filled wide', disabled: true, onclick: saveRules }, icon('check', 's18'), t('home.timer.rulesSave'));
  const markRules = () => { rulesDirty = true; rulesSave.disabled = false; };
  const WEEKDAYS = tRaw('common.weekdaysShort'); // Sonntag zuerst
  const DAY_SHORT = [...WEEKDAYS.slice(1), WEEKDAYS[0]];
  const ACTION_LABEL = { on: t('home.timer.actionOn'), eco: t('home.timer.actionEco'), off: t('home.timer.actionOff') };

  function ruleCard(r, i) {
    const card = h('div', { class: `card timer-card ${r.enabled ? '' : 'off'}` });
    const paint = () => {
      card.className = `card timer-card ${r.enabled ? '' : 'off'}`;
      const timeBtn = h('button', { class: 'time', onclick: () => pickTime(fromHhmm(r.time), (m) => { r.time = hhmm(m); markRules(); paint(); }) }, r.time);
      const sw = switchEl({ checked: r.enabled, label: t('home.timer.ruleActive', { time: r.time }), onChange: (on) => { r.enabled = on; markRules(); paint(); } });
      const actions = h('div', { class: 'chips' }, Object.entries(ACTION_LABEL).map(([a, label]) =>
        h('button', { class: 'chip', 'aria-pressed': String(r.action === a), onclick: () => { r.action = a; markRules(); paint(); } }, label)));
      const days = h('div', { class: 'chips days' }, DAY_SHORT.map((d, di) =>
        h('button', { class: 'chip', 'aria-pressed': String(r.days.includes(di)), onclick: () => {
          r.days = r.days.includes(di) ? r.days.filter((x) => x !== di) : [...r.days, di].sort();
          markRules();
          paint();
        } }, d)));
      const label = h('input', { class: 'text', value: r.label || '', maxlength: 40, placeholder: t('home.timer.ruleLabel'), 'aria-label': t('home.timer.ruleLabelAria') });
      label.addEventListener('input', () => { r.label = label.value; markRules(); });
      card.replaceChildren(
        h('div', { class: 'row' }, timeBtn, h('div', { class: 'grow' }), sw,
          h('button', { class: 'icon-btn', 'aria-label': t('home.timer.ruleDelete'), onclick: () => { rules.splice(i, 1); markRules(); paintRules(); } }, icon('del', 's20'))),
        actions, days, label);
    };
    paint();
    return card;
  }

  function paintRules() {
    scheduleBox.replaceChildren(
      h('p', { class: 'muted small' }, t('home.timer.rulesIntro')),
      ...rules.map(ruleCard),
      h('button', { class: 'btn outlined wide', onclick: () => {
        rules.push({ time: '12:00', days: [0, 1, 2, 3, 4], action: 'on', enabled: true, label: '' });
        markRules();
        paintRules();
      } }, icon('add', 's18'), t('home.timer.ruleAdd')),
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
      snackbar(t('home.timer.rulesSaved'));
      paintRules();
    } catch (e) {
      snackbar(e.message);
      rulesSave.disabled = false;
    }
  }

  // --- Wecker: Android-Apps melden den nächsten Wecker, der Server schaltet vorher ein ---
  const wakeBox = h('div', {}, h('div', { class: 'empty' }, t('home.timer.wakeLoading')));
  let wake = null;
  let wakeDirty = false;
  const deviceToggles = {};
  const wakeSave = h('button', { class: 'btn filled wide', disabled: true, onclick: saveWake }, icon('check', 's18'), t('home.timer.wakeSave'));
  const markWake = () => { wakeDirty = true; wakeSave.disabled = false; };
  const inApp = typeof window.XeniaApp?.checkAlarm === 'function';
  // „Wecker prüfen“: in der Android-App meldet dieses Handy sofort seinen nächsten Wecker; sonst nur neu laden.
  const checkBtn = h('button', { class: 'btn tonal', onclick: async () => {
    checkBtn.disabled = true;
    try {
      if (inApp) {
        const next = Number(window.XeniaApp.checkAlarm());
        // Android meldet den frühesten Wecker aller Apps; die Quelle zeigt, falls er nicht zur Uhr-App passt
        const source = next > 0 ? String(window.XeniaApp.alarmSource?.() || '') : '';
        snackbar(next > 0 ? (source ? t('home.timer.nextAlarmSource', { when: when(next), source }) : t('home.timer.nextAlarm', { when: when(next) })) : t('home.timer.noAlarm'));
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (wakeDirty) snackbar(t('home.timer.unsavedKept'));
      else await loadWake();
    } finally {
      checkBtn.disabled = false;
    }
  } }, icon('refresh', 's18'), t('home.timer.checkAlarm'));
  const when = (ms) => (ms ? new Date(ms).toLocaleString(locale(), withZone({ weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })) : '–');

  function paintWake() {
    const c = wake.config;
    const plan = wake.plan;
    const planText = !c.enabled ? t('home.timer.planOff') : plan ? t('home.timer.plan', { at: when(plan.at), alarm: when(plan.alarm), device: plan.device }) : t('home.timer.noPlan');
    const timeField = (key, label) => {
      const btn = h('button', { type: 'button', class: 'text time-field', 'aria-label': label }, c[key]);
      btn.addEventListener('click', () => pickTime(fromHhmm(c[key]), (m) => { c[key] = hhmm(m); btn.textContent = c[key]; markWake(); }));
      return h('div', { class: 'field grow' }, h('span', {}, label), btn);
    };
    const steamSel = h('select', { class: 'text', 'aria-label': t('home.timer.steamLabel') },
      [['', t('home.timer.steamAsMachine')], ['true', t('home.timer.steamWith')], ['false', t('home.timer.steamWithout')]].map(([v, t]) =>
        h('option', { value: v, selected: String(c.steam ?? '') === v }, t)));
    steamSel.addEventListener('change', () => { c.steam = steamSel.value === '' ? null : steamSel.value === 'true'; markWake(); });
    const devices = wake.devices.length
      ? wake.devices.map((d) => h('div', { class: 'row', style: { padding: '6px 0' } },
        icon('bell', 's20'),
        h('div', { class: 'grow' },
          h('div', {}, d.name),
          h('div', { class: 'small muted' }, d.next > Date.now() ? t('home.timer.deviceNext', { when: when(d.next) }) : t('home.timer.deviceNone'), t('home.timer.deviceReported', { when: when(d.updated) }))),
        switchEl({ checked: deviceToggles[d.id] ?? d.enabled, label: t('home.timer.deviceUse', { name: d.name }), onChange: (on) => { deviceToggles[d.id] = on; markWake(); } }),
        h('button', { class: 'icon-btn', 'aria-label': t('home.timer.deviceRemove', { name: d.name }), onclick: async () => {
          try { wake = await api(`/api/wake/devices/${d.id}`, { method: 'DELETE' }); paintWake(); } catch (e) { snackbar(e.message); }
        } }, icon('del', 's20'))))
      : [h('div', { class: 'muted small' }, t('home.timer.noDevices'))];
    wakeBox.replaceChildren(h('div', { class: 'card' },
      h('div', { class: 'row' }, h('div', { class: 'grow' }, h('strong', {}, t('home.timer.wakeTitle')), h('div', { class: 'small muted' }, planText)),
        switchEl({ checked: c.enabled, label: t('home.timer.wakeAuto'), onChange: (on) => { c.enabled = on; markWake(); } })),
      sliderRow({ label: t('home.timer.lead'), min: 1, max: 60, step: 1, value: c.leadMin, unit: 'min', digits: 0, onInput: (v) => { c.leadMin = v; markWake(); } }),
      h('label', { class: 'field', style: { 'margin-top': '8px' } }, h('span', {}, t('home.timer.steamLabel')), steamSel),
      h('div', { class: 'small muted', style: { 'margin-top': '12px' } }, t('home.timer.window')),
      h('div', { class: 'row' }, timeField('from', t('home.timer.earliest')), timeField('to', t('home.timer.latest'))),
      h('div', { class: 'chips days', style: { 'margin-top': '8px' } }, DAY_SHORT.map((d, di) =>
        h('button', { class: 'chip', 'aria-pressed': String(c.days.includes(di)), onclick: () => {
          c.days = c.days.includes(di) ? c.days.filter((x) => x !== di) : [...c.days, di].sort();
          markWake();
          paintWake();
        } }, d))),
      h('div', { class: 'row', style: { 'margin-top': '16px' } }, h('h3', { class: 'grow', style: { margin: 0 } }, t('home.timer.phones')), checkBtn),
      ...devices,
      inApp ? h('button', { class: 'btn text', onclick: () => window.XeniaApp.showAlarms() }, icon('clock', 's18'), t('home.timer.showAlarms')) : null,
      h('p', { class: 'muted small' }, t('home.timer.wakeHelp')),
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
      snackbar(t('home.timer.wakeSaved'));
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
    if (dirty || rulesDirty || wakeDirty) snackbar(t('home.timer.unsaved'));
  };
}

// Zeitwähler der App (statt des Browser-Popups, das am Desktop irgendwo am Bildschirmrand aufgeht)
async function pickTime(current, onPick, allowClear = false) {
  const v = await pickTimeDialog({ title: t('home.timer.pickTime'), value: current, allowClear });
  if (v !== undefined) onPick(v);
}
