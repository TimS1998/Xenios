// Steuerung: Tastenbelegung an der Maschine (mit Frontansicht) und Paddle (Pumpe direkt).
import { h, icon, fmt, snackbar, confirmDialog, switchEl } from '../ui.js';
import { api, store, subscribe, machineOn } from '../api.js';
import { setTabs } from '../app.js';

const TABS = [{ id: 'switches', label: 'Schalter' }, { id: 'paddle', label: 'Paddle' }];
let lastTab = 'switches';

export function controlsView(root) {
  let dispose = null;
  const show = (tab) => {
    lastTab = tab;
    dispose?.();
    dispose = null;
    root.replaceChildren();
    setTabs(TABS, tab, show);
    if (tab === 'switches') dispose = switchesTab(root);
    if (tab === 'paddle') dispose = paddleTab(root);
  };
  show(lastTab);
  return () => dispose?.();
}

// --- Schalter ------------------------------------------------------------------------
// Taster an der Front (vgl. Original-UI „Button Assignments“). Oben links ist fest Ein/Aus;
// die übrigen drei Taster tragen je ein Skript für kurz/lang drücken (SWITCH_SET_<Taster>_<0|1>).
const BUTTONS = [
  { key: 'POWER', label: 'Oben links', cx: 52, cy: 96, glyph: 'power', fixed: { short: 'Ein/Aus', long: 'Ein ohne Dampfkessel' } },
  { key: 'RIGHT_RIGHT', label: 'Oben rechts', cx: 268, cy: 96, glyph: 'cup1' },
  { key: 'LEFT_LEFT', label: 'Unten links', cx: 52, cy: 132, glyph: 'crown' },
  { key: 'RIGHT_LEFT', label: 'Unten rechts', cx: 268, cy: 132, glyph: 'cup2' },
];

const SVG_NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c) el.append(c);
  return el;
}

// Vereinfachte Frontansicht der Xenia nach Fotos: Taster außen, Drehknöpfe, Dampf- und Wasserlanze, Brühgruppe,
// zwei Manometer, Display rechts, Abtropfschale. Ohne Siebträger.
function machineSvg(onPick) {
  const glyph = (kind, x, y) => {
    const g = s('g', { class: 'glyph', transform: `translate(${x} ${y})` });
    if (kind === 'power') g.append(s('path', { d: 'M-3.2 -3.6 A4.6 4.6 0 1 0 3.2 -3.6 M0 -5.4 V-0.6' }));
    if (kind === 'cup1') g.append(s('path', { d: 'M-4 -3 H3 V1 A3 3 0 0 1 0 4 H-1 A3 3 0 0 1 -4 1 Z M3 -1.6 H4.4 A1.4 1.4 0 0 1 4.4 1.2 H3' }));
    if (kind === 'cup2') g.append(s('path', { d: 'M-5.5 -1 H0.5 V2 A2.4 2.4 0 0 1 -1.9 4.4 H-3.1 A2.4 2.4 0 0 1 -5.5 2 Z M-2 -4.4 H4 V-1.4 A2.4 2.4 0 0 1 1.6 1 M4 -3 H5.2 A1.2 1.2 0 0 1 5.2 -0.6 H4' }));
    if (kind === 'crown') g.append(s('path', { d: 'M-5 3 H5 M-5 3 L-5.5 -3 L-2.5 0 L0 -4 L2.5 0 L5.5 -3 L5 3' }));
    return g;
  };
  const buttons = BUTTONS.map((b) => {
    const g = s('g', { class: 'mbtn', 'data-key': b.key, role: 'button', tabindex: 0, 'aria-label': `Taster ${b.label}` },
      s('circle', { class: 'halo', cx: b.cx, cy: b.cy, r: 16 }),
      s('circle', { class: 'cap', cx: b.cx, cy: b.cy, r: 10.5 }),
      s('circle', { class: 'cap-in', cx: b.cx, cy: b.cy, r: 8 }),
      glyph(b.glyph, b.cx, b.cy));
    g.addEventListener('click', () => onPick(b.key));
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(b.key); } });
    return g;
  });
  // Drehknopf (Ventil) seitlich gesehen: Sechskant-Mutter, schwarzer Griff, Endkappe
  const knob = (x, y, dir) => s('g', { class: 'valve' },
    s('rect', { class: 'chrome', x: x - 9, y: y - 9, width: 18, height: 18, rx: 3 }),
    s('rect', { class: 'grip', x: dir < 0 ? x - 34 : x + 9, y: y - 8, width: 25, height: 16, rx: 4 }),
    s('rect', { class: 'cap-end', x: dir < 0 ? x - 40 : x + 32, y: y - 9, width: 8, height: 18, rx: 4 }));
  const grill = (x0, x1) => {
    const out = [];
    for (let x = x0; x <= x1; x += 8) out.push(s('line', { x1: x, y1: 322, x2: x, y2: 344 }));
    return out;
  };
  const gauge = (cx) => s('g', { class: 'gauge' },
    s('circle', { cx, cy: 248, r: 16, class: 'bezel' }), s('circle', { cx, cy: 248, r: 12.5, class: 'face' }),
    s('line', { x1: cx, y1: 248, x2: cx - 6, y2: 243, class: 'needle' }));
  return s('svg', { class: 'machine-svg', viewBox: '0 0 320 370', role: 'img', 'aria-label': 'Xenia von vorn mit den vier Tastern' },
    s('defs', {},
      s('linearGradient', { id: 'mChrome', x1: 0, y1: 0, x2: 1, y2: 0 },
        s('stop', { offset: '0', 'stop-color': '#7d8186' }), s('stop', { offset: '.45', 'stop-color': '#f4f6f8' }), s('stop', { offset: '1', 'stop-color': '#8a8e93' })),
      s('linearGradient', { id: 'mBody', x1: 0, y1: 0, x2: 0, y2: 1 },
        s('stop', { offset: '0', 'stop-color': '#2a2b2f' }), s('stop', { offset: '1', 'stop-color': '#17181b' }))),
    // Tassenablage
    s('path', { class: 'rail', d: 'M40 44 V26 M280 44 V26' }),
    // Gehäuse
    s('rect', { class: 'body', x: 36, y: 44, width: 248, height: 262, rx: 6 }),
    // Brühgruppe (ohne Siebträger)
    s('path', { class: 'group-top', d: 'M138 64 H182 L176 104 H144 Z' }),
    s('rect', { class: 'light', x: 147, y: 68, width: 26, height: 30, rx: 3 }),
    s('path', { fill: 'url(#mChrome)', d: 'M118 112 H202 Q206 112 204 120 L196 138 H124 L116 120 Q114 112 118 112 Z' }),
    s('rect', { fill: 'url(#mChrome)', x: 140, y: 138, width: 40, height: 10, rx: 3 }),
    // Dampf- (links) und Wasserlanze (rechts) als gerade Striche
    knob(96, 102, 1),
    s('line', { class: 'wand', x1: 96, y1: 111, x2: 70, y2: 290 }),
    knob(224, 102, -1),
    s('line', { class: 'wand', x1: 224, y1: 111, x2: 224, y2: 196 }),
    // Display rechts
    s('rect', { class: 'display', x: 250, y: 162, width: 12, height: 40, rx: 2 }),
    s('rect', { class: 'display-txt', x: 252, y: 168, width: 8, height: 4 }),
    s('rect', { class: 'display-txt', x: 252, y: 182, width: 8, height: 10 }),
    // Manometer
    gauge(118), gauge(202),
    s('path', { class: 'warn-tri', d: 'M262 282 L270 268 L278 282 Z' }),
    // Abtropfschale
    s('rect', { class: 'tray', x: 28, y: 306, width: 264, height: 52, rx: 6 }),
    s('rect', { class: 'grill-bg', x: 44, y: 316, width: 98, height: 34, rx: 3 }),
    s('rect', { class: 'grill-bg', x: 178, y: 316, width: 98, height: 34, rx: 3 }),
    s('g', { class: 'grill' }, grill(50, 136), grill(184, 270)),
    ...buttons);
}

function switchesTab(root) {
  const features = store.server?.features || {};
  const box = h('div', {}, h('div', { class: 'empty' }, 'Lade Belegung …'));
  root.append(box);
  (async () => {
    try {
      const [sw, sc] = await Promise.all([api('/api/machine/switches'), api('/api/machine/scripts')]);
      const options = [
        ...Object.entries(sc.builtin).map(([id, title]) => ({ id: Number(id), title })),
        ...sc.scripts.filter((x) => x.id > 9).map((x) => ({ id: x.id, title: x.title })),
      ];
      const nm = (id) => options.find((o) => o.id === id)?.title || (id ? `Skript ${id}` : 'Keine');
      const assign = {};
      for (const b of BUTTONS) if (!b.fixed) assign[b.key] = { short: sw.buttons[b.key]?.short ?? 0, long: sw.buttons[b.key]?.long ?? 0 };
      const changed = {};
      const editable = Boolean(features.settings);

      const saveBtn = h('button', { class: 'btn filled wide', disabled: true, onclick: async () => {
        saveBtn.disabled = true;
        try {
          await api('/api/machine/switches', { method: 'PUT', body: { buttons: changed } });
          for (const k of Object.keys(changed)) delete changed[k];
          snackbar('Tastenbelegung gespeichert');
        } catch (e) {
          snackbar(e.message);
          saveBtn.disabled = false;
        }
      } }, icon('check', 's18'), 'Belegung speichern');

      const cards = {};
      let selected = null;
      const svg = machineSvg((key) => pick(key));
      function pick(key) {
        selected = selected === key ? null : key;
        for (const g of svg.querySelectorAll('.mbtn')) g.classList.toggle('sel', g.dataset.key === selected);
        for (const [k, c] of Object.entries(cards)) c.classList.toggle('sel', k === selected);
        if (selected) cards[selected].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      const select = (b, press) => {
        const el = h('select', { class: 'text', 'aria-label': `${b.label} ${press === 'short' ? 'kurz' : 'lang'}`, disabled: !editable },
          options.map((o) => h('option', { value: o.id, selected: o.id === assign[b.key][press] }, o.title)));
        if (!options.some((o) => o.id === assign[b.key][press])) el.append(h('option', { value: assign[b.key][press], selected: true }, nm(assign[b.key][press])));
        el.addEventListener('change', () => {
          assign[b.key][press] = Number(el.value);
          changed[b.key] = { ...(changed[b.key] || {}), [press]: Number(el.value) };
          saveBtn.disabled = false;
        });
        el.addEventListener('focus', () => { if (selected !== b.key) pick(b.key); });
        return el;
      };
      const grid = h('div', { class: 'btn-assign' }, BUTTONS.map((b) => {
        const c = h('div', { class: 'assign-card', onclick: (e) => { if (e.target.tagName !== 'SELECT') pick(b.key); } },
          h('div', { class: 'ttl' }, b.label, b.fixed ? h('span', { class: 'badge' }, 'fest') : null),
          b.fixed
            ? [h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Kurz'), h('span', { class: 'v' }, b.fixed.short)),
              h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Lang'), h('span', { class: 'v' }, b.fixed.long))]
            : [h('label', { class: 'kv' }, h('span', { class: 'k' }, 'Kurz'), select(b, 'short')),
              h('label', { class: 'kv' }, h('span', { class: 'k' }, 'Lang'), select(b, 'long'))]);
        cards[b.key] = c;
        return c;
      }));

      const single = h('input', { class: 'text', type: 'number', min: 1, max: 199, step: 0.5, value: sw.singleDoseG ?? '' });
      const double = h('input', { class: 'text', type: 'number', min: 1, max: 199, step: 0.5, value: sw.doubleDoseG ?? '' });
      box.replaceChildren(
        h('div', { class: 'card' },
          h('h3', {}, 'Tastenbelegung'),
          h('p', { class: 'muted small' }, 'Tippe auf einen Taster und wähle, was kurzes bzw. langes Drücken startet. Eigene Abläufe legst du unter „Skripte“ an.'),
          h('div', { class: 'machine-wrap' }, svg),
          grid,
          editable ? saveBtn : h('p', { class: 'muted small' }, 'Ändern ist in der Server-Konfiguration deaktiviert.')),
        h('div', { class: 'card' },
          h('h3', {}, 'Bezugsgewicht (interne Waage)'),
          h('div', { class: 'row' },
            h('label', { class: 'field grow' }, h('span', {}, 'Einfache Dosis (g)'), single),
            h('label', { class: 'field grow' }, h('span', {}, 'Doppelte Dosis (g)'), double)),
          h('div', { style: { height: '12px' } }),
          h('button', { class: 'btn filled wide', disabled: !editable, onclick: async () => {
            try {
              await api('/api/machine/switches', { method: 'PUT', body: { singleDoseG: Number(single.value), doubleDoseG: Number(double.value) } });
              snackbar('Gewichte gespeichert');
            } catch (e) { snackbar(e.message); }
          } }, 'Speichern')));
    } catch (e) {
      box.replaceChildren(h('div', { class: 'empty' }, e.message));
    }
  })();
  return () => {};
}

// --- Paddle ------------------------------------------------------------------------------
// Paddle-Modus aus ⇒ Pumpe aus. Maschine aus/offline ⇒ alles gesperrt.
// Optional Aufnahme wie in der Original-UI: Pumpenleistung über die Zeit als Paddle-Skript speichern.
function paddleTab(root) {
  const features = store.server?.features || {};
  if (!features.paddle) {
    root.append(h('div', { class: 'empty' }, 'Paddle-Steuerung ist in der Server-Konfiguration deaktiviert.'));
    return () => {};
  }
  let active = false;
  let level = 0;
  let sendTimer = null;
  let pollTimer = null;
  let startedAt = null;
  let inflight = Promise.resolve();
  let rec = null; // { steps, lastLevel, lastAt }
  const vP = h('div', { class: 'v' }, '0,0');
  const vL = h('div', { class: 'v' }, '0');
  const vT = h('div', { class: 'v' }, '0');
  const fill = h('div', { class: 'fill' });
  const knob = h('div', { class: 'knob' });
  const lvl = h('div', { class: 'lvl' }, '0 %');
  const paddle = h('div', { class: 'paddle locked', role: 'slider', 'aria-label': 'Pumpenleistung', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0, 'aria-disabled': 'true', tabindex: 0 },
    h('div', { class: 'lines' }), fill, lvl, knob);
  const stopBtn = h('button', { class: 'btn danger wide big', onclick: () => stopPump(true) }, icon('power', 's20'), 'PUMPE STOPPEN');
  const enable = switchEl({ label: 'Paddle aktivieren', onChange: (on) => setActive(on) });
  const enableInput = enable.querySelector('input');
  const recSw = switchEl({ label: 'Aufnahme', onChange: (on) => setRecording(on) });
  const recInput = recSw.querySelector('input');
  const recInfo = h('div', { class: 'muted small' }, 'Bewegungen des Reglers als Paddle-Skript speichern.');
  const hint = h('div', { class: 'offline-banner', hidden: true }, icon('warn', 's20'), h('span', {}, 'Maschine ist aus – Paddle nicht verfügbar.'));

  root.append(
    hint,
    h('div', { class: 'card low row' }, h('div', { class: 'grow' }, h('strong', {}, 'Paddle-Modus'), h('div', { class: 'muted small' }, 'Pumpenleistung direkt steuern (Vorinfusion, Profil von Hand). Ausschalten stoppt die Pumpe.')), enable),
    h('div', { class: 'card low row' }, icon('record'), h('div', { class: 'grow' }, h('strong', {}, 'Aufnahme'), recInfo), recSw),
    h('div', { class: 'readouts' },
      h('div', {}, vP, h('div', { class: 'k' }, 'Druck (bar)')),
      h('div', {}, vL, h('div', { class: 'k' }, 'Pumpe (%)')),
      h('div', {}, vT, h('div', { class: 'k' }, 'Zeit (s)'))),
    paddle,
    stopBtn);

  function paint() {
    paddle.style.setProperty('--lvl', String(level));
    lvl.textContent = `${Math.round(level)} %`;
    vL.textContent = String(Math.round(level));
    paddle.setAttribute('aria-valuenow', String(Math.round(level)));
  }
  function paintEnabled() {
    const on = machineOn();
    hint.hidden = on;
    enableInput.disabled = !on;
    recInput.disabled = !on || !active;
    stopBtn.disabled = !on && level === 0;
    paddle.classList.toggle('locked', !active || !on);
    paddle.setAttribute('aria-disabled', String(!active || !on));
    if (!on && active) setActive(false);
  }
  function setActive(on) {
    active = on && machineOn();
    enableInput.checked = active;
    if (!active) {
      if (rec) setRecording(false);
      stopPump(false);
    } else poll();
    paintEnabled();
  }
  function setLevel(v) {
    level = Math.max(0, Math.min(100, Math.round(v)));
    if (level > 0 && !startedAt) startedAt = Date.now();
    paint();
    clearTimeout(sendTimer);
    sendTimer = setTimeout(send, 150);
  }
  function send() {
    if (!active) return;
    const lv = level;
    recordLevel(lv);
    inflight = inflight.then(async () => {
      if (!active) return; // inzwischen ausgeschaltet: nicht mehr senden
      try {
        await api('/api/machine/paddle', { method: 'POST', body: { level: lv } });
      } catch (e) {
        snackbar(e.status === 502 ? 'Pumpe nicht bereit (Maschine an? Gerade am Ablassen?)' : e.message);
        level = 0;
        paint();
      }
    });
  }
  async function stopPump(notify) {
    clearTimeout(sendTimer);
    level = 0;
    startedAt = null;
    paint();
    // Erst laufende Pumpen-Befehle abwarten, sonst könnte ein später ankommender Wert die Pumpe wieder starten.
    const run = inflight.then(async () => {
      try {
        await api('/api/machine/paddle/stop', { method: 'POST' });
        if (notify) snackbar('Pumpe gestoppt');
      } catch (e) {
        if (notify) snackbar(e.message);
      }
    });
    inflight = run;
    await run;
    paintEnabled();
  }
  async function poll() {
    clearTimeout(pollTimer);
    if (!active) return;
    try {
      const d = await api('/api/machine/paddle');
      vP.textContent = fmt(d.pressure, 1);
    } catch { /* still */ }
    vT.textContent = startedAt ? String(Math.round((Date.now() - startedAt) / 1000)) : '0';
    pollTimer = setTimeout(poll, 1000);
  }

  // --- Aufnahme ---
  function recordLevel(lv) {
    if (!rec) return;
    const now = Date.now();
    if (rec.lastAt !== null && now - rec.lastAt < 250 && rec.steps.length) {
      rec.lastLevel = lv; // schnelle Bewegung: letzten Wert überschreiben
      return;
    }
    flushSegment(now);
    rec.lastLevel = lv;
    rec.lastAt = now;
    recInfo.textContent = `Aufnahme läuft · ${rec.steps.length / 2} Abschnitte`;
  }
  function flushSegment(now) {
    if (rec.lastAt === null) return;
    let dur = Math.round((now - rec.lastAt) / 100) / 10;
    // Pumpenleistung (Op 3) erlaubt höchstens 45 s pro Schritt
    while (dur > 0) {
      const d = Math.min(45, dur);
      rec.steps.push(rec.lastLevel > 0 ? { op: 3, args: [rec.lastLevel, d] } : { op: 6, args: [] }, { op: 12, args: [d] });
      dur = Math.round((dur - d) * 10) / 10;
    }
  }
  async function setRecording(on) {
    recInput.checked = on;
    if (on) {
      rec = { steps: [], lastLevel: level, lastAt: level > 0 ? Date.now() : null };
      recInfo.textContent = 'Aufnahme läuft · bewege den Regler';
      return;
    }
    if (!rec) return;
    if (rec.lastLevel > 0) flushSegment(Date.now());
    const steps = rec.steps;
    rec = null;
    recInfo.textContent = 'Bewegungen des Reglers als Paddle-Skript speichern.';
    if (!steps.length) return;
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const name = `paddle_${d.getFullYear()}_${p(d.getMonth() + 1)}_${p(d.getDate())}_${p(d.getHours())}_${p(d.getMinutes())}_${p(d.getSeconds())}`;
    if (!(await confirmDialog('Aufnahme speichern?', `${steps.length / 2} Abschnitte als „${name}“ auf der Maschine speichern.`, 'Speichern'))) return;
    try {
      await api('/api/machine/scripts', { method: 'POST', body: { name, steps: [...steps, { op: 17, args: [] }], kind: 'paddle' } });
      snackbar('Paddle-Aufnahme gespeichert');
    } catch (e) {
      snackbar(e.message);
    }
  }

  const fromEvent = (e) => {
    const r = paddle.getBoundingClientRect();
    return ((r.bottom - e.clientY) / r.height) * 100;
  };
  paddle.addEventListener('pointerdown', (e) => {
    if (!machineOn()) return snackbar('Maschine ist aus');
    if (!active) return snackbar('Bitte zuerst „Paddle aktivieren“');
    paddle.setPointerCapture(e.pointerId);
    setLevel(fromEvent(e));
  });
  paddle.addEventListener('pointermove', (e) => {
    if (active && paddle.hasPointerCapture(e.pointerId)) setLevel(fromEvent(e));
  });
  paddle.addEventListener('keydown', (e) => {
    if (!active) return;
    if (e.key === 'ArrowUp') setLevel(level + 5);
    if (e.key === 'ArrowDown') setLevel(level - 5);
  });
  paint();
  paintEnabled();
  const un = subscribe((part) => {
    if (part === 'machine' || part === 'all' || part === 'conn') paintEnabled();
  });
  return () => {
    un();
    clearTimeout(pollTimer);
    const wasActive = active;
    active = false;
    rec = null;
    if (wasActive || level > 0) stopPump(false);
  };
}
