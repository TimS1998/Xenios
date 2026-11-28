// Skripte: Liste, Start/Stopp, Editor, Export/Import.
import { h, icon, fmt, snackbar, sheet, confirmDialog, fullscreen, sliderRow, switchEl, ago } from '../ui.js';
import { api, store, subscribe, machineOn, scriptActive, directMode, hasGrinder } from '../api.js';
import { navigate } from '../app.js';
import { shotChart } from '../gauge.js';
import { targetCurve, profileSteps } from '../../shared/shot-analysis.js';
import { scriptName } from '../../shared/visualizer.js';
import { openCommunity } from './community.js';
import { startBackflush } from './shots.js';
import { t, locale } from '../../shared/i18n.js';

export function scriptsView(root) {
  return listTab(root);
}

const TYPE_LABEL = {
  get standard() { return t('shots.scripts.type.standard'); },
  get pressure() { return t('shots.scripts.type.pressure'); },
  get paddle() { return t('shots.scripts.type.paddle'); },
  get builtin() { return t('shots.scripts.type.builtin'); },
};

// --- Skripte -------------------------------------------------------------------
function listTab(root) {
  const features = store.server?.features || {};
  let data = { scripts: [], ops: {}, builtin: {} };
  let sortBy = 'name';
  let gbs = null;
  const gbsBox = h('div', {});
  const listEl = h('div', { class: 'list' }, h('div', { class: 'empty' }, t('shots.scripts.loading')));
  const sortBtn = h('button', { class: 'btn text', onclick: () => { sortBy = sortBy === 'name' ? 'id' : 'name'; sortBtn.lastChild.textContent = sortBy === 'name' ? t('shots.scripts.sortName') : t('shots.scripts.sortId'); paint(); } }, icon('sort', 's18'), h('span', {}, t('shots.scripts.sortName')));
  const stopBtn = h('button', { class: 'btn danger wide big', disabled: true, onclick: stop } /* erst aktiv, wenn ein laufendes Skript erkannt ist */, icon('stop', 's20'), t('shots.scripts.stop'));

  const runButtons = [];
  // Neu anlegen, Druckprofil, Entdecken und Import als beschriftete Einträge (wie die Unterseiten der Einstellungen)
  const entry = (ic, title, sub, onclick) => h('button', { class: 'list-item clickable as-button', type: 'button', onclick },
    h('span', { class: 'lead' }, icon(ic)), h('div', { class: 'grow' }, h('div', { class: 'title' }, title), h('div', { class: 'sub' }, sub)), icon('right', 's20 muted'));
  let tools = null;
  if (features.scriptEditor) {
    const fileInput = h('input', { type: 'file', accept: '.script,application/json,text/plain', hidden: true, onchange: () => importFile(fileInput) });
    tools = h('div', { class: 'list' },
      entry('add', t('shots.scripts.createTitle'), t('shots.scripts.createSub'), () => navigate('/skripte/neu')),
      entry('profile', t('shots.scripts.profileTitle'), t('shots.scripts.profileSub'), () => navigate('/skripte/profil')),
      directMode ? null : entry('explore', t('shots.scripts.discoverTitle'), t('shots.scripts.discoverSub'), () => navigate('/skripte/entdecken')),
      entry('upload', t('shots.scripts.importTitle'), t('shots.scripts.importSub'), () => fileInput.click()), fileInput);
  }

  async function importFile(input) {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    if (f.size > 32 * 1024) return snackbar(t('shots.scripts.fileTooBig'));
    try {
      const r = await api('/api/machine/scripts/import', { method: 'POST', body: { file: await f.text() } });
      snackbar(t('shots.scripts.imported', { name: r.name, steps: r.steps }));
      load();
    } catch (e) {
      snackbar(e.message);
    }
  }

  root.append(
    h('div', { class: 'section-title' }, t('shots.scripts.quickStart')),
    h('div', { class: 'quick' },
      quickBtn(t('shots.scripts.quickSingle'), 7), quickBtn(t('shots.scripts.quickDouble'), 8), quickBtn(t('shots.scripts.quickContinuous'), 2), backflushBtn()),
    h('div', { style: { height: '12px' } }),
    stopBtn,
    gbsBox,
    tools ? h('div', { style: { 'margin-top': '16px' } }, tools) : null,
    h('div', { class: 'section-title with-action' }, h('span', {}, t('shots.scripts.all')), sortBtn),
    listEl,
  );

  // Grind-by-Sync: welches Profil der Drehknopf der Mühle startet (nur mit Server). Alte Xenia (DBL): Xenios spielt
  // der Mühle die neue Xenia vor und stoppt den Bezug selbst am Gewicht der Bluetooth-Waage.
  const STOPPED = {
    get weight() { return t('shots.gbs.stopped.weight'); },
    get machine() { return t('shots.gbs.stopped.machine'); },
    get noweight() { return t('shots.gbs.stopped.noweight'); },
    get max() { return t('shots.gbs.stopped.max'); },
    get nostart() { return t('shots.gbs.stopped.nostart'); },
  };
  function paintGbs() {
    if (!hasGrinder() || !gbs) return gbsBox.replaceChildren();
    const dbl = gbs.mode === 'dbl';
    if (!gbs.enabled) {
      return gbsBox.replaceChildren(h('div', { class: 'section-title' }, 'Grind-by-Sync'),
        h('div', { class: 'card gbs-card' }, h('div', { class: 'row' },
          h('div', { class: 'grow small muted' }, dbl
            ? t('shots.gbs.offDbl')
            : t('shots.gbs.offNew')),
          h('button', { class: 'btn tonal', onclick: () => navigate('/einstellungen/muehle') }, t('shots.gbs.setup')))));
    }
    const editable = dbl || features.scriptEditor;
    const choices = data.scripts.filter((s) => (s.type === 'standard' || s.type === 'pressure') && s.title !== gbs.helperName);
    const sel = h('select', { class: 'text', 'aria-label': t('shots.gbs.selectAria'), disabled: !editable },
      h('option', { value: '', selected: !gbs.scriptId }, dbl ? t('shots.gbs.defaultScript', { name: data.builtin?.[gbs.defaultScriptId] || 'Espresso endlos', id: gbs.defaultScriptId }) : t('shots.gbs.original')),
      choices.map((s) => h('option', { value: String(s.id), selected: s.id === gbs.scriptId }, t('shots.gbs.scriptOption', { title: s.title, id: s.id }))),
      gbs.scriptId && !choices.some((s) => s.id === gbs.scriptId) ? h('option', { value: String(gbs.scriptId), selected: true }, data.scripts.length ? t('shots.gbs.scriptGone', { id: gbs.scriptId }) : t('shots.gbs.scriptMissing', { id: gbs.scriptId })) : null);
    sel.addEventListener('change', () => saveGbs({ scriptId: sel.value ? Number(sel.value) : null }));
    const g = gbs.lastGrind;
    const st = gbs.lastStart;
    const last = gbs.dbl?.last;
    const lines = [
      gbs.lastContact ? t('shots.gbs.lastContact', { ago: ago(gbs.lastContact) }) : t('shots.gbs.noContact'),
      g ? (g.weight ? t('shots.gbs.lastRecipe', { weight: fmt(g.weight), ago: ago(g.at) }) : t('shots.gbs.lastRecipeNoWeight', { ago: ago(g.at) })) : t('shots.gbs.noGrind'),
      st ? t(st.ok ? 'shots.gbs.lastStart' : 'shots.gbs.lastStartRefused', {
        what: st.swapped ? t('shots.gbs.startSwapped', { title: st.title, weight: st.weight != null ? fmt(st.weight, st.weight % 1 ? 1 : 0) : '?' }) : t('shots.gbs.originalScript'),
        ago: ago(st.at),
      }) : null,
      last ? (last.weightG !== null
        ? t('shots.gbs.lastShot', { time: fmt(last.timeMs / 1000), weight: fmt(last.weightG), target: fmt(last.target, 0), stopped: STOPPED[last.stoppedBy] || last.stoppedBy })
        : t('shots.gbs.lastShotNoWeight', { time: fmt(last.timeMs / 1000), stopped: STOPPED[last.stoppedBy] || last.stoppedBy })) : null,
    ].filter(Boolean);
    const scaleOff = dbl && store.machine?.scaleLink?.connected === false;
    gbsBox.replaceChildren(h('div', { class: 'section-title' }, 'Grind-by-Sync'),
      h('div', { class: 'card gbs-card' },
        dbl ? h('p', { class: 'small muted' }, t('shots.gbs.dblInfo', { lead: fmt(gbs.dbl?.leadS ?? 1) })) : null,
        h('label', { class: 'field' }, h('span', {}, t('shots.gbs.profileLabel')), sel),
        dbl ? null : h('div', { class: 'row toggle-row' },
          h('div', { class: 'grow' }, h('div', {}, t('shots.gbs.extend')),
            h('div', { class: 'small muted' }, t('shots.gbs.extendSub'))),
          switchEl({ checked: gbs.extend, disabled: !features.scriptEditor, label: t('shots.gbs.extend'), onChange: (on) => saveGbs({ extend: on }) })),
        h('div', { class: 'small muted gbs-status' }, lines.map((l) => h('div', {}, l))),
        scaleOff && !gbs.lastError ? h('div', { class: 'note warn' }, icon('warn', 's18'), h('span', {}, t('shots.gbs.scaleOff'))) : null,
        gbs.lastError ? h('div', { class: 'note warn' }, icon('warn', 's18'), h('span', {}, dbl ? t('shots.gbs.errorDbl', { error: gbs.lastError }) : t('shots.gbs.errorOriginal', { error: gbs.lastError }))) : null,
        gbs.refused && !gbs.lastContact ? h('div', { class: 'note warn' }, icon('warn', 's18'), h('span', {}, t('shots.gbs.refused', { ip: gbs.refused.ip, grinderIp: gbs.grinderIp || t('shots.gbs.ipMissing') }))) : null,
        editable ? null : h('p', { class: 'small muted' }, t('shots.gbs.editorOff'))));
  }
  async function saveGbs(change) {
    try {
      gbs = await api('/api/gbs', { method: 'PUT', body: change });
      snackbar(change.scriptId === null ? (gbs.mode === 'dbl' ? t('shots.gbs.resetDbl') : t('shots.gbs.resetOriginal')) : t('shots.common.saved'));
    } catch (e) {
      snackbar(e.message);
    }
    paintGbs();
  }

  function quickBtn(label, id) {
    const b = h('button', { class: 'btn tonal', disabled: !machineOn(), onclick: () => run(id, label) }, icon('play', 's18'), label);
    runButtons.push(b);
    return b;
  }
  // Backflush über die direkte Pumpensteuerung (10 Runden, mit Blindsieb); zählt nicht als Bezug
  function backflushBtn() {
    const b = h('button', { class: 'btn tonal', disabled: !machineOn(), onclick: startBackflush }, icon('play', 's18'), t('shots.care.title'));
    runButtons.push(b);
    return b;
  }
  function paintEnabled() {
    const on = machineOn();
    for (const b of runButtons) b.disabled = !on;
    stopBtn.disabled = !scriptActive(); // nur drückbar, solange ein Skript, Bezug oder Backflush läuft
  }

  async function run(id, title) {
    try {
      await api(`/api/machine/scripts/${id}/run`, { method: 'POST' });
      snackbar(t('shots.scripts.started', { title }), { action: t('shots.common.stop'), onAction: stop, duration: 6000 });
    } catch (e) {
      snackbar(e.status === 502 ? t('shots.common.startFailed') : e.message);
    }
  }
  async function stop() {
    try {
      const r = await api('/api/machine/scripts/stop', { method: 'POST' });
      snackbar(r.backflush ? t('shots.backflush.stopping') : r.stopped ? t('shots.scripts.stopped') : t('shots.scripts.nothingStopped'));
    } catch (e) {
      snackbar(e.message);
    }
  }

  function paint() {
    const list = [...data.scripts].sort((a, b) => (sortBy === 'name' ? a.title.localeCompare(b.title, locale()) : a.id - b.id));
    if (!list.length) {
      listEl.replaceChildren(h('div', { class: 'empty' }, t('shots.scripts.empty'), features.scriptEditor ? h('div', {}, h('button', { class: 'btn text', onclick: () => navigate('/skripte/neu') }, icon('add', 's18'), t('shots.scripts.create'))) : null));
      return;
    }
    runButtons.splice(4); // die vier Schnellstart-Knöpfe bleiben
    listEl.replaceChildren(...list.map((s) => {
      const play = h('button', { class: 'icon-btn tonal', 'aria-label': t('shots.scripts.startAria', { title: s.title }), disabled: !machineOn(), onclick: () => run(s.id, s.title) }, icon('play'));
      runButtons.push(play);
      return h('div', { class: 'script-item' },
        h('div', { class: 'grow' }, h('div', { class: 't' }, s.title), h('div', { class: 'id' }, t('shots.scripts.idLine', { id: s.id, type: s.title === gbs?.helperName ? t('shots.scripts.gbsManaged') : TYPE_LABEL[s.type] || s.type }))),
        h('a', { class: 'icon-btn', href: `/api/machine/scripts/${s.id}/export`, download: '', 'aria-label': t('shots.scripts.exportAria', { title: s.title }), title: t('shots.scripts.exportTitle') }, icon('download', 's20')),
        features.scriptEditor ? h('button', { class: 'icon-btn', 'aria-label': t('shots.scripts.editAria', { title: s.title }), onclick: () => navigate(`/skripte/bearbeiten?id=${s.id}`) }, icon('edit', 's20')) : null,
        play);
    }));
  }

  async function load() {
    if (!directMode && hasGrinder()) gbs = await api('/api/gbs').catch(() => null);
    try {
      data = await api('/api/machine/scripts');
      paint();
    } catch (e) {
      listEl.replaceChildren(h('div', { class: 'empty' }, e.message));
    }
    paintGbs();
  }
  load();
  paintEnabled();
  const un = subscribe((part) => {
    if (part === 'machine' || part === 'all' || part === 'conn') paintEnabled();
  });
  return un;
}

// --- Skript-Editor -----------------------------------------------------------------
async function openEditor(script, data, onSaved, host = fullscreen) {
  const ops = data.ops || {};
  let steps = [];
  let name = script?.title || '';
  if (script) {
    try {
      const full = await api(`/api/machine/scripts/${script.id}`);
      steps = full.steps;
      name = full.title || name;
    } catch (e) {
      return snackbar(e.message);
    }
  } else {
    steps = [{ op: 13, args: [] }, { op: 4, args: [9, 25] }, { op: 6, args: [] }];
  }

  host((root, close) => {
    const nameInput = h('input', { class: 'text', value: name, maxlength: 40, placeholder: t('shots.editor.namePlaceholder'), 'aria-label': t('shots.editor.name') });
    const listEl = h('div', {});
    const expanded = new Set();

    const header = h('div', { class: 'row', style: { margin: '4px 0 16px' } },
      h('div', { class: 'grow' }, host.page ? null : h('strong', {}, script ? t('common.edit') : t('shots.editor.newTitle'))),
      h('button', { class: 'btn grey', onclick: close }, t('common.cancel')),
      h('button', { class: 'btn filled', onclick: save }, t('common.save')));

    function paint() {
      listEl.replaceChildren(...steps.map((st, i) => {
        const def = ops[st.op] || { name: t('shots.editor.command', { op: st.op }) };
        const open = expanded.has(i);
        const body = h('div', { class: 'step-body', hidden: !open || !def.args?.length },
          ...(def.args || []).map((a, ai) => sliderRow({
            label: `${a.name}${a.unit ? ` (${a.unit})` : ''}`, min: a.min, max: a.max, step: a.step, value: st.args?.[ai] ?? a.min,
            digits: a.step < 1 ? 1 : 0, onInput: (v) => { st.args[ai] = v; summary.textContent = argSummary(def, st); },
          })));
        const summary = h('span', { class: 'sum' }, argSummary(def, st));
        return h('div', { class: 'step' },
          h('div', { class: 'step-head' },
            h('span', { class: 'n' }, String(i + 1)),
            h('span', { class: 'name', onclick: () => { open ? expanded.delete(i) : expanded.add(i); paint(); } }, h('span', { class: 'title' }, def.name), def.args?.length ? summary : null),
            h('button', { class: 'icon-btn', 'aria-label': t('shots.editor.up'), disabled: i === 0, onclick: () => move(i, -1) }, icon('up', 's18')),
            h('button', { class: 'icon-btn', 'aria-label': t('shots.editor.down'), disabled: i === steps.length - 1, onclick: () => move(i, 1) }, icon('down', 's18')),
            def.args?.length ? h('button', { class: 'icon-btn', 'aria-label': t('shots.editor.values'), onclick: () => { open ? expanded.delete(i) : expanded.add(i); paint(); } }, icon(open ? 'less' : 'more', 's20')) : null,
            h('button', { class: 'icon-btn', 'aria-label': t('shots.editor.remove'), onclick: () => { steps.splice(i, 1); expanded.clear(); paint(); } }, icon('close', 's18'))),
          body);
      }), h('button', { class: 'btn outlined wide', onclick: addStep }, icon('add', 's18'), t('shots.editor.addStep')));
    }
    function move(i, d) {
      const [s] = steps.splice(i, 1);
      steps.splice(i + d, 0, s);
      expanded.clear();
      paint();
    }
    function addStep() {
      const entries = Object.entries(ops).filter(([, d]) => !d.internal);
      let closeSheet;
      const grid = h('div', { class: 'ops' }, entries.map(([op, d]) => h('button', { class: 'btn tonal', onclick: () => {
        steps.push({ op: Number(op), args: (d.args || []).map((a) => defaultArg(a)) });
        expanded.clear();
        expanded.add(steps.length - 1);
        closeSheet();
        paint();
      } }, d.name)));
      closeSheet = sheet(t('shots.editor.addStep'), grid);
    }
    async function save() {
      const n = nameInput.value.trim();
      if (!/^[A-Za-z0-9\-_# ]{1,40}$/.test(n)) return snackbar(t('shots.editor.badName'));
      if (!steps.length) return snackbar(t('shots.editor.noSteps'));
      try {
        if (script) await api(`/api/machine/scripts/${script.id}`, { method: 'PUT', body: { name: n, steps, kind: script.type === 'paddle' ? 'paddle' : 'standard' } });
        else await api('/api/machine/scripts', { method: 'POST', body: { name: n, steps } });
        snackbar(t('shots.editor.saved'));
        close();
        onSaved?.();
      } catch (e) {
        snackbar(e.message);
      }
    }
    async function remove() {
      if (!(await confirmDialog(t('shots.editor.deleteTitle'), t('shots.editor.deleteText', { title: script.title }), t('common.delete'), 'danger'))) return;
      try {
        await api(`/api/machine/scripts/${script.id}`, { method: 'DELETE' });
        snackbar(t('shots.editor.deleted'));
        close();
        onSaved?.();
      } catch (e) {
        snackbar(e.message);
      }
    }

    root.append(header,
      h('label', { class: 'field' }, h('span', {}, t('shots.editor.name')), nameInput),
      h('div', { class: 'section-title' }, t('shots.editor.flow')),
      h('p', { class: 'muted small' }, t('shots.editor.flowHint')),
      listEl,
      script && script.id > 9 ? h('button', { class: 'btn text', style: { color: 'var(--danger)', 'margin-top': '24px' }, onclick: remove }, icon('del', 's18'), t('shots.editor.delete')) : null);
    paint();
  });
}

function defaultArg(a) {
  if (a.name === 'Dauer' && a.unit === 's') return 5;
  if (a.name === 'Druck') return 9;
  if (a.name === 'Leistung' && a.max === 100) return 60;
  if (a.name === 'Leistung') return 100;
  if (a.name === 'Temperatur') return 92;
  if (a.name === 'Menge') return 36;
  if (a.name === 'Töne') return 1;
  if (a.unit === 'ms') return 300;
  return a.min;
}

function argSummary(def, st) {
  if (!def.args?.length) return '';
  // eigene Zeile unter dem Namen; Zahl und Einheit bleiben zusammen (geschütztes Leerzeichen)
  return def.args.map((a, i) => `${fmt(st.args?.[i], a.step < 1 ? 1 : 0)}${a.unit ? '\u00a0' + a.unit : ''}`).join(' · ');
}

// --- Druckprofil-Baukasten --------------------------------------------------------
// Erzeugt ein normales Skript der Maschine (läuft also auch über die Tasten):
// Brühventil auf → Vorbrühen → optional Pause (Pumpe aus) → Hauptdruck → optional Abfall in vier Stufen → Pumpe aus.
// Vorlagen nach dem Profil-Leitfaden von Decent Espresso, nur der Druckanteil. Fluss- und Temperaturvorgaben der
// Decent kann ein Xenia-Skript so nicht nachbilden; Zahlen, die der Leitfaden offen lässt, sind übliche Werte.
const PROFILE_PRESETS = () => [
  { name: t('shots.profile.presets.classic.name'), roast: t('shots.profile.presets.classic.roast'), hint: t('shots.profile.presets.classic.hint'), v: { preP: 2, preT: 4, pauseT: 0, mainP: 9, mainT: 25, endP: 9, declineT: 0 } },
  { name: t('shots.profile.presets.e61.name'), roast: t('shots.profile.presets.e61.roast'), hint: t('shots.profile.presets.e61.hint'), v: { preP: 0, preT: 0, pauseT: 0, mainP: 9, mainT: 27, endP: 9, declineT: 0 } },
  { name: t('shots.profile.presets.best.name'), roast: t('shots.profile.presets.best.roast'), hint: t('shots.profile.presets.best.hint'), v: { preP: 3, preT: 6, pauseT: 0, mainP: 9, mainT: 6, endP: 6, declineT: 18 } },
  { name: t('shots.profile.presets.mild.name'), roast: t('shots.profile.presets.mild.roast'), hint: t('shots.profile.presets.mild.hint'), v: { preP: 2, preT: 4, pauseT: 0, mainP: 6, mainT: 30, endP: 6, declineT: 0 } },
  { name: t('shots.profile.presets.turbo.name'), roast: t('shots.profile.presets.turbo.roast'), hint: t('shots.profile.presets.turbo.hint'), v: { preP: 2, preT: 3, pauseT: 0, mainP: 6, mainT: 15, endP: 6, declineT: 0 } },
  { name: t('shots.profile.presets.blooming.name'), roast: t('shots.profile.presets.blooming.roast'), hint: t('shots.profile.presets.blooming.hint'), v: { preP: 3, preT: 10, pauseT: 25, mainP: 8.5, mainT: 6, endP: 6, declineT: 20 } },
  { name: t('shots.profile.presets.allonge.name'), roast: t('shots.profile.presets.allonge.roast'), hint: t('shots.profile.presets.allonge.hint'), v: { preP: 2, preT: 4, pauseT: 0, mainP: 8, mainT: 4, endP: 6, declineT: 26 } },
  { name: t('shots.profile.presets.londinium.name'), roast: t('shots.profile.presets.londinium.roast'), hint: t('shots.profile.presets.londinium.hint'), v: { preP: 3, preT: 10, pauseT: 0, mainP: 9, mainT: 4, endP: 5, declineT: 22 } },
  { name: t('shots.profile.presets.cremina.name'), roast: t('shots.profile.presets.cremina.roast'), hint: t('shots.profile.presets.cremina.hint'), v: { preP: 2.5, preT: 12, pauseT: 0, mainP: 8.5, mainT: 6, endP: 4, declineT: 30 } },
  { name: t('shots.profile.presets.eighties.name'), roast: t('shots.profile.presets.eighties.roast'), hint: t('shots.profile.presets.eighties.hint'), v: { preP: 3, preT: 8, pauseT: 0, mainP: 8, mainT: 10, endP: 6, declineT: 24 } },
];

function openProfileBuilder(onSaved, host = fullscreen) {
  const presets = PROFILE_PRESETS();
  let preset = presets[0];
  const p = { ...preset.v, basket: 'none', name: t('shots.profile.scriptName', { name: preset.name }) };
  host((root, close) => {
    const preview = h('div', { class: 'chart-box' });
    const summary = h('p', { class: 'small muted' });
    const presetInfo = h('div', { class: 'preset-info' });
    const nameInput = h('input', { class: 'text', value: p.name, maxlength: 40, 'aria-label': t('shots.profile.name'), placeholder: t('shots.editor.namePlaceholder') });
    nameInput.addEventListener('input', () => { p.name = nameInput.value; });
    const rows = {};
    const slider = (key, label, min, max, step, unit) => {
      rows[key] = sliderRow({ label, min, max, step, value: p[key], unit, digits: step < 1 ? 1 : 0, onInput: (v) => { p[key] = v; redraw(); } });
      return rows[key];
    };
    function redraw() {
      const steps = profileSteps(p);
      preview.replaceChildren(shotChart([], { width: 640, height: 220, minSeconds: 20, target: targetCurve(steps) }));
      const total = p.preT + p.pauseT + p.mainT + (p.endP !== p.mainP ? p.declineT : 0);
      summary.textContent = t('shots.profile.summary', { steps: steps.length, total: fmt(total) });
    }
    const presetChips = h('div', { class: 'chips' }, presets.map((pr) => h('button', { class: 'chip', onclick: () => {
      preset = pr;
      Object.assign(p, pr.v);
      p.name = scriptName(t('shots.profile.scriptName', { name: pr.name }));
      nameInput.value = p.name;
      for (const [key, row] of Object.entries(rows)) row.setValue(p[key]);
      paintPreset();
      redraw();
    } }, pr.name)));
    function paintPreset() {
      for (const c of presetChips.children) c.setAttribute('aria-pressed', String(c.textContent === preset.name));
      presetInfo.replaceChildren(h('strong', {}, preset.roast), ` · ${preset.hint}`);
    }
    const basket = h('select', { class: 'text', 'aria-label': t('shots.profile.basketAria') },
      [['none', t('shots.profile.basketNone')], ['single', t('shots.profile.basketSingle')], ['double', t('shots.profile.basketDouble')]].map(([v, label]) => h('option', { value: v }, label)));
    basket.addEventListener('change', () => { p.basket = basket.value; redraw(); });

    async function save() {
      try {
        await api('/api/machine/scripts', { method: 'POST', body: { name: p.name.trim(), steps: profileSteps(p), kind: 'standard' } });
        snackbar(t('shots.profile.savedAsScript', { name: p.name.trim() }));
        close();
        onSaved?.();
      } catch (e) {
        snackbar(e.message);
      }
    }
    root.append(
      h('div', { class: 'row', style: { margin: '4px 0 12px' } },
        h('div', { class: 'grow' }, host.page ? null : h('strong', {}, t('shots.profile.title'))),
        h('button', { class: 'btn grey', onclick: close }, t('common.cancel')),
        h('button', { class: 'btn filled', onclick: save }, t('common.save'))),
      h('div', { class: 'card' }, preview, summary),
      h('div', { class: 'section-title' }, t('shots.profile.preset')),
      presetChips,
      h('div', { class: 'card preset-card' }, presetInfo,
        h('p', { class: 'small muted' }, t('shots.profile.decentNote'))),
      h('div', { class: 'card', style: { 'margin-top': '12px' } },
        h('label', { class: 'field' }, h('span', {}, t('shots.profile.name')), nameInput),
        h('label', { class: 'field', style: { 'margin-top': '8px' } }, h('span', {}, t('shots.profile.basket')), basket)),
      h('div', { class: 'card' }, h('h3', {}, t('shots.profile.pre')),
        slider('preP', t('shots.profile.pressure'), 0, 6, 0.5, 'bar'), slider('preT', t('shots.profile.duration'), 0, 15, 0.5, 's'),
        slider('pauseT', t('shots.profile.pause'), 0, 40, 1, 's')),
      h('div', { class: 'card' }, h('h3', {}, t('shots.profile.main')),
        slider('mainP', t('shots.profile.pressure'), 4, 10, 0.5, 'bar'), slider('mainT', t('shots.profile.duration'), 3, 45, 1, 's')),
      h('div', { class: 'card' }, h('h3', {}, t('shots.profile.decline')),
        slider('endP', t('shots.profile.endPressure'), 3, 10, 0.5, 'bar'), slider('declineT', t('shots.profile.duration'), 0, 30, 1, 's'),
        h('p', { class: 'small muted' }, t('shots.profile.declineNote'))));
    paintPreset();
    redraw();
  });
}

// --- Unterseiten (statt Vollbild-Fenster): Zurück-Pfeil, Zurück-Taste und Animation wie in den Einstellungen ---------
// Abbrechen/Speichern führt zur Skriptliste zurück.
function pageHost(root) {
  const host = (build) => build(root, () => navigate('/skripte', { replace: true }));
  host.page = true;
  return host;
}
export function scriptNewView(root) {
  root.append(h('div', { class: 'empty' }, t('shots.common.loading')));
  api('/api/machine/scripts').then((data) => { root.replaceChildren(); openEditor(null, data, null, pageHost(root)); })
    .catch((e) => root.replaceChildren(h('div', { class: 'empty' }, e.message)));
}
export function scriptEditView(root) {
  const id = Number(new URLSearchParams(location.search).get('id'));
  root.append(h('div', { class: 'empty' }, t('shots.common.loading')));
  api('/api/machine/scripts').then((data) => {
    const script = (data.scripts || []).find((x) => x.id === id);
    if (!script) return root.replaceChildren(h('div', { class: 'empty' }, t('shots.scripts.notFound')));
    root.replaceChildren();
    openEditor(script, data, null, pageHost(root));
  }).catch((e) => root.replaceChildren(h('div', { class: 'empty' }, e.message)));
}
export function profileBuilderView(root) {
  openProfileBuilder(null, pageHost(root));
}
export function discoverView(root) {
  openCommunity(null, pageHost(root));
}
