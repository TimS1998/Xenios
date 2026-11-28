// Texte der Oberfläche und des Servers in mehreren Sprachen. Alle sichtbaren Texte stehen in den Katalogen unter
// i18n/<Sprache>/ (je Bereich eine Datei), hier nur das Nachschlagen, Einsetzen von Werten, Mehrzahl und die Formate
// für Zahlen und Datum. Gemeinsam für Browser, Android-App (Direkt-Modus) und Server.
//
// Neue Sprache (z. B. Englisch): Ordner i18n/en/ mit denselben Dateien und Schlüsseln anlegen, unten in CATALOGS und
// LOCALES eintragen. Fehlende Schlüssel fallen auf Deutsch zurück (test/i18n.test.js meldet sie).
import de from './i18n/de/index.js';

export const CATALOGS = { de };
// Formate je Sprache (Zahlen, Datum, Uhrzeit); en-GB: 24-Stunden-Uhr und Tag vor Monat wie bisher
export const LOCALES = { de: 'de-DE', en: 'en-GB' };
export const DEFAULT_LANG = 'de';
export const LANGS = Object.keys(CATALOGS);

let current = DEFAULT_LANG;

// Sprache wählen: unterstützte Sprache oder Deutsch. Akzeptiert auch „en-US“, „de_DE“ usw.
export function pickLang(wanted) {
  const l = String(wanted || '').slice(0, 2).toLowerCase();
  return CATALOGS[l] ? l : DEFAULT_LANG;
}
export function setLang(wanted) {
  current = pickLang(wanted);
  return current;
}
export const lang = () => current;

// Im Browser (auch Android-WebView) gleich beim Laden: eigene Wahl (localStorage „lang“) oder Sprache des Geräts.
// Nicht auf dem Server: Node kennt navigator.language auch, der Server wählt die Sprache je Anfrage bzw. Gerät.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  let own = null;
  try { own = localStorage.getItem('lang'); } catch { /* privat */ }
  setLang(own || navigator.language);
  document.documentElement.lang = current;
}
export const locale = (l = current) => LOCALES[l] || LOCALES[DEFAULT_LANG];

function lookup(cat, key) {
  let v = cat;
  for (const part of key.split('.')) {
    if (v == null || typeof v !== 'object') return undefined;
    v = v[part];
  }
  return v;
}

// Mehrzahl: Wert als { one, other } (optional zero, two, few, many); gewählt über params.n
function plural(v, params, l) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || !('other' in v)) return v;
  const n = Number(params?.n);
  if (!Number.isFinite(n)) return v.other;
  if (n === 0 && 'zero' in v) return v.zero;
  return v[new Intl.PluralRules(locale(l)).select(n)] ?? v.other;
}

// t('bereich.schlüssel', { name: 'Wert', n: 3 }, lang?) → Text mit eingesetzten Werten ({name}, {n}).
// Unbekannter Schlüssel: Deutsch, sonst der Schlüssel selbst (fällt beim Testen auf).
export function t(key, params, l = current) {
  let v = lookup(CATALOGS[l] || {}, key);
  if (v === undefined && l !== DEFAULT_LANG) v = lookup(CATALOGS[DEFAULT_LANG], key);
  v = plural(v, params, l);
  if (typeof v !== 'string') return Array.isArray(v) ? v : key;
  return params ? v.replace(/\{(\w+)\}/g, (m, k) => (params[k] === undefined || params[k] === null ? m : String(params[k]))) : v;
}

// Für Listen und Tabellen im Katalog (z. B. Wochentage): Rohwert ohne Einsetzen
export function tRaw(key, l = current) {
  const v = lookup(CATALOGS[l] || {}, key);
  return v === undefined && l !== DEFAULT_LANG ? lookup(CATALOGS[DEFAULT_LANG], key) : v;
}
