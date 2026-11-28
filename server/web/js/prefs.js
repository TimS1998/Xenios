// Einstellungen dieses Geräts (localStorage): sichtbare Tabs, ausgeblendete Komponenten, Einschalten ohne Dampf.
// Ändert sich etwas, gibt es das Ereignis „xenios-prefs“ (Navigation und offene Seiten zeichnen sich neu).
import { t } from '../shared/i18n.js';

function get(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function set(k, v) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch { /* privat */ }
  window.dispatchEvent(new CustomEvent('xenios-prefs', { detail: k }));
}
function readSet(k) {
  try {
    const v = JSON.parse(get(k) || '[]');
    return new Set(Array.isArray(v) ? v.map(String) : []);
  } catch {
    return new Set();
  }
}

// --- Tabs der unteren Leiste ---
export const hiddenTabs = () => readSet('navHidden');
export function setTabHidden(path, hidden) {
  const s = hiddenTabs();
  if (hidden) s.add(path); else s.delete(path);
  set('navHidden', JSON.stringify([...s]));
}

// --- Komponenten komplett ausblenden ---
export const COMPONENTS = [
  { id: 'grinder', get title() { return t('app.components.grinderTitle'); }, get sub() { return t('app.components.grinderSub'); } },
  { id: 'scale', get title() { return t('app.components.scaleTitle'); }, get sub() { return t('app.components.scaleSub'); } },
  { id: 'care', get title() { return t('app.components.careTitle'); }, get sub() { return t('app.components.careSub'); } },
];
export const isHidden = (id) => readSet('hiddenComponents').has(id);
export function setComponentHidden(id, hidden) {
  const s = readSet('hiddenComponents');
  if (hidden) s.add(id); else s.delete(id);
  set('hiddenComponents', JSON.stringify([...s]));
}

// --- Einschalten ohne Dampfkessel (gilt für Startseite, Dashboard und App-Shortcut „Ein“) ---
// In der Android-App gilt die Einstellung auch für die Widgets: die App führt sie (Widget-Schalter ändern sie dort)
export const noSteamOn = () => {
  if (typeof window.XeniaApp?.getNoSteamOn === 'function') {
    try { return window.XeniaApp.getNoSteamOn(); } catch { /* ältere App */ }
  }
  return get('powerNoSteam') === '1';
};
export const setNoSteamOn = (on) => {
  set('powerNoSteam', on ? '1' : null);
  try { window.XeniaApp?.setNoSteamOn?.(Boolean(on)); } catch { /* ältere App */ }
};

// Body für POST /api/machine/power zum Einschalten
export const powerOnBody = () => (noSteamOn() ? { mode: 'on', steam: false } : { mode: 'on' });

export function onPrefs(fn) {
  const h = (e) => fn(e.detail);
  window.addEventListener('xenios-prefs', h);
  return () => window.removeEventListener('xenios-prefs', h);
}
