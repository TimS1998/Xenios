// Skripte: Liste, Start/Stopp, Editor, Export/Import.
import { h, icon, fmt, snackbar, sheet, confirmDialog, fullscreen, sliderRow, switchEl } from '../ui.js';
import { api, store, subscribe, machineOn } from '../api.js';
import { setTopActions } from '../app.js';

export function scriptsView(root) {
  return listTab(root);
}

const TYPE_LABEL = { standard: 'Skript', pressure: 'Druckprofil', paddle: 'Paddle', builtin: 'Eingebaut' };

// --- Skripte -------------------------------------------------------------------
function listTab(root) {
  const features = store.server?.features || {};
  let data = { scripts: [], ops: {}, builtin: {} };
  let sortBy = 'name';
  const listEl = h('div', { class: 'list' }, h('div', { class: 'empty' }, 'Lade Skripte …'));
  const sortBtn = h('button', { class: 'btn text', onclick: () => { sortBy = sortBy === 'name' ? 'id' : 'name'; sortBtn.lastChild.textContent = sortBy === 'name' ? 'Name' : 'ID'; paint(); } }, icon('sort', 's18'), h('span', {}, 'Name'));
  const stopBtn = h('button', { class: 'btn danger wide big', onclick: stop }, icon('stop', 's20'), 'Skript stoppen');

  const runButtons = [];
  if (features.scriptEditor) {
    const fileInput = h('input', { type: 'file', accept: '.script,application/json,text/plain', hidden: true, onchange: () => importFile(fileInput) });
    setTopActions(
      h('button', { class: 'icon-btn', 'aria-label': 'Skript importieren (.script)', title: 'Skript importieren (.script)', onclick: () => fileInput.click() }, icon('upload'), fileInput),
      h('button', { class: 'icon-btn', 'aria-label': 'Neues Skript', onclick: () => openEditor(null, data, load) }, icon('add')));
  }

  async function importFile(input) {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    if (f.size > 32 * 1024) return snackbar('Datei zu groß für ein Skript');
    try {
      const r = await api('/api/machine/scripts/import', { method: 'POST', body: { file: await f.text() } });
      snackbar(`„${r.name}“ importiert (${r.steps} Schritte)`);
      load();
    } catch (e) {
      snackbar(e.message);
    }
  }

  root.append(
    h('div', { class: 'section-title' }, 'Schnellstart'),
    h('div', { class: 'quick' },
      quickBtn('Einfach', 7), quickBtn('Doppelt', 8), quickBtn('Dauerbezug', 2)),
    h('div', { style: { height: '12px' } }),
    stopBtn,
    h('div', { class: 'section-title with-action' }, h('span', {}, 'Alle Skripte'), sortBtn),
    listEl,
  );

  function quickBtn(label, id) {
    const b = h('button', { class: 'btn tonal', disabled: !machineOn(), onclick: () => run(id, label) }, icon('play', 's18'), label);
    runButtons.push(b);
    return b;
  }
  function paintEnabled() {
    const on = machineOn();
    for (const b of runButtons) b.disabled = !on;
    stopBtn.disabled = !on;
  }

  async function run(id, title) {
    try {
      await api(`/api/machine/scripts/${id}/run`, { method: 'POST' });
      snackbar(`„${title}“ gestartet`, { action: 'Stopp', onAction: stop, duration: 6000 });
    } catch (e) {
      snackbar(e.status === 502 ? 'Start nicht möglich (Maschine aus oder nicht bereit?)' : e.message);
    }
  }
  async function stop() {
    try {
      const r = await api('/api/machine/scripts/stop', { method: 'POST' });
      snackbar(r.stopped ? 'Skript gestoppt' : 'Kein Skript aktiv – nichts gestoppt');
    } catch (e) {
      snackbar(e.message);
    }
  }

  function paint() {
    const list = [...data.scripts].sort((a, b) => (sortBy === 'name' ? a.title.localeCompare(b.title, 'de') : a.id - b.id));
    if (!list.length) {
      listEl.replaceChildren(h('div', { class: 'empty' }, 'Keine eigenen Skripte auf der Maschine.', features.scriptEditor ? h('div', {}, h('button', { class: 'btn text', onclick: () => openEditor(null, data, load) }, icon('add', 's18'), 'Skript anlegen')) : null));
      return;
    }
    runButtons.splice(3); // die drei Schnellstart-Knöpfe bleiben
    listEl.replaceChildren(...list.map((s) => {
      const play = h('button', { class: 'icon-btn tonal', 'aria-label': `${s.title} starten`, disabled: !machineOn(), onclick: () => run(s.id, s.title) }, icon('play'));
      runButtons.push(play);
      return h('div', { class: 'script-item' },
        h('div', { class: 'grow' }, h('div', { class: 't' }, s.title), h('div', { class: 'id' }, `ID: ${s.id} · ${TYPE_LABEL[s.type] || s.type}`)),
        h('a', { class: 'icon-btn', href: `/api/machine/scripts/${s.id}/export`, download: '', 'aria-label': `${s.title} exportieren`, title: 'Exportieren (.script)' }, icon('download', 's20')),
        features.scriptEditor ? h('button', { class: 'icon-btn', 'aria-label': `${s.title} bearbeiten`, onclick: () => openEditor(s, data, load) }, icon('edit', 's20')) : null,
        play);
    }));
  }

  async function load() {
    try {
      data = await api('/api/machine/scripts');
      paint();
    } catch (e) {
      listEl.replaceChildren(h('div', { class: 'empty' }, e.message));
    }
  }
  load();
  paintEnabled();
  const un = subscribe((part) => {
    if (part === 'machine' || part === 'all' || part === 'conn') paintEnabled();
  });
  return un;
}

// --- Skript-Editor -----------------------------------------------------------------
async function openEditor(script, data, onSaved) {
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

  fullscreen((root, close) => {
    const nameInput = h('input', { class: 'text', value: name, maxlength: 40, placeholder: 'Name (A–Z, 0–9, - _ #)', 'aria-label': 'Name' });
    const listEl = h('div', {});
    const expanded = new Set();

    const header = h('div', { class: 'row', style: { margin: '4px 0 16px' } },
      h('div', { class: 'grow' }, h('strong', {}, script ? 'Bearbeiten' : 'Neues Skript')),
      h('button', { class: 'btn grey', onclick: close }, 'Abbrechen'),
      h('button', { class: 'btn filled', onclick: save }, 'Speichern'));

    function paint() {
      listEl.replaceChildren(...steps.map((st, i) => {
        const def = ops[st.op] || { name: `Befehl ${st.op}` };
        const open = expanded.has(i);
        const body = h('div', { class: 'step-body', hidden: !open || !def.args?.length },
          ...(def.args || []).map((a, ai) => sliderRow({
            label: `${a.name}${a.unit ? ` (${a.unit})` : ''}`, min: a.min, max: a.max, step: a.step, value: st.args?.[ai] ?? a.min,
            digits: a.step < 1 ? 1 : 0, onInput: (v) => { st.args[ai] = v; summary.textContent = argSummary(def, st); },
          })));
        const summary = h('span', { class: 'small' }, argSummary(def, st));
        return h('div', { class: 'step' },
          h('div', { class: 'step-head' },
            h('span', { class: 'n' }, String(i + 1)),
            h('span', { class: 'name', onclick: () => { open ? expanded.delete(i) : expanded.add(i); paint(); } }, def.name, ' ', summary),
            h('button', { class: 'icon-btn', 'aria-label': 'Nach oben', disabled: i === 0, onclick: () => move(i, -1) }, icon('up', 's18')),
            h('button', { class: 'icon-btn', 'aria-label': 'Nach unten', disabled: i === steps.length - 1, onclick: () => move(i, 1) }, icon('down', 's18')),
            def.args?.length ? h('button', { class: 'icon-btn', 'aria-label': 'Werte', onclick: () => { open ? expanded.delete(i) : expanded.add(i); paint(); } }, icon(open ? 'less' : 'more', 's20')) : null,
            h('button', { class: 'icon-btn', 'aria-label': 'Entfernen', onclick: () => { steps.splice(i, 1); expanded.clear(); paint(); } }, icon('close', 's18'))),
          body);
      }), h('button', { class: 'btn outlined wide', onclick: addStep }, icon('add', 's18'), 'Schritt hinzufügen'));
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
      closeSheet = sheet('Schritt hinzufügen', grid);
    }
    async function save() {
      const n = nameInput.value.trim();
      if (!/^[A-Za-z0-9\-_# ]{1,40}$/.test(n)) return snackbar('Name: nur Buchstaben (ohne Umlaute), Ziffern, Leerzeichen, - _ #');
      if (!steps.length) return snackbar('Mindestens ein Schritt nötig');
      try {
        if (script) await api(`/api/machine/scripts/${script.id}`, { method: 'PUT', body: { name: n, steps, kind: script.type === 'paddle' ? 'paddle' : 'standard' } });
        else await api('/api/machine/scripts', { method: 'POST', body: { name: n, steps } });
        snackbar('Skript gespeichert');
        close();
        onSaved?.();
      } catch (e) {
        snackbar(e.message);
      }
    }
    async function remove() {
      if (!(await confirmDialog('Skript löschen?', `„${script.title}“ wird von der Maschine gelöscht.`, 'Löschen', 'danger'))) return;
      try {
        await api(`/api/machine/scripts/${script.id}`, { method: 'DELETE' });
        snackbar('Skript gelöscht');
        close();
        onSaved?.();
      } catch (e) {
        snackbar(e.message);
      }
    }

    root.append(header,
      h('label', { class: 'field' }, h('span', {}, 'Name'), nameInput),
      h('div', { class: 'section-title' }, 'Ablauf'),
      h('p', { class: 'muted small' }, 'Das Skript startet automatisch mit „Start“ und endet mit „Ende“. Tippe auf einen Schritt, um Werte zu ändern.'),
      listEl,
      script && script.id > 9 ? h('button', { class: 'btn text', style: { color: 'var(--danger)', 'margin-top': '24px' }, onclick: remove }, icon('del', 's18'), 'Skript löschen') : null);
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
  return '· ' + def.args.map((a, i) => `${fmt(st.args?.[i], a.step < 1 ? 1 : 0)}${a.unit ? ' ' + a.unit : ''}`).join(' / ');
}
