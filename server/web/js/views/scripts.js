// Skripte: Liste, Start/Stopp, Editor, Export/Import.
import { h, icon, fmt, snackbar, sheet, confirmDialog, fullscreen, sliderRow, switchEl, ago } from '../ui.js';
import { api, store, subscribe, machineOn, directMode, hasGrinder, isClassic } from '../api.js';
import { setTopActions, navigate } from '../app.js';
import { shotChart } from '../gauge.js';
import { targetCurve, profileSteps } from '../../shared/shot-analysis.js';
import { scriptName } from '../../shared/visualizer.js';
import { openCommunity } from './community.js';

export function scriptsView(root) {
  return listTab(root);
}

const TYPE_LABEL = { standard: 'Skript', pressure: 'Druckprofil', paddle: 'Paddle', builtin: 'Eingebaut' };

// --- Skripte -------------------------------------------------------------------
function listTab(root) {
  const features = store.server?.features || {};
  let data = { scripts: [], ops: {}, builtin: {} };
  let sortBy = 'name';
  let gbs = null;
  const gbsBox = h('div', {});
  const listEl = h('div', { class: 'list' }, h('div', { class: 'empty' }, 'Lade Skripte …'));
  const sortBtn = h('button', { class: 'btn text', onclick: () => { sortBy = sortBy === 'name' ? 'id' : 'name'; sortBtn.lastChild.textContent = sortBy === 'name' ? 'Name' : 'ID'; paint(); } }, icon('sort', 's18'), h('span', {}, 'Name'));
  const stopBtn = h('button', { class: 'btn danger wide big', onclick: stop }, icon('stop', 's20'), 'Skript stoppen');

  const runButtons = [];
  if (features.scriptEditor) {
    const fileInput = h('input', { type: 'file', accept: '.script,application/json,text/plain', hidden: true, onchange: () => importFile(fileInput) });
    setTopActions(
      h('button', { class: 'icon-btn', 'aria-label': 'Skript importieren (.script)', title: 'Skript importieren (.script)', onclick: () => fileInput.click() }, icon('upload'), fileInput),
      directMode ? null : h('button', { class: 'icon-btn', 'aria-label': 'Profile entdecken (visualizer.coffee)', title: 'Profile entdecken (visualizer.coffee)', onclick: () => openCommunity(load) }, icon('explore')),
      h('button', { class: 'icon-btn', 'aria-label': 'Druckprofil erstellen', title: 'Druckprofil erstellen', onclick: () => openProfileBuilder(load) }, icon('profile')),
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
    gbsBox,
    h('div', { class: 'section-title with-action' }, h('span', {}, 'Alle Skripte'), sortBtn),
    listEl,
  );

  // Grind-by-Sync: welches Profil der Drehknopf der Mühle startet (nur mit Server)
  function paintGbs() {
    if (!hasGrinder() || isClassic()) return gbsBox.replaceChildren();
    if (!gbs) return gbsBox.replaceChildren();
    if (!gbs.enabled) {
      return gbsBox.replaceChildren(h('div', { class: 'section-title' }, 'Grind-by-Sync'),
        h('div', { class: 'card gbs-card' }, h('div', { class: 'row' },
          h('div', { class: 'grow small muted' }, 'Druckprofile auch beim Start über den Drehknopf der Mühle: dafür den Vermittler in den Server-Einstellungen einschalten.'),
          h('button', { class: 'btn tonal', onclick: () => navigate('/server') }, 'Einrichten'))));
    }
    const choices = data.scripts.filter((s) => (s.type === 'standard' || s.type === 'pressure') && s.title !== gbs.helperName);
    const sel = h('select', { class: 'text', 'aria-label': 'Profil für den Drehknopf', disabled: !features.scriptEditor },
      h('option', { value: '', selected: !gbs.scriptId }, 'Original der Xenia (Skript 9)'),
      choices.map((s) => h('option', { value: String(s.id), selected: s.id === gbs.scriptId }, `${s.title} (ID ${s.id})`)),
      gbs.scriptId && !choices.some((s) => s.id === gbs.scriptId) ? h('option', { value: String(gbs.scriptId), selected: true }, `Skript ${gbs.scriptId}${data.scripts.length ? ' (nicht mehr da)' : ''}`) : null);
    sel.addEventListener('change', () => saveGbs({ scriptId: sel.value ? Number(sel.value) : null }));
    const g = gbs.lastGrind;
    const st = gbs.lastStart;
    const lines = [
      gbs.lastContact ? `Mühle zuletzt: ${ago(gbs.lastContact)}` : 'Die Mühle hat sich noch nicht gemeldet (Host in der Mühle umgestellt?)',
      g ? `Letztes Rezept: ${g.weight ? `${fmt(g.weight)} g` : 'Zielgewicht unbekannt'} · ${ago(g.at)}` : 'Noch kein Mahlvorgang über Grind-by-Sync',
      st ? `Letzter Start: ${st.swapped ? `${st.title} bis ${st.weight} g` : 'Original-Skript 9'}${st.ok ? '' : ' (von der Xenia abgelehnt)'} · ${ago(st.at)}` : null,
    ].filter(Boolean);
    gbsBox.replaceChildren(h('div', { class: 'section-title' }, 'Grind-by-Sync'),
      h('div', { class: 'card gbs-card' },
        h('label', { class: 'field' }, h('span', {}, 'Profil für den Drehknopf der Mühle'), sel),
        h('div', { class: 'row toggle-row' },
          h('div', { class: 'grow' }, h('div', {}, 'Bis zum Zielgewicht laufen lassen'),
            h('div', { class: 'small muted' }, 'Hält den letzten Druck bis zu 30 s länger, damit der Bezug am Gewicht endet. Sonst wäre die Bezugszeit immer gleich und die Mühle lernt nichts.')),
          switchEl({ checked: gbs.extend, disabled: !features.scriptEditor, label: 'Bis zum Zielgewicht laufen lassen', onChange: (on) => saveGbs({ extend: on }) })),
        h('div', { class: 'small muted gbs-status' }, lines.map((l) => h('div', {}, l))),
        gbs.lastError ? h('div', { class: 'note warn' }, icon('warn', 's18'), h('span', {}, `${gbs.lastError} – die Mühle startet dann das Original-Skript 9.`)) : null,
        gbs.refused && !gbs.lastContact ? h('div', { class: 'note warn' }, icon('warn', 's18'), h('span', {}, `Verbindung von ${gbs.refused.ip} abgewiesen – stimmt die IP der Mühle (${gbs.grinderIp || 'fehlt'})?`)) : null,
        features.scriptEditor ? null : h('p', { class: 'small muted' }, 'Der Skript-Editor ist aus: Xenios legt das Profil als Skript „Xenios GbS“ auf der Maschine an und braucht ihn dafür.')));
  }
  async function saveGbs(change) {
    try {
      gbs = await api('/api/gbs', { method: 'PUT', body: change });
      snackbar(change.scriptId === null ? 'Drehknopf startet wieder das Original' : 'Gespeichert');
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
        h('div', { class: 'grow' }, h('div', { class: 't' }, s.title), h('div', { class: 'id' }, `ID: ${s.id} · ${s.title === gbs?.helperName ? 'von Grind-by-Sync verwaltet' : TYPE_LABEL[s.type] || s.type}`)),
        h('a', { class: 'icon-btn', href: `/api/machine/scripts/${s.id}/export`, download: '', 'aria-label': `${s.title} exportieren`, title: 'Exportieren (.script)' }, icon('download', 's20')),
        features.scriptEditor ? h('button', { class: 'icon-btn', 'aria-label': `${s.title} bearbeiten`, onclick: () => openEditor(s, data, load) }, icon('edit', 's20')) : null,
        play);
    }));
  }

  async function load() {
    if (!directMode && hasGrinder() && !isClassic()) gbs = await api('/api/gbs').catch(() => null);
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

// --- Druckprofil-Baukasten --------------------------------------------------------
// Erzeugt ein normales Skript der Maschine (läuft also auch über die Tasten):
// Brühventil auf → Vorbrühen → optional Pause (Pumpe aus) → Hauptdruck → optional Abfall in vier Stufen → Pumpe aus.
// Vorlagen nach dem Profil-Leitfaden von Decent Espresso, nur der Druckanteil. Fluss- und Temperaturvorgaben der
// Decent kann ein Xenia-Skript so nicht nachbilden; Zahlen, die der Leitfaden offen lässt, sind übliche Werte.
const PROFILE_PRESETS = [
  { name: 'Klassisch', roast: 'Alle Röstungen', hint: '1:2 in 25–30 s.', v: { preP: 2, preT: 4, pauseT: 0, mainP: 9, mainT: 25, endP: 9, declineT: 0 } },
  { name: 'E61', roast: 'Mitteldunkel bis dunkel', hint: 'Ohne Vorbrühen, 9 bar gehalten. 1:2 in etwa 25 s, eher etwas gröber mahlen.', v: { preP: 0, preT: 0, pauseT: 0, mainP: 9, mainT: 27, endP: 9, declineT: 0 } },
  { name: 'Bestes Druckprofil', roast: 'Mittelhell bis dunkel', hint: 'Wie E61, aber der Druck sinkt sanft – schont den Puck, passt zu vielen Bohnen. 1:2 in etwa 30 s.', v: { preP: 3, preT: 6, pauseT: 0, mainP: 9, mainT: 6, endP: 6, declineT: 18 } },
  { name: 'Mild und süß', roast: 'Mittelhell bis mitteldunkel', hint: 'Konstant 6 bar, verzeiht Fehler bei Puck und Mühle. Feiner: 1:2 in etwa 35 s (mild, süß). Gröber: 1:2–1:3 unter 20 s (heller).', v: { preP: 2, preT: 4, pauseT: 0, mainP: 6, mainT: 30, endP: 6, declineT: 0 } },
  { name: 'Turbo', roast: 'Hell (nordisch)', hint: 'Nach Extractamundo Dos: niedriger Druck (höchstens 6 bar), grob, schnell. 1:2,2 oft unter 20 s, bis 1:4. Lebhaft und süß, wenig Körper.', v: { preP: 2, preT: 3, pauseT: 0, mainP: 6, mainT: 15, endP: 6, declineT: 0 } },
  { name: 'Blooming', roast: 'Hell bis mittelhell', hint: 'Nach Scott Rao: füllen, bis etwa 8 g in der Tasse sind, dann ohne Druck quellen lassen, danach 6–9 bar mit sanftem Abfall. 1:2 in 60–70 s. Anspruchsvoll, sehr intensiv.', v: { preP: 3, preT: 10, pauseT: 25, mainP: 8.5, mainT: 6, endP: 6, declineT: 20 } },
  { name: 'Allongé', roast: 'Hell bis mittelhell', hint: 'Nach Scott Rao: 1:5 in 30–35 s, deutlich gröber mahlen, Druck fällt langsam. Verdünnter als Espresso, nichts für Milch.', v: { preP: 2, preT: 4, pauseT: 0, mainP: 8, mainT: 4, endP: 6, declineT: 26 } },
  { name: 'Londinium', roast: 'Mittel bis dunkel', hint: 'Hebel-Stil: Vorbrühen bei 3 bar, Spitze 9 bar, danach fallend wie bei der Hebelmaschine. Weiches Mundgefühl.', v: { preP: 3, preT: 10, pauseT: 0, mainP: 9, mainT: 4, endP: 5, declineT: 22 } },
  { name: 'Cremina', roast: 'Mitteldunkel bis dunkel', hint: 'Langsames Vorbrühen, Anstieg auf 8–9 bar, dann allmählicher Abfall. 1:2 in etwa 50 s, feiner mahlen. Vollmundig, Bitterschokolade.', v: { preP: 2.5, preT: 12, pauseT: 0, mainP: 8.5, mainT: 6, endP: 4, declineT: 30 } },
  { name: '80er', roast: 'Mitteldunkel bis dunkel', hint: 'Sehr tolerant, schwer zu überextrahieren. 1:2 über 40 s; Ristretto 1:1 bis etwa 60 s. Decent brüht dabei kühl (82 → 72 °C) – Brühtemperatur der Xenia dafür senken.', v: { preP: 3, preT: 8, pauseT: 0, mainP: 8, mainT: 10, endP: 6, declineT: 24 } },
];

function openProfileBuilder(onSaved) {
  let preset = PROFILE_PRESETS[0];
  const p = { ...preset.v, basket: 'none', name: 'Profil Klassisch' };
  fullscreen((root, close) => {
    const preview = h('div', { class: 'chart-box' });
    const summary = h('p', { class: 'small muted' });
    const presetInfo = h('div', { class: 'preset-info' });
    const nameInput = h('input', { class: 'text', value: p.name, maxlength: 40, 'aria-label': 'Name', placeholder: 'Name (A–Z, 0–9, - _ #)' });
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
      summary.textContent = `${steps.length} Schritte · Pumpe insgesamt ${fmt(total)} s. Die Maschine regelt den Druck selbst; ohne Kaffee im Sieb wird er nicht erreicht.`;
    }
    const presetChips = h('div', { class: 'chips' }, PROFILE_PRESETS.map((pr) => h('button', { class: 'chip', onclick: () => {
      preset = pr;
      Object.assign(p, pr.v);
      p.name = scriptName(`Profil ${pr.name}`);
      nameInput.value = p.name;
      for (const [key, row] of Object.entries(rows)) row.setValue(p[key]);
      paintPreset();
      redraw();
    } }, pr.name)));
    function paintPreset() {
      for (const c of presetChips.children) c.setAttribute('aria-pressed', String(c.textContent === preset.name));
      presetInfo.replaceChildren(h('strong', {}, preset.roast), ` · ${preset.hint}`);
    }
    const basket = h('select', { class: 'text', 'aria-label': 'Sieb' },
      [['none', 'Sieb nicht vorgeben'], ['single', 'Einfaches Sieb'], ['double', 'Doppeltes Sieb']].map(([v, t]) => h('option', { value: v }, t)));
    basket.addEventListener('change', () => { p.basket = basket.value; redraw(); });

    async function save() {
      try {
        await api('/api/machine/scripts', { method: 'POST', body: { name: p.name.trim(), steps: profileSteps(p), kind: 'standard' } });
        snackbar(`„${p.name.trim()}“ als Skript gespeichert`);
        close();
        onSaved?.();
      } catch (e) {
        snackbar(e.message);
      }
    }
    root.append(
      h('div', { class: 'row', style: { margin: '4px 0 12px' } },
        h('div', { class: 'grow' }, h('strong', {}, 'Druckprofil erstellen')),
        h('button', { class: 'btn grey', onclick: close }, 'Abbrechen'),
        h('button', { class: 'btn filled', onclick: save }, 'Speichern')),
      h('div', { class: 'card' }, preview, summary),
      h('div', { class: 'section-title' }, 'Vorlage'),
      presetChips,
      h('div', { class: 'card preset-card' }, presetInfo,
        h('p', { class: 'small muted' }, 'Nach dem Profil-Leitfaden von Decent Espresso, übertragen auf reine Druckstufen. Fluss- und Temperaturvorgaben der Decent bildet ein Xenia-Skript nicht ab.')),
      h('div', { class: 'card', style: { 'margin-top': '12px' } },
        h('label', { class: 'field' }, h('span', {}, 'Name'), nameInput),
        h('label', { class: 'field', style: { 'margin-top': '8px' } }, h('span', {}, 'Sieb (Totvolumen des Durchflussmessers)'), basket)),
      h('div', { class: 'card' }, h('h3', {}, 'Vorbrühen'),
        slider('preP', 'Druck', 0, 6, 0.5, 'bar'), slider('preT', 'Dauer', 0, 15, 0.5, 's'),
        slider('pauseT', 'Pause danach (Pumpe aus)', 0, 40, 1, 's')),
      h('div', { class: 'card' }, h('h3', {}, 'Hauptphase'),
        slider('mainP', 'Druck', 4, 10, 0.5, 'bar'), slider('mainT', 'Dauer', 3, 45, 1, 's')),
      h('div', { class: 'card' }, h('h3', {}, 'Abfall (Hebel-Stil)'),
        slider('endP', 'Enddruck', 3, 10, 0.5, 'bar'), slider('declineT', 'Dauer', 0, 30, 1, 's'),
        h('p', { class: 'small muted' }, 'Fällt in vier Stufen vom Hauptdruck auf den Enddruck. Dauer 0 = kein Abfall.')));
    paintPreset();
    redraw();
  });
}
