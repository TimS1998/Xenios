// Schalter: Tastenbelegung an der Maschine (mit Frontansicht). Paddle (Pumpe direkt) als eigener Tab.
import { h, icon, fmt, snackbar, confirmDialog, switchEl } from '../ui.js';
import { api, store, subscribe, machineOn, isClassic, hasPaddle, directMode } from '../api.js';
import { contrastOn, navigate } from '../app.js';
import { t } from '../../shared/i18n.js';

export function controlsView(root) {
  return switchesTab(root);
}

// Eigener Tab „Paddle“: Pumpe direkt steuern
export function paddleView(root) {
  if (!hasPaddle()) {
    root.append(h('div', { class: 'card low' }, h('h3', {}, t('home.paddle.title')),
      h('p', { class: 'muted' }, store.machine?.info ? t('home.paddle.oldFirmware') : t('home.paddle.notReached'))));
    return () => {};
  }
  return paddleTab(root);
}

// --- Schalter ------------------------------------------------------------------------
// Taster an der Front (vgl. Original-UI „Button Assignments“). Oben links ist fest Ein/Aus;
// die übrigen drei Taster tragen je ein Skript für kurz/lang drücken (SWITCH_SET_<Taster>_<0|1>).
// Lage der Taster je Ansicht: im Render auf den Seitenleisten über den Ventilen, in der vereinfachten Ansicht an den Rändern
const BUTTONS = [
  { key: 'POWER', get label() { return t('home.switches.topLeft'); }, render: [56, 54], simple: [52, 96], glyph: 'power', get fixed() { return { short: t('home.switches.fixedShort'), long: t('home.switches.fixedLong') }; } },
  { key: 'RIGHT_RIGHT', get label() { return t('home.switches.topRight'); }, render: [264, 54], simple: [268, 96], glyph: 'cup1' },
  { key: 'LEFT_LEFT', get label() { return t('home.switches.bottomLeft'); }, render: [56, 94], simple: [52, 132], glyph: 'crown' },
  { key: 'RIGHT_LEFT', get label() { return t('home.switches.bottomRight'); }, render: [264, 94], simple: [268, 132], glyph: 'cup2' },
];

// Alte Xenia (DBL): zwei kleine Kippschalter, jeder lässt sich nach links und nach rechts drücken (kurz/lang).
// Nummern wie auf dem Foto der Maschine: ① links◀, ② links▶ (am Ein/Aus-Symbol, fest Ein/Aus, gesperrt),
// ③ rechts◀ (am Tassen-Symbol), ④ rechts▶. Die API kennt die drei belegbaren Positionen
// SWITCH_SET_LEFT_LEFT/RIGHT_LEFT/RIGHT_RIGHT; LEFT_RIGHT fehlt dort, weil fest Ein/Aus.
const DBL_BUTTONS = [
  { key: 'LEFT_LEFT', no: 1, get label() { return t('home.switches.leftBack'); }, lever: 'left', dir: -1 },
  { key: 'POWER', no: 2, get label() { return t('home.switches.leftFwd'); }, lever: 'left', dir: 1, get fixed() { return { short: t('home.switches.fixedShort'), long: t('home.switches.fixedLong') }; } },
  { key: 'RIGHT_LEFT', no: 3, get label() { return t('home.switches.rightBack'); }, lever: 'right', dir: -1 },
  { key: 'RIGHT_RIGHT', no: 4, get label() { return t('home.switches.rightFwd'); }, lever: 'right', dir: 1 },
];

const SVG_NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c) el.append(c);
  return el;
}

// --- Frontansicht der Xenia (Render) -------------------------------------------------------
// Ganze Maschine von vorn: Tassenablage, Gehäuse in der eingestellten Farbe, Brühgruppe mit Siebträger, Ventile mit
// Holzgriff (Hebel oder Drehknopf), Heißwasser- und Dampflanze (Seite einstellbar), Manometer, Abtropfschale. Neue Xenia:
// vier Taster und Display; alte Xenia (DBL, nach Foto): zwei Kippschalter oben, vier Leuchten rechts der Brühgruppe.
// Nur die Taster bzw. die Schalterseiten sind antippbar. Ansicht, Farbe, Dampflanze und Ventile: Einstellungen →
// Modell & Aussehen.
// Griffe der DBL ohne eigene Wahl: Kunststoff schwarz (Standard bei Xenia); Abtropfgitter der DBL ohne eigene Wahl: Edelstahl
export const LOOK_DEFAULTS = { color: '#26272b', steamSide: 'left', grip: '#1d1e21', gauge: '#141518', dblTray: '#c4c7cb' };
const hex = (v) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v.toLowerCase() : null);
export function machineLook() {
  const l = store.server?.machine?.look || {};
  return {
    style: l.style === 'simple' ? 'simple' : 'render',
    color: hex(l.color) || LOOK_DEFAULTS.color,
    steamSide: l.steamSide === 'right' ? 'right' : 'left',
    valves: l.valves === 'rotary' ? 'rotary' : 'lever',
    grip: l.grip === 'chrome' ? 'chrome' : hex(l.grip), // null: Standard des Modells (DBL Holz, neue Xenia Chrom)
    tray: hex(l.tray) || hex(l.color) || LOOK_DEFAULTS.color, // ohne eigene Farbe wie das Gehäuse (neue Xenia)
    trayOwn: hex(l.tray), // eigene Wahl; ohne sie ist das Gitter der DBL aus Edelstahl
    gauge: hex(l.gauge) || LOOK_DEFAULTS.gauge,
    editButton: l.editButton !== false,
  };
}

// Sättigung einer Farbe (0 = grau)
function saturation(hex) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255];
  const max = Math.max(...c);
  return max ? (max - Math.min(...c)) / max : 0;
}

// Farbe heller (f > 0) oder dunkler (f < 0)
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  return '#' + [n >> 16, (n >> 8) & 255, n & 255]
    .map((c) => Math.max(0, Math.min(255, Math.round(f >= 0 ? c + (255 - c) * f : c * (1 + f)))).toString(16).padStart(2, '0')).join('');
}

const GLYPHS = {
  power: 'M-3.2 -3.6 A4.6 4.6 0 1 0 3.2 -3.6 M0 -5.4 V-0.6',
  cup1: 'M-4 -3 H3 V1 A3 3 0 0 1 0 4 H-1 A3 3 0 0 1 -4 1 Z M3 -1.6 H4.4 A1.4 1.4 0 0 1 4.4 1.2 H3',
  cup2: 'M-5.5 -1 H0.5 V2 A2.4 2.4 0 0 1 -1.9 4.4 H-3.1 A2.4 2.4 0 0 1 -5.5 2 Z M-2 -4.4 H4 V-1.4 A2.4 2.4 0 0 1 1.6 1 M4 -3 H5.2 A1.2 1.2 0 0 1 5.2 -0.6 H4',
  crown: 'M-5 3 H5 M-5 3 L-5.5 -3 L-2.5 0 L0 -4 L2.5 0 L5.5 -3 L5 3',
};

function pickable(g, key, onPick) {
  g.addEventListener('click', () => onPick(key));
  g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(key); } });
  return g;
}

function xeniaSvg({ classic, look: look0, onPick }) {
  // DBL: ein Gitter über die ganze Schale, ohne eigene Wahl Edelstahl (nicht die Gehäusefarbe).
  // Neue Xenia (Mahlkönig): Abtropfschale wie das Gehäuse, Manometer immer schwarz (keine Auswahl)
  const look = classic
    ? (look0.trayOwn ? look0 : { ...look0, tray: LOOK_DEFAULTS.dblTray })
    : { ...look0, tray: look0.color, gauge: LOOK_DEFAULTS.gauge };
  const body = look.color;
  // Griffe: Farbe (Holzarten, Schwarz, Weiß, eigene) oder Chrom; ohne eigene Wahl DBL Kunststoff schwarz, neue Xenia Chrom
  const grip = look.grip || (classic ? LOOK_DEFAULTS.grip : 'chrome');
  const chromeGrip = grip === 'chrome';
  const tone = chromeGrip ? '#b9bdc2' : grip;
  // Maserung nur bei Holztönen; Chrom, schwarze, weiße oder graue Griffe bleiben glatt
  const grain = !chromeGrip && saturation(tone) > 0.2 ? shade(tone, -0.5) : 'transparent';
  const light = contrastOn(body) !== '#ffffff'; // helles Gehäuse → dunkle Schrift und Symbole
  const ink = light ? '#45474c' : '#d3d5d9';
  const grad = (id, stops, horizontal = false) => s('linearGradient', { id, x1: 0, y1: 0, x2: horizontal ? 1 : 0, y2: horizontal ? 0 : 1 },
    stops.map(([o, c, op]) => s('stop', { offset: o, 'stop-color': c, 'stop-opacity': op })));
  const defs = s('defs', {},
    grad('mChrome', [['0', '#7d8186'], ['.45', '#f4f6f8'], ['1', '#8a8e93']], true),
    grad('mChromeV', [['0', '#f4f6f8'], ['.55', '#b9bdc2'], ['1', '#7d8186']]),
    grad('mBody', [['0', shade(body, 0.1)], ['1', shade(body, -0.2)]]),
    grad('mTray', [['0', shade(look.tray, 0.1)], ['1', shade(look.tray, -0.2)]]),
    grad('mSide', [['0', '#000', 0.22], ['.12', '#000', 0], ['.88', '#000', 0], ['1', '#000', 0.22]], true),
    chromeGrip ? grad('mWood', [['0', '#7d8186'], ['.45', '#f4f6f8'], ['1', '#8a8e93']], true)
      : grad('mWood', [['0', shade(tone, -0.4)], ['.45', tone], ['1', shade(tone, -0.4)]], true),
    // Runde Griffe von vorn: Licht von oben links
    s('radialGradient', { id: 'mKnobWood', cx: 0.42, cy: 0.38, r: 0.7 },
      s('stop', { offset: '0', 'stop-color': chromeGrip ? '#f4f6f8' : shade(tone, 0.25) }),
      s('stop', { offset: '.6', 'stop-color': tone }),
      s('stop', { offset: '1', 'stop-color': chromeGrip ? '#7d8186' : shade(tone, -0.25) })));

  // Tassenablage und Gehäuse
  const rail = [s('rect', { x: 44, y: 21, width: 232, height: 10, rx: 2, fill: 'url(#mChrome)' })];
  for (let x = 52; x < 272; x += 8) rail.push(s('line', { x1: x, y1: 23, x2: x, y2: 29, stroke: '#7d8186', 'stroke-width': 1.2 }));
  const shell = [
    s('rect', { class: 'body', x: 40, y: 30, width: 240, height: 232, rx: 7 }),
    s('rect', { x: 40, y: 30, width: 240, height: 232, rx: 7, fill: 'url(#mSide)' }),
    s('rect', { x: 44, y: 31, width: 232, height: 2, fill: '#fff', opacity: light ? 0.5 : 0.08 }),
    ...(classic ? [] : [
      s('rect', { x: 40, y: 30, width: 30, height: 232, rx: 7, fill: '#fff', opacity: light ? 0.12 : 0.035 }),
      s('rect', { x: 250, y: 30, width: 30, height: 232, rx: 7, fill: '#fff', opacity: light ? 0.12 : 0.035 }),
      s('line', { x1: 70, y1: 34, x2: 70, y2: 262, stroke: '#000', opacity: 0.25 }),
      s('line', { x1: 250, y1: 34, x2: 250, y2: 262, stroke: '#000', opacity: 0.25 }),
    ]),
  ];

  // Abtropfschale mit versetzten Schlitzen. Alte Xenia (DBL): ein Gitter über die ganze Schale, in einer Farbe
  const slots = [];
  const [rows, sx0, sx1, sy0] = classic ? [5, 38, 282, 268] : [3, 48, 274, 271];
  for (let r = 0; r < rows; r++) {
    for (let x = sx0 + (r % 2) * 9; x + 13 <= sx1; x += 18) slots.push(s('rect', { x, y: sy0 + r * 10, width: 13, height: 6, rx: 3, fill: '#0c0d0f' }));
  }
  const tray = classic ? [
    s('rect', { x: 28, y: 262, width: 264, height: 74, rx: 6, fill: 'url(#mTray)', stroke: 'rgba(0,0,0,.45)', 'stroke-width': 0.8 }),
    ...slots,
  ] : [
    s('rect', { x: 28, y: 262, width: 264, height: 74, rx: 6, fill: 'url(#mTray)', stroke: 'rgba(0,0,0,.45)', 'stroke-width': 0.8 }),
    s('rect', { x: 40, y: 267, width: 240, height: 33, rx: 4, fill: shade(look.tray, -0.45) }),
    ...slots,
    s('line', { x1: 34, y1: 306, x2: 286, y2: 306, stroke: '#000', opacity: 0.25 }),
  ];

  // Brühgruppe mit Siebträger (Holzgriff zum Betrachter)
  const group = [
    s('path', { d: 'M134 50 H186 L182 118 H138 Z', fill: '#111214' }),
    s('path', { d: 'M142 56 H178 V92 Q160 101 142 92 Z', fill: 'url(#mChrome)' }),
    s('rect', { x: 147, y: 100, width: 26, height: 12, rx: 3, fill: '#fff2d2', opacity: 0.55 }),
    s('rect', { x: 122, y: 118, width: 76, height: 22, rx: 10, fill: 'url(#mChrome)', stroke: '#6f7378', 'stroke-width': 0.8 }),
    s('rect', { x: 132, y: 138, width: 56, height: 8, rx: 3, fill: 'url(#mChromeV)' }),
    s('path', { d: 'M138 146 H182 L175 162 H145 Z', fill: 'url(#mChrome)' }),
    s('rect', { x: 154, y: 161, width: 12, height: 9, rx: 2, fill: 'url(#mChrome)' }),
    s('path', { class: 'kn-wood', d: 'M150 175 Q160 170 170 175 L175 292 Q160 306 145 292 Z' }),
    s('path', { class: 'kn-grain', d: 'M155 182 Q151 230 156 290 M163 180 Q168 236 162 296 M158 200 Q162 214 158 228' }),
    s('rect', { x: 149, y: 168, width: 22, height: 9, rx: 3, fill: 'url(#mChrome)', stroke: '#7d8186', 'stroke-width': 0.6 }),
  ];

  // Ventile mit Holzgriff, je nach Ausstattung als Hebel (schräg nach außen) oder als Drehknopf (von vorn rund);
  // darunter Heißwasser und Dampflanze (Grundzeichnung: Dampf rechts)
  // Hebel wie an der DBL: Holzgriff schräg nach unten außen
  const lever = (vx, dir) => {
    const hx = vx + dir * 22;
    const turn = `rotate(${dir * 40} ${hx} 116)`;
    return [
      s('rect', { x: vx - 7, y: 96, width: 14, height: 24, rx: 4, fill: 'url(#mChrome)', stroke: '#7d8186', 'stroke-width': 0.6 }),
      s('line', { x1: vx, y1: 102, x2: vx + dir * 12, y2: 108, stroke: '#c3c7cc', 'stroke-width': 6, 'stroke-linecap': 'round' }),
      s('ellipse', { class: 'kn-wood', cx: hx, cy: 116, rx: 16, ry: 8, transform: turn }),
      s('path', { class: 'kn-grain', d: `M${hx - 12} 115 Q${hx} 112 ${hx + 12} 115 M${hx - 9} 119 Q${hx} 121 ${hx + 10} 118`, transform: turn }),
    ];
  };
  // Drehknopf wie an der Maschine: fünfblättriger Holzstern, schwarze Plakette mit Chromring, Chrom in der Mitte
  const rotary = (vx, id) => {
    const cy = 92;
    const R = 18;
    const pts = [];
    for (let i = 0; i < 100; i++) {
      const t = (Math.PI * 2 * i) / 100;
      const r = R * (0.88 + 0.12 * Math.cos(5 * (t + Math.PI / 2))); // ein Blatt zeigt nach oben
      pts.push(`${(vx + r * Math.cos(t)).toFixed(2)} ${(cy + r * Math.sin(t)).toFixed(2)}`);
    }
    const star = `M${pts.join(' L')} Z`;
    const lines = [];
    for (let k = -4; k <= 4; k++) {
      const y = cy + k * 4.4;
      lines.push(`M${vx - 20} ${y + 1.2} Q${vx - 7} ${y - 1.8} ${vx + 2} ${y + 0.6} T${vx + 20} ${y - 0.8}`);
    }
    return [
      s('rect', { x: vx - 7, y: 104, width: 14, height: 16, rx: 4, fill: 'url(#mChrome)', stroke: '#7d8186', 'stroke-width': 0.6 }),
      s('clipPath', { id: `${id}Clip` }, s('path', { d: star })),
      s('path', { d: star, fill: '#000', opacity: 0.25, transform: 'translate(0 1.4)' }),
      s('path', { d: star, fill: 'url(#mKnobWood)', stroke: shade(tone, -0.35), 'stroke-width': 0.5, 'stroke-opacity': 0.5 }),
      s('path', { d: lines.join(' '), fill: 'none', stroke: grain, 'stroke-width': 0.8, opacity: 0.35, 'clip-path': `url(#${id}Clip)` }),
      s('circle', { cx: vx, cy, r: 9.2, fill: '#18191b', stroke: '#d9dce0', 'stroke-width': 0.9 }),
      s('circle', { cx: vx, cy, r: 3, fill: 'url(#mChrome)', stroke: '#7d8186', 'stroke-width': 0.4 }),
      s('circle', { cx: vx, cy, r: 1, fill: '#3a3c40' }),
    ];
  };
  const valve = look.valves === 'rotary' ? (vx, dir) => rotary(vx, dir < 0 ? 'mKnobL' : 'mKnobR') : lever;
  const water = [
    s('path', { d: 'M77.5 119 H90.5 L92 122 V128 L90.5 131 H77.5 L76 128 V122 Z', fill: 'url(#mChrome)', stroke: '#7d8186', 'stroke-width': 0.6 }),
    s('line', { x1: 76.5, y1: 125, x2: 91.5, y2: 125, stroke: '#7d8186', 'stroke-width': 0.4, opacity: 0.6 }),
    s('path', { d: 'M79.5 131 H88.5 L87 168 H81 Z', fill: 'url(#mChrome)', stroke: '#7d8186', 'stroke-width': 0.5 }),
    s('path', { d: 'M80.5 166 H87.5 Q91 172 90.5 180 Q90 188 84 189 Q78 188 77.5 180 Q77 172 80.5 166 Z', fill: 'url(#mChrome)', stroke: '#7d8186', 'stroke-width': 0.6 }),
    s('rect', { x: 81.5, y: 188, width: 5, height: 3, rx: 1, fill: '#8a8e93' }),
  ];
  const steam = [
    s('rect', { x: 232.5, y: 118, width: 7, height: 52, rx: 3, fill: 'url(#mChrome)' }),
    s('circle', { cx: 236, cy: 172, r: 6, fill: 'url(#mChrome)', stroke: '#7d8186', 'stroke-width': 0.6 }),
    s('line', { x1: 236, y1: 172, x2: 262, y2: 254, stroke: '#c3c7cc', 'stroke-width': 6, 'stroke-linecap': 'round' }),
    s('line', { x1: 234.6, y1: 173, x2: 260.6, y2: 254, stroke: '#f2f4f6', 'stroke-width': 1.6, 'stroke-linecap': 'round', opacity: 0.8 }),
    s('line', { x1: 241, y1: 188, x2: 254, y2: 228, stroke: '#1b1c1f', 'stroke-width': 10, 'stroke-linecap': 'round' }),
    s('rect', { x: 259, y: 252, width: 7, height: 10, rx: 2, fill: '#8a8e93' }),
  ];

  // Neue Xenia nach Foto der Maschine: kantige Nische mit Chromkeil, runder Chromkragen, Siebträgergriff zum
  // Betrachter nach unten, runde Ventilknöpfe (Chrom oder Holz), Heißwasser kurz mit bauchigem Auslauf, Dampflanze gerade mit Gummigriff
  // bis knapp über die Abtropfschale (Grundzeichnung wie oben: Heißwasser links, Dampf rechts)
  const newXenia = () => {
    const nut = (vx, y) => [
      s('path', { d: `M${vx - 6.5} ${y} H${vx + 6.5} L${vx + 8} ${y + 3} V${y + 7} L${vx + 6.5} ${y + 10} H${vx - 6.5} L${vx - 8} ${y + 7} V${y + 3} Z`, fill: 'url(#mChrome)', stroke: '#7d8186', 'stroke-width': 0.6 }),
      s('line', { x1: vx - 7.5, y1: y + 5, x2: vx + 7.5, y2: y + 5, stroke: '#7d8186', 'stroke-width': 0.4, opacity: 0.6 }),
    ];
    const cone = (vx, y) => s('path', { d: `M${vx - 6} ${y} H${vx + 6} L${vx + 3} ${y + 12} H${vx - 3} Z`, fill: 'url(#mChrome)', stroke: '#7d8186', 'stroke-width': 0.5 });
    // Runder Ventilknopf von vorn: Chrom oder Holz (bzw. eigene Farbe) mit Maserung
    const knob = (vx) => [
      s('rect', { x: vx - 5, y: 76, width: 10, height: 24, rx: 3, fill: 'url(#mChrome)', stroke: '#7d8186', 'stroke-width': 0.5 }),
      s('circle', { cx: vx, cy: 70, r: 11.5, fill: chromeGrip ? 'url(#mChromeV)' : 'url(#mKnobWood)', stroke: chromeGrip ? '#6f7378' : shade(tone, -0.35), 'stroke-width': 0.7 }),
      chromeGrip ? s('circle', { cx: vx, cy: 70, r: 8, fill: 'url(#mChrome)', opacity: 0.9 })
        : s('path', { class: 'kn-grain', d: `M${vx - 9} 67 Q${vx} 64 ${vx + 9} 67 M${vx - 10} 72 Q${vx} 75 ${vx + 10} 72` }),
    ];
    const ribs = [];
    for (let i = 0; i < 5; i++) ribs.push(s('line', { x1: 230.5, y1: 180 + i * 4.6, x2: 241.5, y2: 180 + i * 4.6, stroke: '#4a4d53', 'stroke-width': 1.4 }));
    return {
      group: [
        s('rect', { x: 132, y: 54, width: 56, height: 58, rx: 3, fill: '#111214' }),
        s('path', { d: 'M140 60 H180 L170 112 H150 Z', fill: 'url(#mChrome)' }),
        s('path', { d: 'M148 64 H172 L160 98 Z', fill: '#000', opacity: 0.22 }),
        s('rect', { x: 111, y: 110, width: 98, height: 24, rx: 12, fill: 'url(#mChrome)', stroke: '#6f7378', 'stroke-width': 0.8 }),
        s('line', { x1: 116, y1: 122, x2: 204, y2: 122, stroke: '#6f7378', 'stroke-width': 0.6, opacity: 0.7 }),
        s('path', { d: 'M132 134 H188 L180 150 H140 Z', fill: 'url(#mChromeV)' }),
        // Auslauf und Siebträgergriff, der wie bei der DBL zum Betrachter nach unten zeigt (etwas kürzer)
        s('path', { d: 'M148 150 H172 L167 160 H153 Z', fill: 'url(#mChrome)' }),
        s('path', { class: 'kn-wood', d: 'M150 166 Q160 161 170 166 L174 258 Q160 271 146 258 Z' }),
        s('path', { class: 'kn-grain', d: 'M155 172 Q151 212 156 256 M163 170 Q168 216 162 262 M158 188 Q162 200 158 212' }),
        s('rect', { x: 149, y: 158, width: 22, height: 9, rx: 3, fill: 'url(#mChrome)', stroke: '#7d8186', 'stroke-width': 0.6 }),
      ],
      valves: [...knob(84), ...knob(236)],
      water: [
        ...nut(84, 98), cone(84, 108),
        s('rect', { x: 81.5, y: 120, width: 5, height: 46, rx: 2, fill: 'url(#mChrome)' }),
        s('path', { d: 'M80.5 164 H87.5 Q91 170 90.5 179 Q90 192 84 193 Q78 192 77.5 179 Q77 170 80.5 164 Z', fill: 'url(#mChrome)', stroke: '#7d8186', 'stroke-width': 0.6 }),
      ],
      steam: [
        ...nut(236, 98), cone(236, 108),
        s('rect', { x: 234, y: 120, width: 4, height: 58, rx: 2, fill: 'url(#mChrome)' }),
        s('rect', { x: 230.5, y: 176, width: 11, height: 26, rx: 4, fill: '#2b2d31' }),
        ...ribs,
        s('rect', { x: 234.4, y: 202, width: 3.2, height: 52, rx: 1.5, fill: 'url(#mChrome)' }),
        s('ellipse', { cx: 236, cy: 256, rx: 3.2, ry: 4.5, fill: 'url(#mChrome)', stroke: '#7d8186', 'stroke-width': 0.5 }),
      ],
    };
  };
  const parts = classic ? { group, valves: [...valve(84, -1), ...valve(236, 1)], water, steam } : newXenia();
  const wands = s('g', look.steamSide === 'left' ? { transform: 'translate(320 0) scale(-1 1)' } : {}, ...parts.water, ...parts.steam);

  // Manometer und Schriftzug
  // Zifferblatt in der eingestellten Farbe; Skala und Zeiger hell auf dunklem, dunkel auf hellem Grund
  const dial = contrastOn(look.gauge) === '#ffffff' ? '#e8e8e8' : '#2a2b2f';
  // Neue Xenia: größere Manometer (k skaliert Ring, Skala und Zeiger)
  const gk = classic ? 1 : 1.3;
  const gauge = (cx) => {
    const cy = classic ? 228 : 220;
    const g = s('g', {}, s('circle', { cx, cy, r: 14.5 * gk, fill: 'url(#mChrome)' }), s('circle', { cx, cy, r: 11.8 * gk, fill: look.gauge }));
    for (let i = 0; i <= 8; i++) {
      const a = (Math.PI * (225 - i * 33.75)) / 180;
      g.append(s('line', { x1: cx + Math.cos(a) * 8.8 * gk, y1: cy - Math.sin(a) * 8.8 * gk, x2: cx + Math.cos(a) * 11 * gk, y2: cy - Math.sin(a) * 11 * gk, stroke: dial, 'stroke-width': 0.9 }));
    }
    g.append(s('line', { x1: cx, y1: cy, x2: cx - 5 * gk, y2: cy - 6 * gk, stroke: dial, 'stroke-width': 1.3, 'stroke-linecap': 'round' }),
      s('circle', { cx, cy, r: 1.6 * gk, fill: '#d0342c' }));
    return g;
  };
  // DBL: Schriftzug wie an der Maschine halb hinter dem Siebträgergriff („NIA“ rechts davon sichtbar).
  // Neue Xenia: ohne Schriftzug, rotes Dreieck rechts unten.
  const front = [gauge(106), gauge(214), classic
    ? s('text', { x: 175, y: 232, 'text-anchor': 'middle', fill: ink, 'font-size': 10, 'letter-spacing': 3.5, 'font-weight': 300 }, 'XENIA')
    : s('path', { d: 'M272 243 L277 252 H267 Z', fill: '#d0342c' })];

  // Bedienelemente je Modell
  const controls = [];
  if (classic) {
    // DBL: Leuchten rechts der Brühgruppe, Symbole neben den Kippschaltern
    for (let i = 0; i < 4; i++) controls.push(s('circle', { cx: 206, cy: 128 + i * 15, r: 5.2, fill: 'url(#mChrome)' }), s('circle', { cx: 206, cy: 128 + i * 15, r: 3.6, fill: '#2a2c31' }));
    controls.push(s('path', { d: 'M119.5 63 A6 6 0 1 0 126.5 63 M123 59 V66', fill: 'none', stroke: ink, 'stroke-width': 1.6, 'stroke-linecap': 'round' }),
      s('path', { d: 'M192 61 H202 V67 A3.5 3.5 0 0 1 198.5 70.5 H195.5 A3.5 3.5 0 0 1 192 67 Z M202 63 H204 A2 2 0 0 1 204 67 H202', fill: 'none', stroke: ink, 'stroke-width': 1.4, 'stroke-linejoin': 'round' }));
  } else {
    // Display schmal auf der rechten Seitenleiste: Symbole oben, Gewicht und Zeit darunter
    controls.push(s('rect', { x: 259, y: 128, width: 12, height: 44, rx: 2, fill: '#0b0c0e', stroke: '#2a2c31' }));
    for (const y of [133, 140, 147]) controls.push(s('circle', { cx: 265, cy: y, r: 1.6, fill: 'none', stroke: '#d9dce0', 'stroke-width': 0.6 }));
    controls.push(s('rect', { x: 261.5, y: 154, width: 7, height: 5, rx: 0.8, fill: '#d9dce0', opacity: 0.85 }),
      s('rect', { x: 261.5, y: 163, width: 7, height: 5, rx: 0.8, fill: '#d9dce0', opacity: 0.85 }));
  }

  const svg = s('svg', { class: `machine-svg render${classic ? ' dbl' : ''}`, viewBox: '20 14 280 326', role: 'img',
    'aria-label': classic ? t('home.switches.renderDbl') : t('home.switches.render') },
  defs, ...rail, ...shell, ...tray, ...front, ...controls, ...parts.valves, wands, ...parts.group);
  // Maserung von Siebträger und Hebelgriffen in der Griff-Farbe (per CSSOM, ein style-Attribut verbietet die CSP)
  svg.style.setProperty('--grip-grain', grain);

  return classic ? dblToggles(svg, [[105, 63], [215, 63]], 1, onPick) : xeniaButtons(svg, 'render', 1, onPick);
}

// --- Vereinfachte Ansicht ----------------------------------------------------------------
// Nur der Bereich mit den Tastern bzw. Kippschaltern, als Linien in den Farben des Designs (ohne Gehäusefarbe,
// Brühgruppe, Lanzen und Manometer).
function simpleSvg({ classic, onPick }) {
  if (!classic) {
    const svg = s('svg', { class: 'machine-svg schema', viewBox: '30 72 260 84', role: 'img', 'aria-label': t('home.switches.simple') },
      s('rect', { class: 'body', x: 30.5, y: 72.5, width: 259, height: 83, rx: 6 }));
    return xeniaButtons(svg, 'simple', 1.05, onPick);
  }
  // DBL: Symbole wie an der Maschine (Ein/Aus rechts vom linken, Tasse links vom rechten Schalter)
  const svg = s('svg', { class: 'machine-svg schema dbl', viewBox: '30 32 260 82', role: 'img', 'aria-label': t('home.switches.simpleDbl') },
    s('rect', { class: 'front', x: 30.5, y: 32.5, width: 259, height: 81, rx: 6 }),
    s('path', { class: 'sym', d: 'M121.5 77 A8 8 0 1 0 130.5 77 M126 72 V81' }),
    s('path', { class: 'sym', d: 'M188 75 H200 V83 A4 4 0 0 1 196 87 H192 A4 4 0 0 1 188 83 Z M200 77.5 H202.5 A2.5 2.5 0 0 1 202.5 82.5 H200' }));
  return dblToggles(svg, [[100, 80], [220, 80]], 1.15, onPick);
}

// Vier Taster der neuen Xenia an der Stelle der jeweiligen Ansicht; k skaliert die Kappen
function xeniaButtons(svg, view, k, onPick) {
  for (const b of BUTTONS) {
    const [cx, cy] = b[view];
    svg.append(pickable(s('g', { class: 'mbtn', 'data-key': b.key, role: 'button', tabindex: 0, 'aria-label': t('home.switches.button', { label: b.label }) },
      s('circle', { class: 'halo', cx, cy, r: 15 * k }),
      s('circle', { class: 'cap', cx, cy, r: 10 * k }),
      s('circle', { class: 'cap-in', cx, cy, r: 7.6 * k }),
      s('g', { class: 'glyph', transform: `translate(${cx} ${cy})` }, s('path', { d: GLYPHS[b.glyph] }))), b.key, onPick));
  }
  return svg;
}

// DBL: zwei Kippschalter; jede Seite antippbar, die gewählte kippt den Hebel sichtbar. ② ist fest Ein/Aus.
// pos: Mitte des linken und des rechten Schalters; k skaliert alle Maße.
function dblToggles(svg, pos, k, onPick) {
  const tips = {};
  const toggle = ([cx, cy], side) => {
    const tip = s('g', { class: 'tg-tip' },
      s('line', { class: 'tg-stem', x1: cx, y1: cy, x2: cx, y2: cy }),
      s('circle', { class: 'tg-head', cx, cy, r: 4.6 * k }));
    tips[side] = { tip, cx };
    const halves = DBL_BUTTONS.filter((b) => b.lever === side).map((b) => {
      const nx = cx + b.dir * 15 * k;
      return pickable(s('g', { class: `mbtn lever-side${b.fixed ? ' fixed' : ''}`, 'data-key': b.key, role: 'button', tabindex: 0, 'aria-label': t('home.switches.toggle', { no: b.no, label: b.label }) },
        s('rect', { class: 'halo', x: b.dir < 0 ? cx - 19 * k : cx + k, y: cy - 13 * k, width: 18 * k, height: 26 * k, rx: 8 * k }),
        s('circle', { class: 'pos-ring', cx: nx, cy: cy - 22 * k, r: 7.5 * k }),
        s('text', { class: 'pos-no', x: nx, y: cy - 22 * k + 3.4, 'text-anchor': 'middle' }, String(b.no)),
        s('rect', { class: 'hit', x: b.dir < 0 ? cx - 30 * k : cx, y: cy - 32 * k, width: 30 * k, height: 48 * k })), b.key, onPick);
    });
    return s('g', { class: 'toggle' },
      s('polygon', { class: 'tg-nut', points: hexPoints(cx, cy, 10.5 * k) }),
      s('circle', { class: 'tg-ring', cx, cy, r: 7.4 * k }),
      s('circle', { class: 'tg-hole', cx, cy, r: 5.2 * k }),
      tip, ...halves);
  };
  svg.append(toggle(pos[0], 'left'), toggle(pos[1], 'right'));
  svg.tilt = (key) => {
    const b = DBL_BUTTONS.find((x) => x.key === key);
    for (const [side, t] of Object.entries(tips)) {
      const dx = b && b.lever === side ? b.dir * 8 * k : 0;
      t.tip.querySelector('.tg-head').setAttribute('cx', String(t.cx + dx));
      t.tip.querySelector('.tg-stem').setAttribute('x2', String(t.cx + dx));
      t.tip.classList.toggle('tilted', Boolean(dx));
    }
  };
  return svg;
}

function hexPoints(cx, cy, r) {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
}

function switchesTab(root) {
  const features = store.server?.features || {};
  const classic = isClassic();
  const BTNS = classic ? DBL_BUTTONS : BUTTONS;
  const box = h('div', {}, h('div', { class: 'empty' }, t('home.switches.loading')));
  root.append(box);
  (async () => {
    try {
      const [sw, sc] = await Promise.all([api('/api/machine/switches'), api('/api/machine/scripts')]);
      const options = [
        ...Object.entries(sc.builtin).map(([id, title]) => ({ id: Number(id), title: classic && id === '7' && sw.singleDoseG ? `${title} ${sw.singleDoseG} g/ml` : classic && id === '8' && sw.doubleDoseG ? `${title} ${sw.doubleDoseG} g/ml` : title })),
        ...sc.scripts.filter((x) => x.id > 9).map((x) => ({ id: x.id, title: x.title })),
      ];
      const nm = (id) => options.find((o) => o.id === id)?.title || (id ? t('home.switches.script', { id }) : t('home.switches.none'));
      const assign = {};
      for (const b of BTNS) if (!b.fixed) assign[b.key] = { short: sw.buttons[b.key]?.short ?? 0, long: sw.buttons[b.key]?.long ?? 0 };
      const changed = {};
      const editable = Boolean(features.settings);

      const saveBtn = h('button', { class: 'btn filled wide', disabled: true, onclick: async () => {
        saveBtn.disabled = true;
        try {
          await api('/api/machine/switches', { method: 'PUT', body: { buttons: changed } });
          for (const k of Object.keys(changed)) delete changed[k];
          snackbar(t('home.switches.saved'));
        } catch (e) {
          snackbar(e.message);
          saveBtn.disabled = false;
        }
      } }, icon('check', 's18'), t('home.switches.save'));

      const cards = {};
      let selected = null;
      const look = machineLook();
      const svg = look.style === 'simple' ? simpleSvg({ classic, onPick: (key) => pick(key) }) : xeniaSvg({ classic, look, onPick: (key) => pick(key) });
      function pick(key) {
        selected = selected === key ? null : key;
        for (const g of svg.querySelectorAll('.mbtn')) g.classList.toggle('sel', g.dataset.key === selected);
        svg.tilt?.(selected);
        for (const [k, c] of Object.entries(cards)) c.classList.toggle('sel', k === selected);
        if (selected) cards[selected].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      const select = (b, press) => {
        const el = h('select', { class: 'text', 'aria-label': press === 'short' ? t('home.switches.selectShort', { label: b.label }) : t('home.switches.selectLong', { label: b.label }), disabled: !editable },
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
      const grid = h('div', { class: 'btn-assign' }, BTNS.map((b) => {
        const c = h('div', { class: 'assign-card', onclick: (e) => { if (e.target.tagName !== 'SELECT') pick(b.key); } },
          h('div', { class: 'ttl' }, classic ? t('home.switches.dblCard', { mark: '①②③④'[b.no - 1], label: b.label }) : b.label, b.fixed ? h('span', { class: 'badge' }, t('home.switches.locked')) : null),
          b.fixed
            ? [h('div', { class: 'kv' }, h('span', { class: 'k' }, t('home.switches.short')), h('span', { class: 'v' }, b.fixed.short)),
              h('div', { class: 'kv' }, h('span', { class: 'k' }, t('home.switches.long')), h('span', { class: 'v' }, b.fixed.long))]
            : [h('label', { class: 'kv' }, h('span', { class: 'k' }, t('home.switches.short')), select(b, 'short')),
              h('label', { class: 'kv' }, h('span', { class: 'k' }, t('home.switches.long')), select(b, 'long'))]);
        cards[b.key] = c;
        return c;
      }));

      box.replaceChildren(
        h('div', { class: 'card' },
          h('h3', {}, t('home.switches.title')),
          h('p', { class: 'muted small' }, classic
            ? t('home.switches.introDbl')
            : t('home.switches.intro')),
          h('div', { class: 'machine-wrap' }, svg,
            directMode || !look.editButton ? null : h('button', { class: 'btn text', type: 'button', onclick: () => navigate('/einstellungen/modell#aussehen') }, icon('settings', 's18'), t('home.switches.changeLook'))),
          grid,
          editable ? saveBtn : h('p', { class: 'muted small' }, t('home.switches.readOnly'))));
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
    root.append(h('div', { class: 'empty' }, t('home.paddle.disabled')));
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
  const paddle = h('div', { class: 'paddle locked', role: 'slider', 'aria-label': t('home.paddle.slider'), 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0, 'aria-disabled': 'true', tabindex: 0 },
    h('div', { class: 'lines' }), fill, lvl, knob);
  const stopBtn = h('button', { class: 'btn danger wide big', onclick: () => stopPump(true) }, icon('power', 's20'), t('home.paddle.stop'));
  const enable = switchEl({ label: t('home.paddle.enable'), onChange: (on) => setActive(on) });
  const enableInput = enable.querySelector('input');
  const recSw = switchEl({ label: t('home.paddle.record'), onChange: (on) => setRecording(on) });
  const recInput = recSw.querySelector('input');
  const recInfo = h('div', { class: 'muted small' }, t('home.paddle.recordHint'));
  const hint = h('div', { class: 'offline-banner', hidden: true }, icon('warn', 's20'), h('span', {}, t('home.paddle.machineOffBanner')));

  root.append(
    hint,
    h('div', { class: 'card low row' }, h('div', { class: 'grow' }, h('strong', {}, t('home.paddle.mode')), h('div', { class: 'muted small' }, t('home.paddle.modeHint'))), enable),
    h('div', { class: 'card low row' }, icon('record'), h('div', { class: 'grow' }, h('strong', {}, t('home.paddle.record')), recInfo), recSw),
    h('div', { class: 'readouts' },
      h('div', {}, vP, h('div', { class: 'k' }, t('home.paddle.readPressure'))),
      h('div', {}, vL, h('div', { class: 'k' }, t('home.paddle.readPump'))),
      h('div', {}, vT, h('div', { class: 'k' }, t('home.paddle.readTime')))),
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
        snackbar(e.status === 502 ? t('home.paddle.notReady') : e.message);
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
        if (notify) snackbar(t('home.paddle.stopped'));
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
    recInfo.textContent = t('home.paddle.recording', { n: rec.steps.length / 2 });
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
      recInfo.textContent = t('home.paddle.recordingStart');
      return;
    }
    if (!rec) return;
    if (rec.lastLevel > 0) flushSegment(Date.now());
    const steps = rec.steps;
    rec = null;
    recInfo.textContent = t('home.paddle.recordHint');
    if (!steps.length) return;
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const name = `paddle_${d.getFullYear()}_${p(d.getMonth() + 1)}_${p(d.getDate())}_${p(d.getHours())}_${p(d.getMinutes())}_${p(d.getSeconds())}`;
    if (!(await confirmDialog(t('home.paddle.saveTitle'), t('home.paddle.saveText', { n: steps.length / 2, name }), t('common.save')))) return;
    try {
      await api('/api/machine/scripts', { method: 'POST', body: { name, steps: [...steps, { op: 17, args: [] }], kind: 'paddle' } });
      snackbar(t('home.paddle.saved'));
    } catch (e) {
      snackbar(e.message);
    }
  }

  const fromEvent = (e) => {
    const r = paddle.getBoundingClientRect();
    return ((r.bottom - e.clientY) / r.height) * 100;
  };
  paddle.addEventListener('pointerdown', (e) => {
    if (!machineOn()) return snackbar(t('home.paddle.machineOff'));
    if (!active) return snackbar(t('home.paddle.enableFirst'));
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
