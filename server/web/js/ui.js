// UI-Hilfen: Elemente bauen (ohne innerHTML für Fremddaten), Icons, Snackbar, Sheets, Dialoge, Formatierung.
import { store } from './api.js';

// replaceChildren/append ignorieren null/false (praktisch für bedingte Elemente)
for (const proto of [Element.prototype, DocumentFragment.prototype]) {
  for (const name of ['replaceChildren', 'append']) {
    const orig = proto[name];
    proto[name] = function (...kids) {
      return orig.apply(this, kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
    };
  }
}

export function h(tag, attrs, ...children) {
  const isSvg = ['svg', 'path', 'circle', 'g', 'line', 'text', 'polyline', 'rect', 'polygon', 'tspan'].includes(tag);
  const el = isSvg ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
    else if (k === 'value' && !isSvg) el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') el[k] = Boolean(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    const text = c instanceof Node ? c : document.createTextNode(tag === 'option' ? String(c).replace(/ /g, '\u00a0') : String(c));
    el.append(text);
  }
  return el;
}

// Material-Icons (Apache-2.0), als Pfade eingebettet
const P = {
  home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
  dashboard: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  profile: 'M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z',
  search: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  explore: 'M12 10.9c-.61 0-1.1.49-1.1 1.1s.49 1.1 1.1 1.1c.61 0 1.1-.49 1.1-1.1s-.49-1.1-1.1-1.1zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm2.19 12.19L6 18l3.81-8.19L18 6l-3.81 8.19z',
  open: 'M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z',
  copy: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
  screen: 'M17 1.01 7 1c-1.1 0-1.99.9-1.99 2v18c0 1.1.89 2 1.99 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z',
  list: 'M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z',
  event: 'M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11zM7 11h5v5H7z',
  settings: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
  power: 'M13 3h-2v10h2V3zm4.83 2.17-1.42 1.42A6.92 6.92 0 0 1 19 12c0 3.87-3.13 7-7 7A6.995 6.995 0 0 1 7.58 6.58L6.17 5.17A8.932 8.932 0 0 0 3 12a9 9 0 0 0 18 0c0-2.74-1.23-5.18-3.17-6.83z',
  eco: 'M6.05 8.05a7.007 7.007 0 0 0-.02 9.88c1.47-3.4 4.09-6.24 7.36-7.93A15.952 15.952 0 0 0 8.68 16.4c2.6 1.23 5.8.78 7.95-1.37C20.11 11.55 20 4 20 4s-7.55-.11-11.03 3.37z',
  cloud: 'M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z',
  drop: 'M12 2c-5.33 4.55-8 8.48-8 11.8 0 4.98 3.8 8.2 8 8.2s8-3.22 8-8.2c0-3.32-2.67-7.25-8-11.8z',
  play: 'M8 5v14l11-7z',
  stop: 'M6 6h12v12H6z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  del: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  more: 'M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z',
  less: 'm12 8-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z',
  left: 'M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z',
  right: 'M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z',
  up: 'M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z',
  down: 'm20 12-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z',
  bell: 'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z',
  logout: 'M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z',
  refresh: 'M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  clock: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
  coffee: 'M20 3H4v10a4 4 0 0 0 4 4h6a4 4 0 0 0 4-4v-3h2a2 2 0 0 0 2-2V5c0-1.11-.89-2-2-2zm0 5h-2V5h2v3zM4 19h16v2H4z',
  grinder: 'M6 2h12l-2.2 6H8.2L6 2zm2 7h8v8.5a2.5 2.5 0 0 1-2.5 2.5h-3A2.5 2.5 0 0 1 8 17.5V9zm2.2 3.2v4h3.6v-4h-3.6zM5 21h14v1.5H5z',
  download: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
  upload: 'M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z',
  record: 'M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0-5C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z',
  thermo: 'M15 13V5c0-1.66-1.34-3-3-3S9 3.34 9 5v8c-1.21.91-2 2.37-2 4 0 2.76 2.24 5 5 5s5-2.24 5-5c0-1.63-.79-3.09-2-4zm-4-8c0-.55.45-1 1-1s1 .45 1 1h-1v1h1v2h-1v1h1v2h-2V5z',
  wifi: 'M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8 3 3 3-3a4.237 4.237 0 0 0-6 0zm-4-4 2 2a7.074 7.074 0 0 1 10 0l2-2C15.14 9.14 8.87 9.14 5 13z',
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  info: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
  history: 'M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z',
  warn: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
  sort: 'M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z',
  tune: 'M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z',
  scale: 'M12 3c-1.27 0-2.4.8-2.82 2H3v2h1.95L2 14c-.47 2 1 3 3.5 3s4.06-1 3.5-3L6.05 7h3.12c.33.85.97 1.51 1.83 1.83V19H2v2h20v-2h-9V8.82c.85-.32 1.5-.98 1.83-1.82h3.12L15 14c-.47 2 1 3 3.5 3s4.06-1 3.5-3l-2.95-7H21V5h-6.17C14.4 3.8 13.27 3 12 3zM5.5 9.5 7 13H4l1.5-3.5zm13 0L20 13h-3l1.5-3.5z',
  timer: 'M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61 1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42A8.962 8.962 0 0 0 12 4c-4.97 0-9 4.03-9 9s4.02 9 9 9a8.994 8.994 0 0 0 7.03-14.61zM12 20c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z',
  shield: 'M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z',
  palette: 'M12 3a9 9 0 0 0 0 18c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z',
};

export function icon(name, cls = '') {
  return h('svg', { class: `icon ${cls}`.trim(), viewBox: '0 0 24 24', 'aria-hidden': 'true' }, h('path', { d: P[name] || P.info }));
}

// --- Formatierung (deutsch) ---
export const fmt = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '–' : Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }));
export const fmtInt = (v) => (v === null || v === undefined ? '–' : Number(v).toLocaleString('de-DE'));
export const hhmm = (min) => (min === null || min === undefined ? '--:--' : `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`);
export function fromHhmm(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  return Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2]));
}
// Zeitzone der Anzeige: die des Servers (Zeitplan und Wecker). Die WebView der App bleibt sonst auf UTC,
// dann liegt jede Uhrzeit eine Stunde daneben, sobald die Winterzeit gilt.
export function clockZone() {
  try {
    const z = globalThis.window?.XeniaApp?.timeZone?.();
    if (typeof z === 'string' && z.includes('/')) return z;
  } catch { /* keine App-Brücke */ }
  const server = store.server?.timezone;
  if (server && server !== 'UTC') return server;
  return undefined;
}

export function withZone(opts) {
  const timeZone = clockZone();
  return timeZone ? { ...opts, timeZone } : opts;
}

export function ago(iso) {
  if (!iso) return '–';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.round(s / 60)} min`;
  if (s < 86400) return `vor ${Math.round(s / 3600)} h`;
  return new Date(iso).toLocaleDateString('de-DE', withZone({ day: '2-digit', month: '2-digit' })) + ' ' + new Date(iso).toLocaleTimeString('de-DE', withZone({ hour: '2-digit', minute: '2-digit' }));
}
export const dateTime = (iso) => (iso ? new Date(iso).toLocaleString('de-DE', withZone({ day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })) : '–');

// --- Bausteine ---
export function switchEl({ checked, disabled, onChange, label }) {
  const input = h('input', { type: 'checkbox', role: 'switch', checked, disabled, 'aria-label': label });
  input.addEventListener('change', () => onChange?.(input.checked, input));
  return h('label', { class: 'switch' }, input, h('span', { class: 'track' }, h('span', { class: 'thumb' })));
}

export function sliderRow({ label, min, max, step = 1, value, unit = '', digits = 1, onInput }) {
  const out = h('span', { class: 'value' });
  const input = h('input', { type: 'range', min, max, step, value });
  const paint = () => {
    const pct = ((Number(input.value) - min) / (max - min)) * 100;
    input.style.setProperty('--fill', `${pct}%`);
    out.textContent = `${fmt(Number(input.value), digits)}${unit ? ' ' + unit : ''}`;
  };
  input.addEventListener('input', () => {
    paint();
    onInput?.(Number(input.value));
  });
  paint();
  const row = h('div', { class: 'slider-row' }, h('span', { class: 'label' }, label), out, input);
  row.setValue = (v) => { input.value = v; paint(); };
  row.input = input;
  return row;
}

let snackTimer;
export function snackbar(message, { action, onAction, duration = 3500 } = {}) {
  const el = document.getElementById('snackbar');
  el.replaceChildren(h('span', { class: 'msg' }, message));
  if (action) el.append(h('button', { onclick: () => { el.classList.remove('show'); onAction?.(); } }, action));
  el.classList.add('show');
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => el.classList.remove('show'), duration);
}

function overlay(panel, { onClose } = {}) {
  const root = document.getElementById('sheet-root');
  const scrim = h('div', { class: 'scrim' });
  const close = () => {
    panel.classList.remove('show');
    scrim.classList.remove('show');
    setTimeout(() => { panel.remove(); scrim.remove(); }, 220);
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  root.append(scrim, panel);
  requestAnimationFrame(() => { scrim.classList.add('show'); panel.classList.add('show'); });
  return close;
}

export function sheet(title, content, opts) {
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-label': title }, h('div', { class: 'handle' }), title ? h('h2', {}, title) : null, content);
  return overlay(panel, opts);
}

export function dialog(title, content, actions = []) {
  return new Promise((resolve) => {
    let close;
    const btns = actions.map((a) => h('button', { class: `btn ${a.kind || 'text'}`, onclick: () => { resolve(a.value); close(); } }, a.label)); // erst den Wert, sonst gewinnt resolve(undefined) aus onClose
    const panel = h('div', { class: 'dialog', role: 'alertdialog' }, h('h2', {}, title), typeof content === 'string' ? h('p', { class: 'muted' }, content) : content, h('div', { class: 'actions' }, btns));
    close = overlay(panel, { onClose: () => resolve(undefined) });
  });
}

export function promptNumber(title, { value, min, max, step = 0.1, unit = '' } = {}) {
  const input = h('input', { class: 'text', type: 'number', inputmode: 'decimal', min, max, step, value: value ?? '' });
  const p = dialog(title, h('label', { class: 'field' }, h('span', {}, `${fmt(min, 0)}–${fmt(max, 0)} ${unit}`), input), [
    { label: 'Abbrechen', value: null },
    { label: 'OK', value: 'ok', kind: 'filled' },
  ]).then((r) => {
    if (r !== 'ok') return null;
    const n = Number(String(input.value).replace(',', '.'));
    return Number.isFinite(n) && n >= min && n <= max ? n : NaN;
  });
  setTimeout(() => { input.focus(); input.select(); }, 60);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.closest('.dialog')?.querySelector('.btn.filled')?.click(); });
  return p;
}

export const confirmDialog = (title, text, okLabel = 'OK', kind = 'filled') =>
  dialog(title, text, [{ label: 'Abbrechen', value: false }, { label: okLabel, value: true, kind }]).then(Boolean);

export function fullscreen(build) {
  const inner = h('div', { class: 'inner' });
  const panel = h('div', { class: 'fullscreen', role: 'dialog' }, inner);
  document.getElementById('sheet-root').append(panel);
  requestAnimationFrame(() => panel.classList.add('show'));
  const close = () => {
    panel.classList.remove('show');
    setTimeout(() => panel.remove(), 200);
  };
  build(inner, close);
  return close;
}

// Ripple-Effekt (Material) für Schaltflächen, Listeneinträge und Chips – ein Listener für die ganze App.
const RIPPLE = '.btn, .icon-btn, .list-item.clickable, .chip, .nav-item, .script-item, .tab';
document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let el = e.target.closest?.(RIPPLE);
  if (el?.classList.contains('nav-item')) el = el.querySelector('.pill');
  if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
  const r = el.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 2;
  const dot = document.createElement('span');
  dot.className = 'ripple';
  dot.style.setProperty('--x', `${e.clientX - r.left - size / 2}px`);
  dot.style.setProperty('--y', `${e.clientY - r.top - size / 2}px`);
  dot.style.setProperty('--d', `${size}px`);
  el.append(dot);
  dot.addEventListener('animationend', () => dot.remove(), { once: true });
}, { passive: true });

// Zeitwähler im App-Stil: zwei Rädchen (Stunde, Minute) mit Einrasten statt des Browser-Popups.
// → Minuten seit Mitternacht, null (bei allowClear: „Keine“) oder undefined (abgebrochen)
export function pickTimeDialog({ title = 'Uhrzeit', value = 7 * 60, allowClear = false } = {}) {
  const v = value ?? 7 * 60;
  const hours = wheel(24, Math.floor(v / 60));
  const minutes = wheel(60, v % 60);
  const content = h('div', { class: 'wheels' }, hours.el, h('span', { class: 'wheel-sep' }, ':'), minutes.el);
  const actions = [
    allowClear ? { label: 'Keine', value: 'clear' } : null,
    { label: 'Abbrechen', value: 'cancel' },
    { label: 'OK', value: 'ok', kind: 'filled' },
  ].filter(Boolean);
  setTimeout(() => hours.el.focus(), 60);
  return dialog(title, content, actions).then((r) => (r === 'ok' ? hours.value * 60 + minutes.value : r === 'clear' ? null : undefined));
}

function wheel(count, selected) {
  const ITEM = 40;
  const items = Array.from({ length: count }, (_, i) => h('div', { class: 'wheel-item', role: 'option', onclick: () => go(i) }, String(i).padStart(2, '0')));
  const el = h('div', { class: 'wheel', tabindex: '0', role: 'listbox' }, h('div', { class: 'wheel-pad' }), items, h('div', { class: 'wheel-pad' }));
  let value = Math.min(count - 1, Math.max(0, selected));
  const mark = () => items.forEach((it, i) => it.setAttribute('aria-selected', String(i === value)));
  const go = (i, smooth = true) => el.scrollTo({ top: Math.min(count - 1, Math.max(0, i)) * ITEM, behavior: smooth ? 'smooth' : 'auto' });
  el.addEventListener('scroll', () => {
    const i = Math.min(count - 1, Math.max(0, Math.round(el.scrollTop / ITEM)));
    if (i !== value) {
      value = i;
      mark();
    }
  }, { passive: true });
  el.addEventListener('keydown', (e) => {
    const d = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 }[e.key];
    if (d) {
      e.preventDefault();
      go(value + d);
    } else if (e.key === 'Enter') {
      el.closest('.dialog')?.querySelector('.btn.filled')?.click();
    }
  });
  mark();
  requestAnimationFrame(() => go(value, false));
  return { el, get value() { return value; } };
}
