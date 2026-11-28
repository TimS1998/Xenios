// Einstellungen: die Hauptseite ist nur eine Übersicht in drei Gruppen (App, Espressomaschine, Server); jeder Eintrag
// öffnet eine eigene Seite. Seiten mit Werten des Servers stehen in views/server.js.
import { h, icon, fmt, fmtInt, snackbar, switchEl, sliderRow, ago } from '../ui.js';
import { api, store, isClassic, classicPages } from '../api.js';
import { logout, applyTheme, localStorageGet, localStorageSet, inAndroidApp, navigate, navChoices, THEME_DEFAULTS, uiPalette, gaugeKey, gaugeChoice } from '../app.js';
import { hiddenTabs, setTabHidden, COMPONENTS, isHidden, setComponentHidden, noSteamOn, setNoSteamOn, onPrefs } from '../prefs.js';

const listButton = (ic, title, sub, onclick) => h('button', { class: 'list-item clickable as-button', onclick },
  h('span', { class: 'lead' }, icon(ic)),
  h('span', { class: 'grow' }, h('div', { class: 'title' }, title), sub ? h('div', { class: 'sub' }, sub) : null),
  icon('right', 's20 muted'));
const go = (path) => () => navigate(path);

// Einklappbare Kategorie (wie die Sektion PID): Kopf mit Icon und Titel, Inhalt erst nach dem Aufklappen sichtbar
export function fold(title, ic, ...nodes) {
  return h('details', { class: 'card fold' },
    h('summary', {}, icon(ic, 's20'), h('span', { class: 'grow' }, title), icon('more', 's20 chev')),
    h('div', { class: 'fold-body' }, ...nodes.filter(Boolean)));
}
// Bereich, der beim Öffnen der Seite schon aufgeklappt ist (der meistgenutzte)
const openFold = (f) => { f.open = true; return f; };

// --- Hauptseite: Übersicht ---------------------------------------------------------------------------------
export function settingsView(root) {
  const unsubs = [];
  const direct = store.server?.mode === 'direct';
  const android = inAndroidApp();
  const group = (title, ...items) => [h('div', { class: 'section-title' }, title), h('div', { class: 'list' }, ...items.filter(Boolean))];
  root.append(
    ...group('App auf diesem Gerät',
      listButton('palette', 'Darstellung', 'Design, Hell/Dunkel, Farben, Manometer', go('/einstellungen/darstellung')),
      listButton('toggle', 'Leiste & Ansicht', 'Tabs der Leiste, Mühle, Waage und Pflege ausblenden', go('/einstellungen/ansicht')),
      widgetAlarmButton(unsubs),
      appUpdateItem(unsubs),
      direct && android ? listButton('wifi', 'App-Verbindung', 'Server-Adresse und Anmeldung der Android-App', () => window.XeniaApp.reauth()) : null),
    // Nach Aufgaben, häufig Genutztes oben; jede Seite mit einklappbaren Bereichen, der meistgenutzte aufgeklappt
    ...group('Espressomaschine',
      listButton('thermo', 'Temperaturen & Druck', 'Brühgruppe, Brühkessel, Dampfkessel, Pumpe & Bezugszeit', go('/einstellungen/temperaturen')),
      listButton('shotlog', 'Bezüge & Waage', isHidden('scale') ? 'Kurze Bezüge aussortieren, Standard-Dosis' : 'Kurze Bezüge aussortieren, Standard-Dosis, Waage', go('/einstellungen/bezuege')),
      listButton('power', 'Einschalten & Energiesparen', 'Mit/ohne Dampf, Aufheiz-Spülung, Eco und Ausschalten nach', go('/einstellungen/einschalten')),
      direct ? null : listButton('grinder', 'Mühle & Grind-by-Sync', store.server?.grinder?.enabled ? 'Mahlkönig E64 WS, Drehknopf startet Profile' : 'Mahlkönig E64 WS einbinden', go('/einstellungen/muehle')),
      direct ? listButton('info', 'Wi-Fi & Firmware', 'WLAN der Maschine, Firmware, Zähler', go('/einstellungen/firmware'))
        : listButton('coffeeLine', 'Modell, Aussehen & Firmware', 'Neue oder alte Xenia, Adresse, Ansicht unter „Schalter“, Wi-Fi, Firmware', go('/einstellungen/modell'))),
    ...(direct ? [] : group('Server',
      listButton('cloud', 'Von unterwegs', 'Zugriff über den Cloudflare-Tunnel', go('/einstellungen/unterwegs')),
      listButton('bell', 'Benachrichtigungen', 'Push-Meldungen auf diesem Gerät', go('/einstellungen/benachrichtigungen')),
      listButton('shield', 'Sicherheit', 'Passwort, angemeldete Geräte, HTTPS, Funktionen', go('/einstellungen/sicherheit')),
      listButton('info', 'System', 'Version und Aktualisierung, Zeitzone, Sicherung, Protokoll', go('/einstellungen/system')))),
    ...(direct ? [] : group('Konto',
      android ? listButton('wifi', 'App-Verbindung ändern', 'Server-Adresse und Anmeldung der Android-App', () => window.XeniaApp.reauth()) : null,
      listButton('logout', 'Abmelden', null, logout))),
    direct ? h('div', { class: 'card low muted small', style: { 'margin-top': '12px' } }, 'Direkt-Modus: Die App spricht Maschine und Mühle ohne Server im Heimnetz an. Server-Einstellungen gibt es dabei nicht.') : null,
    h('p', { class: 'muted small', style: { 'text-align': 'center', 'margin-top': '24px' } }, `Xenios ${store.server?.version || ''}`));
  return () => unsubs.forEach((u) => u());
}

// --- Unterseiten der App ---------------------------------------------------------------------------------------
export function appearanceView(root) {
  root.append(themeCard());
}

export function viewPrefsView(root) {
  const unsubs = [];
  root.append(
    h('div', { class: 'section-title' }, 'Leiste'), navCard(unsubs),
    h('div', { class: 'section-title' }, 'Komponenten'), componentsCard());
  return () => unsubs.forEach((u) => u());
}

// Bezüge & Waage: Aufzeichnung (gilt auf dem Server bzw. im Direkt-Modus in der App) und Zielgewicht der Waage
export function shotPrefsView(root) {
  const features = store.server?.features || {};
  root.append(h('div', { class: 'folds' },
    openFold(fold('Bezüge', 'shotlog', shotFilterCard())),
    isHidden('scale') ? null : fold('Waage', 'scale', scaleCard(features))));
}

// Wi-Fi & Firmware ohne Server (Direkt-Modus); mit Server unter „Modell, Aussehen & Firmware“
export function firmwareView(root) {
  root.append(h('div', { class: 'folds' }, ...deviceFolds()));
}

// Android-App: Erlaubnis „Wecker und Erinnerungen“, damit sich die Widgets alle 5 s aktualisieren
function widgetAlarmButton(unsubs) {
  if (!inAndroidApp() || typeof window.XeniaApp?.exactAlarms !== 'function') return null;
  const sub = h('div', { class: 'sub' });
  const paint = () => {
    let ok = true;
    try { ok = window.XeniaApp.exactAlarms(); } catch { /* ältere App */ }
    sub.textContent = ok ? 'Aktualisierung alle 5 s – Erlaubnis „Wecker und Erinnerungen“ erteilt'
      : 'Aktualisieren langsamer – für alle 5 s „Wecker und Erinnerungen“ erlauben';
  };
  paint();
  // nach der Rückkehr aus den Android-Einstellungen neu prüfen
  window.addEventListener('xenios-exact-alarms', paint);
  unsubs.push(() => window.removeEventListener('xenios-exact-alarms', paint));
  return h('button', { class: 'list-item clickable as-button', onclick: () => { try { window.XeniaApp.requestExactAlarms(); } catch { /* ältere App */ } } },
    h('span', { class: 'lead' }, icon('timer')),
    h('span', { class: 'grow' }, h('div', { class: 'title' }, 'Widgets'), sub),
    icon('right', 's20 muted'));
}

// Android-App: neue APK aus dem GitHub-Release laden und installieren. Ältere Apps ohne diese Brückenfunktion: kein Eintrag.
// Die Variante „ohne Updater“ (selfInstall false) installiert nicht selbst, sondern öffnet den Download im Browser.
function appUpdateItem(unsubs) {
  if (!inAndroidApp() || typeof window.XeniaApp?.appUpdate !== 'function') return null;
  const sub = h('div', { class: 'sub' });
  const btn = h('button', { type: 'button', class: 'btn tonal' });
  const item = h('div', { class: 'list-item' },
    h('span', { class: 'lead' }, icon('download')),
    h('span', { class: 'grow' }, h('div', { class: 'title' }, 'App-Update'), sub),
    btn);
  const paint = () => {
    let s;
    try { s = JSON.parse(window.XeniaApp.appUpdate()); } catch { item.hidden = true; return; }
    const self = s.selfInstall !== false; // Apps vor den zwei Varianten kennen das Feld nicht und installieren selbst
    const lines = s.phase === 'checking' ? ['Sucht nach einer neuen Version …']
      : s.phase === 'downloading' ? [`Lädt ${s.latest} … ${s.progress} %`]
      : s.phase === 'installing' ? ['Wird installiert. Xenios schließt sich dabei und ist danach aktualisiert.']
      : [
        `Installiert: ${s.installed}` + (s.available ? ` · neu: ${s.latest}` : s.checkedAt ? ' · aktuell' : ''),
        s.error || (s.available && !self ? 'Variante ohne Updater: lädt die APK im Browser, dann von Hand installieren'
          : s.available && !s.allowed ? 'Einmal „Unbekannte Apps installieren“ für Xenios erlauben' : null),
        !s.error && !s.available && s.checkedAt ? `Geprüft ${ago(new Date(s.checkedAt).toISOString())}` : null,
      ];
    sub.replaceChildren(...lines.filter(Boolean).flatMap((t, i) => (i ? [h('br'), t] : [t])));
    btn.disabled = Boolean(s.phase);
    btn.textContent = !s.available ? 'Prüfen' : self ? 'Installieren' : 'Herunterladen';
    btn.onclick = () => {
      try { if (s.available) window.XeniaApp.installAppUpdate(); else window.XeniaApp.checkAppUpdate(); } catch { /* ältere App */ }
    };
  };
  paint();
  window.addEventListener('xenios-app-update', paint);
  unsubs.push(() => window.removeEventListener('xenios-app-update', paint));
  return item;
}

// --- Werte der Maschine: zwei Seiten mit einklappbaren Bereichen ---------------------------------------------
// part 'temp': Temperaturen & Druck (Brühgruppe aufgeklappt, Brühkessel, Dampfkessel, Pumpe & Bezugszeit)
// part 'power': Einschalten & Energiesparen (Beim Einschalten aufgeklappt, Energiesparen, Wasser & Stabilität)
export const machineSettingsView = (part) => (root) => {
  const features = store.server?.features || {};

  // Speichern-Leiste für Maschinenwerte aus allen Kategorien
  const changes = {};
  const saveBtn = h('button', { class: 'btn filled', onclick: save }, icon('check', 's18'), 'Speichern');
  const savebar = h('div', { class: 'savebar', hidden: true, role: 'region', 'aria-label': 'Ungespeicherte Änderungen' },
    h('span', { class: 'savebar-text' }, 'Maschinenwerte geändert'),
    h('button', { class: 'btn text', onclick: () => { for (const k of Object.keys(changes)) delete changes[k]; savebar.hidden = true; loadMachine(); } }, 'Verwerfen'),
    saveBtn);
  const set = (k) => (v) => { changes[k] = v; savebar.hidden = false; };
  async function save() {
    saveBtn.disabled = true;
    try {
      await api('/api/machine/settings', { method: 'POST', body: { changes } });
      for (const k of Object.keys(changes)) delete changes[k];
      savebar.hidden = true;
      snackbar('Einstellungen gespeichert');
    } catch (e) {
      snackbar(e.message);
    } finally {
      saveBtn.disabled = false;
    }
  }

  const slots = { start: h('div'), energy: h('div'), water: h('div'), bruehgruppe: h('div'), bruehkessel: h('div'), dampfkessel: h('div'), pumpe: h('div') };
  const first = part === 'power' ? slots.start : slots.bruehgruppe;
  first.append(h('div', { class: 'muted small' }, 'Lade Einstellungen …'));
  // Energiesparen und Wasser & Stabilität nur, wenn die Maschine diese Werte über die API anbietet
  const energyFold = fold('Energiesparen', 'eco', slots.energy);
  const waterFold = fold('Wasser & Stabilität', 'drop', slots.water);
  energyFold.hidden = true;
  waterFold.hidden = true;
  root.append(h('div', { class: 'folds' }, ...(part === 'power'
    ? [openFold(fold('Beim Einschalten', 'power', slots.start, powerPrefCard())), energyFold, waterFold]
    : [openFold(fold('Brühgruppe', 'group', slots.bruehgruppe)), fold('Brühkessel', 'boiler', slots.bruehkessel),
      fold('Dampfkessel', 'cloud', slots.dampfkessel), fold('Pumpe & Bezugszeit', 'drop', slots.pumpe)])), savebar);

  async function loadMachine() {
    try {
      const { settings: s } = await api('/api/machine/settings');
      const classic = isClassic();
      const pages = classic && (s._pages || classicPages());
      const full = !classic || pages; // Eco, Hysterese, Timer usw. verfügbar
      const has = (k) => s[k] !== undefined && s[k] !== null;
      const slider = (label, key, min, max, step, unit, digits = 1) => (has(key) || !classic
        ? sliderRow({ label, min, max, step, value: s[key] ?? min, unit, digits, onInput: set(key) }) : null);
      const sel = (label, key, options, onChange) => {
        if (classic && !has(key)) return null;
        const select = h('select', { class: 'text' }, options.map(([v, t]) => h('option', { value: v, selected: Number(s[key]) === v }, t)));
        select.addEventListener('change', () => { set(key)(Number(select.value)); onChange?.(Number(select.value)); });
        return h('label', { class: 'field', style: { 'margin-top': '8px' } }, h('span', {}, label), select);
      };
      const group = (...nodes) => nodes.filter(Boolean);

      let flushRow = null;
      if (!classic) {
        flushRow = sliderRow({ label: 'Dauer der Aufheiz-Spülung', min: 1, max: 20, step: 1, value: Math.max(1, s.MA_HEATUP_FLUSH_DURATION || 1), unit: 's', digits: 0, onInput: set('MA_HEATUP_FLUSH_DURATION') });
        flushRow.hidden = Number(s.MA_FAST_HEATUP_TYPE) !== 1;
      }
      slots.start.replaceChildren(...group(
        sel('Beim Einschalten', 'MA_BOILER_START_MODE', [[1, 'Brühkessel AN & Dampfkessel AN'], [2, 'Brühkessel AN & Dampfkessel AUS']]),
        classic ? null : sel('Aufheiz-Spülung', 'MA_FAST_HEATUP_TYPE', [[0, 'Keine Spülung'], [1, 'Automatische Spülung']], (v) => { flushRow.hidden = v !== 1; }),
        flushRow,
        pages ? slider('Aufheizphase: automatischer Leerbezug', 'MA_HEATUP_FLUSH_DURATION', 0, 20, 1, 's', 0) : null,
        classic && !pages ? h('p', { class: 'muted small' }, 'Diese Firmware erlaubt über die API nur Temperatur und Dampfdruck. Weitere Werte stehen in der Original-Oberfläche.') : null));
      slots.energy.replaceChildren(...group(
        pages ? slider('Eco-Modus nach', 'MA_SET_TIMER_ECO_MA', 1, 240, 1, 'min', 0) : null,
        pages ? slider('Ausschalten nach', 'MA_SET_TIMER_POWERDOWN', 1, 240, 1, 'min', 0) : null));
      slots.water.replaceChildren(...group(
        pages ? sel('Wasserversorgung', 'MA_FIX_WATER_SUPPLY', [[0, 'Tank'], [1, 'Festwasseranschluss']]) : null,
        pages ? sel('Thermische Stabilität', 'MA_EXTENDED_THERMAL_STABILITY', [[0, 'normal'], [1, 'optimiert']]) : null));
      energyFold.hidden = !slots.energy.children.length;
      waterFold.hidden = !slots.water.children.length;
      slots.bruehgruppe.replaceChildren(...group(
        slider('Temperatur', 'BG_SET_TEMP', 60, 96, 0.1, '°C'),
        full ? slider('Eco-Temperatur', 'BG_SET_ECO_TEMP', 40, 95, 0.1, '°C') : null,
        full ? slider('Hysterese', 'BG_SET_TEMP_HYST', 2, 5, 0.1, 'K') : null));
      slots.bruehkessel.replaceChildren(...group(
        slider('Temperatur', 'BB_SET_TEMP', 60, 96, 0.1, '°C'),
        full ? slider('Eco-Temperatur', 'BB_SET_ECO_TEMP', 40, 95, 0.1, '°C') : null,
        full ? slider('Hysterese', 'BB_SET_TEMP_HYST', 2, 5, 0.1, 'K') : null));
      slots.dampfkessel.replaceChildren(...group(
        slider('Druck', 'SB_SET_PRESS', 0, 1.8, 0.1, 'bar'),
        full ? slider('Eco-Druck', 'SB_SET_ECO_PRESS', 0, 1, 0.1, 'bar') : null,
        full ? slider('Hysterese', 'SB_SET_PRESS_HYST', 0.1, 0.3, 0.1, 'bar') : null));
      slots.pumpe.replaceChildren(...group(
        pages ? slider('Bezugszeit Espresso (Standardbezug)', 'PU_SET_BREW_TIMER_1', 15, 60, 1, 's', 0) : null,
        pages ? h('p', { class: 'muted small' }, 'Wie lange die Pumpe beim Skript „Espresso“ läuft (z. B. auf einem Schalter).') : null,
        full ? slider('Max. Bezugszeit', 'PU_SET_MAX_TIMER', 30, 120, 1, 's', 0) : null,
        classic ? null : sel('Bezugszeit startet bei', 'MA_START_EXTRACTIONCOUNTER_EVENT', [[0, 'Pumpenstart'], [1, '1 bar Druck'], [2, 'Erster Tropfen in der Tasse']]),
        !full ? h('p', { class: 'muted small' }, 'Pumpenwerte sind bei dieser Firmware nur in der Original-Oberfläche einstellbar.') : null));
      if (!features.settings) {
        for (const el of Object.values(slots)) el.querySelectorAll('input,select').forEach((x) => { x.disabled = true; });
        first.append(h('p', { class: 'muted small' }, 'Ändern ist unter Einstellungen → Sicherheit → Funktionen ausgeschaltet.'));
      }
    } catch (e) {
      first.replaceChildren(h('div', { class: 'muted small' }, e.message));
    }
  }
  loadMachine();

  return () => savebar.remove();
};

// Wi-Fi (nur, wenn die Maschine ihre WLAN-Verbindung über die API meldet; die DBL tut es nicht) und Firmware mit
// Zählern, als einklappbare Bereiche. Inhalt wird einmal geladen.
export function deviceFolds() {
  const wifiBox = h('div', {}, h('div', { class: 'muted small' }, 'Lade …'));
  const wifiFold = fold('Wi-Fi', 'wifi', wifiBox);
  wifiFold.hidden = true;
  const fwBox = h('div', {}, h('div', { class: 'muted small' }, 'Lade …'));
  (async () => {
    try {
      const d = await api('/api/machine/details');
      const m = d.machine || {};
      const i = d.info || {};
      const n = d.network || {};
      const st = store.machine || {};
      const sig = Number(n.WIFI_SIGNAL_STRENGTH);
      const sigTxt = Number.isFinite(sig) ? `${sig} dBm (${sig > -55 ? 'sehr gut' : sig > -67 ? 'gut' : sig > -75 ? 'schwach' : 'sehr schwach'})` : '–';
      wifiFold.hidden = !n.WIFI_NAME && !Number.isFinite(sig);
      wifiBox.replaceChildren(h('dl', { class: 'kv' },
          h('dt', {}, 'Signal'), h('dd', {}, sigTxt),
          h('dt', {}, 'WLAN-Name'), h('dd', {}, n.WIFI_NAME || '–'),
          h('dt', {}, 'IP-Adresse'), h('dd', {}, n.WIFI_AP_IP || '–'),
          h('dt', {}, 'Verschlüsselung'), h('dd', {}, n.WIFI_ENCRYPTION || '–'),
          h('dt', {}, 'Eigener Access Point'), h('dd', {}, n.WIFI_SOFT_AP || '–'),
          h('dt', {}, 'Letzter Kontakt'), h('dd', {}, ago(st.lastSeen))));
      fwBox.replaceChildren(h('dl', { class: 'kv' },
        h('dt', {}, 'Modell'), h('dd', {}, st.info?.typeName || `Typ ${m.MA_TYPE}`),
        h('dt', {}, 'Firmware (Steuerung / WLAN)'), h('dd', {}, `${m.FW_VERSION_MAJOR}.${m.FW_VERSION_MINOR} / ${m.ESP_FW_MAJOR}.${m.ESP_FW_MINOR}`),
        h('dt', {}, 'Schnittstelle'), h('dd', {}, isClassic() ? (classicPages() ? 'alte API mit Seiten-API' : 'alte API') : 'Brew-by-Sync'),
        h('dt', {}, 'Seriennummer'), h('dd', {}, m.MA_SN || '–'),
        h('dt', {}, 'Bezüge gesamt'), h('dd', {}, fmtInt(m.MA_EXTRACTIONS)),
        h('dt', {}, 'Betriebsstunden'), h('dd', {}, fmtInt(m.MA_OPERATING_HOURS)),
        h('dt', {}, 'Energie gesamt'), h('dd', {}, `${fmt(m.MA_ENERGY_TOTAL_KWH, 2)} kWh`),
        h('dt', {}, 'Max. Strom'), h('dd', {}, `${fmtInt(m.MA_MAX_AMPERE)} A`),
        i.TZ_IND !== undefined ? h('dt', {}, 'Zeitzone (Index)') : null, i.TZ_IND !== undefined ? h('dd', {}, String(i.TZ_IND)) : null),
      h('p', { class: 'muted small' }, 'Firmware-Updates nur über die Original-Oberfläche der Maschine.'));
    } catch (e) {
      fwBox.replaceChildren(h('div', { class: 'muted small' }, e.message));
    }
  })();
  return [wifiFold, fold('Firmware', 'info', fwBox)];
}

// Waage: Zielgewicht der Standardbezüge (Skripte 7/8). Die DBL-Oberfläche kennt sie nur als feste Werte.
function scaleCard(features) {
  const box = h('div', {}, h('div', { class: 'muted small' }, 'Lade …'));
  (async () => {
    try {
      const sw = await api('/api/machine/switches');
      const classic = isClassic();
      const single = h('input', { class: 'text', type: 'number', min: 1, max: 199, step: 0.5, value: sw.singleDoseG ?? '' });
      const double = h('input', { class: 'text', type: 'number', min: 1, max: 199, step: 0.5, value: sw.doubleDoseG ?? '' });
      box.replaceChildren(
        h('p', { class: 'muted small' }, classic
          ? 'Die Xenia DBL hat keine eingebaute Waage. Gewicht und Fluss kommen von einer per Bluetooth verbundenen Waage (z. B. Bookoo), die in der Original-Oberfläche unter „Waage“ gekoppelt wird. Ohne Waage misst die Maschine die Menge in ml.'
          : 'Zielgewicht der Standardbezüge mit der internen Waage.'),
        h('div', { class: 'row' },
          h('label', { class: 'field grow' }, h('span', {}, classic ? 'Single (g bzw. ml)' : 'Einfache Dosis (g)'), single),
          h('label', { class: 'field grow' }, h('span', {}, classic ? 'Double (g bzw. ml)' : 'Doppelte Dosis (g)'), double)),
        h('div', { style: { height: '12px' } }),
        h('button', { class: 'btn filled wide', disabled: !features.settings, onclick: async () => {
          try {
            const r = await api('/api/machine/switches', { method: 'PUT', body: { singleDoseG: Number(single.value), doubleDoseG: Number(double.value) } });
            if (r.applied === false) {
              // Die Firmware hat die Werte nicht angenommen: zeigen, was wirklich gilt
              single.value = r.singleDoseG ?? single.value;
              double.value = r.doubleDoseG ?? double.value;
              snackbar('Die Maschine hat die Werte nicht übernommen – diese Firmware kennt nur die festen Mengen', { duration: 7000 });
            } else snackbar('Bezugsgewicht gespeichert');
          } catch (e) { snackbar(e.message); }
        } }, 'Speichern'),
        classic ? h('p', { class: 'muted small', style: { 'margin-top': '8px' } }, 'Gilt für die festen Abläufe „Single“ und „Double“. Die Original-Oberfläche der DBL bietet diese Einstellung nicht an; Xenios prüft nach dem Speichern, ob die Maschine die Werte übernommen hat.') : null);
    } catch (e) {
      box.replaceChildren(h('div', { class: 'muted small' }, e.message));
    }
  })();
  return box;
}

const prefRow = (ic, title, sub, sw) => h('div', { class: 'list-item' }, h('span', { class: 'lead' }, icon(ic)),
  h('div', { class: 'grow' }, h('div', { class: 'title' }, title), sub ? h('div', { class: 'sub' }, sub) : null), sw);

// Einschalten ohne Dampfkessel: gilt auf diesem Gerät für Startseite, Dashboard und den App-Shortcut „Ein“
function powerPrefCard() {
  return h('div', { class: 'list', style: { 'margin-top': '12px' } },
    prefRow('cloud', 'Ohne Dampf einschalten', '„Ein“ schaltet nur den Brühkessel ein (Startseite, Dashboard, Shortcut). Dampf lässt sich jederzeit dazuschalten.',
      switchEl({ checked: noSteamOn(), label: 'Ohne Dampf einschalten', onChange: (on) => setNoSteamOn(on) })));
}

// Tabs der unteren Leiste ein- und ausblenden (mindestens einer bleibt)
function navCard(unsubs) {
  const list = h('div', { class: 'list' });
  const paint = () => {
    const hidden = hiddenTabs();
    // „Einstellungen“ steht immer in der Leiste und taucht deshalb hier nicht auf
    const all = navChoices().filter((r) => !r.fixed);
    list.replaceChildren(all.map((r) => prefRow(r.icon, r.label, null, switchEl({ checked: !hidden.has(r.path), label: `${r.label} in der Leiste`, onChange: (on) => { setTabHidden(r.path, !on); paint(); } }))));
  };
  paint();
  unsubs.push(onPrefs((k) => { if (k === 'hiddenComponents' || k === 'features') paint(); }));
  return h('div', {}, h('p', { class: 'muted small' }, 'Welche Seiten in der Leiste stehen (gilt für dieses Gerät). Ausgeblendete Seiten bleiben über Links erreichbar; „Einstellungen“ steht immer in der Leiste.'), list);
}

// Komponenten ausblenden (gilt für dieses Gerät)
function componentsCard() {
  return h('div', {}, h('p', { class: 'muted small' }, 'Ausgeblendete Komponenten verschwinden aus Leiste, Startseite, Dashboard und Bezügen (gilt für dieses Gerät).'),
    // Mühle nur, wenn eine eingerichtet ist (Einstellungen → Mühle & Grind-by-Sync); sonst gibt es nichts auszublenden
    h('div', { class: 'list' }, COMPONENTS.filter((c) => c.id !== 'grinder' || store.server?.grinder?.enabled).map((c) => prefRow(c.id === 'grinder' ? 'grinder' : c.id === 'scale' ? 'scale' : 'check', c.title, c.sub,
      switchEl({ checked: !isHidden(c.id), label: `${c.title} anzeigen`, onChange: (on) => setComponentHidden(c.id, !on) })))));
}

// Bezüge unter einer Mindestdauer aussortieren (Backflush, Spülen, Fehlbezüge); gilt auf dem Server bzw. in der App
function shotFilterCard() {
  const box = h('div', {}, h('div', { class: 'muted small' }, 'Lade …'));
  (async () => {
    try {
      const st = await api('/api/shots/settings');
      let value = st.minShotS;
      let dose = st.defaultDoseG ?? null;
      const save = h('button', { class: 'btn filled wide', disabled: true, onclick: async () => {
        save.disabled = true;
        try {
          const r = await api('/api/shots/settings', { method: 'PUT', body: { minShotS: value, defaultDoseG: dose } });
          value = r.minShotS;
          dose = r.defaultDoseG;
          snackbar('Aufzeichnung gespeichert');
        } catch (e) {
          snackbar(e.message);
          save.disabled = false;
        }
      } }, 'Speichern');
      const doseInput = h('input', { type: 'number', class: 'text', min: 3, max: 40, step: 0.1, inputmode: 'decimal', placeholder: 'keine', value: dose ?? '', 'aria-label': 'Standard-Dosis in Gramm',
        oninput: () => { const v = doseInput.value.trim().replace(',', '.'); dose = v === '' ? null : Number(v); save.disabled = false; } });
      box.replaceChildren(
        h('h3', {}, 'Kurze Bezüge aussortieren'),
        h('p', { class: 'muted small' }, `Pumpvorgänge kürzer als die Mindestdauer (Backflush, Spülen, Fehler) werden nicht protokolliert und nicht gelistet. Bewertete Bezüge bleiben sichtbar. Standard: ${st.defaultMinShotS} s.`),
        sliderRow({ label: 'Mindestdauer', min: st.limits.min, max: st.limits.max, step: 1, value, unit: 's', digits: 0, onInput: (v) => { value = v; save.disabled = false; } }),
        h('h3', { style: { 'margin-top': '16px' } }, 'Standard-Dosis'),
        h('p', { class: 'muted small' }, 'Die Waage misst nur die Ausbeute in der Tasse. Ohne angebundene Mühle gilt diese Dosis für neue Bezüge, damit das Verhältnis berechnet wird. Am einzelnen Bezug lässt sie sich überschreiben. Leer = keine.'),
        h('label', { class: 'field' }, h('span', {}, 'Dosis (g)'), doseInput), // Beschriftung über dem Feld wie überall
        h('div', { style: { height: '12px' } }), // Abstand zum Speichern-Knopf wie bei den übrigen Formularen
        save);
    } catch (e) {
      box.replaceChildren(h('div', { class: 'muted small' }, e.message));
    }
  })();
  return box;
}

function themeCard() {
  const box = h('div', { class: 'card' });
  const paint = () => {
    const theme = localStorageGet('theme') || 'system';
    const style = uiPalette();
    const chips = (current, list, onPick) => h('div', { class: 'chips' }, list.map(([v, label]) =>
      h('button', { class: 'chip', 'aria-pressed': String(current === v), onclick: () => { onPick(v); applyTheme(); paint(); } }, label)));
    const color = (key, label, fallback) => {
      const value = localStorageGet(key) || fallback;
      const input = h('input', { type: 'color', value, 'aria-label': label });
      input.addEventListener('input', () => { localStorageSet(key, input.value); applyTheme(); });
      return h('div', { class: 'color-row' }, input, h('span', { class: 'grow' }, label),
        localStorageGet(key) ? h('button', { class: 'btn text', onclick: () => { try { localStorage.removeItem(key); } catch { /* privat */ } applyTheme(); paint(); } }, 'Standard') : null);
    };
    box.replaceChildren(
      h('div', { class: 'muted small' }, 'Design'),
      chips(style, [['material', 'Material'], ['xenia', 'Xenia']], (v) => localStorageSet('uiStyle', v)),
      h('div', { class: 'muted small', style: { 'margin-top': '12px' } }, 'Helligkeit'),
      chips(theme, [['system', 'System'], ['light', 'Hell'], ['dark', 'Dunkel']], (v) => localStorageSet('theme', v)),
      h('div', { class: 'muted small', style: { 'margin-top': '12px' } }, 'Manometer (Temperatur und Druck)'),
      // gleiche Reihenfolge in beiden Vorlagen: automatisch, hell, dunkel
      chips(gaugeChoice(style) || 'auto', [['auto', 'Wie Helligkeit'], ['white', 'Hell'], ['black', 'Dunkel']],
        (v) => { if (v === 'auto') { try { localStorage.removeItem(gaugeKey(style)); } catch { /* privat */ } } else localStorageSet(gaugeKey(style), v); }),
      h('div', { class: 'muted small', style: { 'margin-top': '12px' } }, 'Farben (gilt für dieses Gerät)'),
      color('accent', 'Akzent (Schaltflächen, Regler, Anzeigen)', THEME_DEFAULTS.accent[style]),
      color('activeColor', 'Aktiv (gewählter Zustand, z. B. „Ein“)', THEME_DEFAULTS.active[style]));
  };
  paint();
  return box;
}

// --- Push-Benachrichtigungen -------------------------------------------------------------
function b64ToBytes(b64) {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export async function paintPush(box) {
  const push = store.server?.push;
  if (inAndroidApp()) {
    box.replaceChildren(h('div', { class: 'muted' }, 'In der Android-App gibt es noch keine Push-Benachrichtigungen. Dafür vorerst die Web-App in Chrome nutzen. Der Status ist über das Widget und die Schnelleinstellungs-Kachel sichtbar.'));
    return;
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    box.replaceChildren(h('div', { class: 'muted' }, 'Dieser Browser unterstützt keine Push-Benachrichtigungen. Tipp: App über Chrome „Zum Startbildschirm hinzufügen“ und per HTTPS (Cloudflare) öffnen.'));
    return;
  }
  if (!push?.enabled) {
    box.replaceChildren(h('div', { class: 'muted' }, 'Push ist auf dem Server nicht eingerichtet (npm run setup).'));
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  let prefs = null;
  if (sub) {
    try { prefs = (await api('/api/push/prefs', { method: 'POST', body: { endpoint: sub.endpoint } })).prefs; } catch { /* egal */ }
    if (!prefs) {
      // Abo im Browser, aber nicht auf dem Server → neu anmelden
      try { await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), prefs: {} } }); prefs = {}; } catch { /* egal */ }
    }
  }
  const topics = push.topics || {};
  const enabled = Boolean(sub);
  const toggle = switchEl({ checked: enabled, label: 'Benachrichtigungen auf diesem Gerät', onChange: async (on, input) => {
    input.disabled = true;
    try {
      if (on) {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') throw new Error('Benachrichtigungen wurden im Browser nicht erlaubt');
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(push.publicKey) });
        await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), prefs: {} } });
        snackbar('Benachrichtigungen aktiviert');
      } else if (sub) {
        await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
        await sub.unsubscribe();
        sub = null;
        snackbar('Benachrichtigungen deaktiviert');
      }
    } catch (e) {
      input.checked = !on;
      snackbar(e.message);
    } finally {
      input.disabled = false;
      paintPush(box);
    }
  } });
  const rows = enabled ? Object.entries(topics).map(([k, label]) => h('div', { class: 'row', style: { padding: '4px 0' } }, h('span', { class: 'grow' }, label), switchEl({ checked: prefs?.[k] !== false, label, onChange: async (on) => {
    prefs = { ...(prefs || {}), [k]: on };
    try { await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), prefs } }); } catch (e) { snackbar(e.message); }
  } }))) : [];
  box.replaceChildren(
    h('div', { class: 'row' }, icon('bell'), h('div', { class: 'grow' }, h('div', {}, 'Auf diesem Gerät'), h('div', { class: 'small muted' }, enabled ? 'Aktiv' : Notification.permission === 'denied' ? 'Im Browser blockiert' : 'Aus')), toggle),
    enabled ? h('div', { style: { 'margin-top': '8px' } }, ...rows) : null,
    enabled ? h('button', { class: 'btn text', onclick: async () => {
      try { await api('/api/push/test', { method: 'POST', body: { endpoint: sub.endpoint } }); snackbar('Test gesendet'); } catch (e) { snackbar(e.message); }
    } }, 'Test senden') : null);
}
