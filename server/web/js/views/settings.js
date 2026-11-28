// Einstellungen: die Hauptseite ist nur eine Übersicht in drei Gruppen (App, Espressomaschine, Server); jeder Eintrag
// öffnet eine eigene Seite. Seiten mit Werten des Servers stehen in views/server.js.
import { h, icon, fmt, fmtInt, snackbar, switchEl, sliderRow, ago } from '../ui.js';
import { api, store, isClassic, classicPages } from '../api.js';
import { logout, applyTheme, localStorageGet, localStorageSet, inAndroidApp, navigate, navChoices, THEME_DEFAULTS, uiPalette, gaugeKey, gaugeChoice } from '../app.js';
import { hiddenTabs, setTabHidden, COMPONENTS, isHidden, setComponentHidden, noSteamOn, setNoSteamOn, onPrefs } from '../prefs.js';
import { t } from '../../shared/i18n.js';

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
    ...group(t('settings.overview.groupApp'),
      listButton('palette', t('settings.overview.appearance'), t('settings.overview.appearanceSub'), go('/einstellungen/darstellung')),
      listButton('toggle', t('settings.overview.view'), t('settings.overview.viewSub'), go('/einstellungen/ansicht')),
      widgetAlarmButton(unsubs),
      appUpdateItem(unsubs),
      direct && android ? listButton('wifi', t('settings.overview.appConnection'), t('settings.overview.appConnectionSub'), () => window.XeniaApp.reauth()) : null),
    // Nach Aufgaben, häufig Genutztes oben; jede Seite mit einklappbaren Bereichen, der meistgenutzte aufgeklappt
    ...group(t('settings.overview.groupMachine'),
      listButton('thermo', t('settings.overview.temperatures'), t('settings.overview.temperaturesSub'), go('/einstellungen/temperaturen')),
      listButton('shotlog', t('settings.overview.shots'), isHidden('scale') ? t('settings.overview.shotsSub') : t('settings.overview.shotsSubScale'), go('/einstellungen/bezuege')),
      listButton('power', t('settings.overview.power'), t('settings.overview.powerSub'), go('/einstellungen/einschalten')),
      direct ? null : listButton('grinder', t('settings.overview.grinder'), store.server?.grinder?.enabled ? t('settings.overview.grinderSubOn') : t('settings.overview.grinderSubOff'), go('/einstellungen/muehle')),
      direct ? listButton('info', t('settings.overview.firmware'), t('settings.overview.firmwareSub'), go('/einstellungen/firmware'))
        : listButton('coffeeLine', t('settings.overview.model'), t('settings.overview.modelSub'), go('/einstellungen/modell'))),
    ...(direct ? [] : group(t('settings.overview.groupServer'),
      listButton('cloud', t('settings.overview.remote'), t('settings.overview.remoteSub'), go('/einstellungen/unterwegs')),
      listButton('bell', t('settings.overview.notifications'), t('settings.overview.notificationsSub'), go('/einstellungen/benachrichtigungen')),
      listButton('shield', t('settings.overview.security'), t('settings.overview.securitySub'), go('/einstellungen/sicherheit')),
      listButton('info', t('settings.overview.system'), t('settings.overview.systemSub'), go('/einstellungen/system')))),
    ...(direct ? [] : group(t('settings.overview.groupAccount'),
      android ? listButton('wifi', t('settings.overview.appConnectionChange'), t('settings.overview.appConnectionSub'), () => window.XeniaApp.reauth()) : null,
      listButton('logout', t('settings.overview.logout'), null, logout))),
    direct ? h('div', { class: 'card low muted small', style: { 'margin-top': '12px' } }, t('settings.overview.directMode')) : null,
    h('p', { class: 'muted small', style: { 'text-align': 'center', 'margin-top': '24px' } }, t('settings.overview.version', { version: store.server?.version || '' })));
  return () => unsubs.forEach((u) => u());
}

// --- Unterseiten der App ---------------------------------------------------------------------------------------
export function appearanceView(root) {
  root.append(themeCard());
}

export function viewPrefsView(root) {
  const unsubs = [];
  root.append(
    h('div', { class: 'section-title' }, t('settings.view.bar')), navCard(unsubs),
    h('div', { class: 'section-title' }, t('settings.view.components')), componentsCard());
  return () => unsubs.forEach((u) => u());
}

// Bezüge & Waage: Aufzeichnung (gilt auf dem Server bzw. im Direkt-Modus in der App) und Zielgewicht der Waage
export function shotPrefsView(root) {
  const features = store.server?.features || {};
  root.append(h('div', { class: 'folds' },
    openFold(fold(t('settings.machine.foldShots'), 'shotlog', shotFilterCard())),
    isHidden('scale') ? null : fold(t('settings.machine.foldScale'), 'scale', scaleCard(features))));
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
    sub.textContent = ok ? t('settings.widgets.granted')
      : t('settings.widgets.slow');
  };
  paint();
  // nach der Rückkehr aus den Android-Einstellungen neu prüfen
  window.addEventListener('xenios-exact-alarms', paint);
  unsubs.push(() => window.removeEventListener('xenios-exact-alarms', paint));
  return h('button', { class: 'list-item clickable as-button', onclick: () => { try { window.XeniaApp.requestExactAlarms(); } catch { /* ältere App */ } } },
    h('span', { class: 'lead' }, icon('timer')),
    h('span', { class: 'grow' }, h('div', { class: 'title' }, t('settings.widgets.title')), sub),
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
    h('span', { class: 'grow' }, h('div', { class: 'title' }, t('settings.appUpdate.title')), sub),
    btn);
  const paint = () => {
    let s;
    try { s = JSON.parse(window.XeniaApp.appUpdate()); } catch { item.hidden = true; return; }
    const self = s.selfInstall !== false; // Apps vor den zwei Varianten kennen das Feld nicht und installieren selbst
    const lines = s.phase === 'checking' ? [t('settings.appUpdate.checking')]
      : s.phase === 'downloading' ? [t('settings.appUpdate.downloading', { version: s.latest, progress: s.progress })]
      : s.phase === 'installing' ? [t('settings.appUpdate.installing')]
      : [
        t('settings.appUpdate.installed', { version: s.installed }) + (s.available ? t('settings.appUpdate.newer', { version: s.latest }) : s.checkedAt ? t('settings.appUpdate.current') : ''),
        s.error || (s.available && !self ? t('settings.appUpdate.noUpdater')
          : s.available && !s.allowed ? t('settings.appUpdate.allowUnknown') : null),
        !s.error && !s.available && s.checkedAt ? t('settings.appUpdate.checked', { ago: ago(new Date(s.checkedAt).toISOString()) }) : null,
      ];
    sub.replaceChildren(...lines.filter(Boolean).flatMap((x, i) => (i ? [h('br'), x] : [x])));
    btn.disabled = Boolean(s.phase);
    btn.textContent = !s.available ? t('settings.appUpdate.check') : self ? t('settings.appUpdate.install') : t('settings.appUpdate.download');
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
  const saveBtn = h('button', { class: 'btn filled', onclick: save }, icon('check', 's18'), t('common.save'));
  const savebar = h('div', { class: 'savebar', hidden: true, role: 'region', 'aria-label': t('settings.machine.unsaved') },
    h('span', { class: 'savebar-text' }, t('settings.machine.changed')),
    h('button', { class: 'btn text', onclick: () => { for (const k of Object.keys(changes)) delete changes[k]; savebar.hidden = true; loadMachine(); } }, t('settings.machine.discard')),
    saveBtn);
  const set = (k) => (v) => { changes[k] = v; savebar.hidden = false; };
  async function save() {
    saveBtn.disabled = true;
    try {
      await api('/api/machine/settings', { method: 'POST', body: { changes } });
      for (const k of Object.keys(changes)) delete changes[k];
      savebar.hidden = true;
      snackbar(t('settings.machine.saved'));
    } catch (e) {
      snackbar(e.message);
    } finally {
      saveBtn.disabled = false;
    }
  }

  const slots = { start: h('div'), energy: h('div'), water: h('div'), bruehgruppe: h('div'), bruehkessel: h('div'), dampfkessel: h('div'), pumpe: h('div') };
  const first = part === 'power' ? slots.start : slots.bruehgruppe;
  first.append(h('div', { class: 'muted small' }, t('settings.machine.loadingSettings')));
  // Energiesparen und Wasser & Stabilität nur, wenn die Maschine diese Werte über die API anbietet
  const energyFold = fold(t('settings.machine.foldEnergy'), 'eco', slots.energy);
  const waterFold = fold(t('settings.machine.foldWater'), 'drop', slots.water);
  energyFold.hidden = true;
  waterFold.hidden = true;
  root.append(h('div', { class: 'folds' }, ...(part === 'power'
    ? [openFold(fold(t('settings.machine.foldStart'), 'power', slots.start, powerPrefCard())), energyFold, waterFold]
    : [openFold(fold(t('settings.machine.foldGroup'), 'group', slots.bruehgruppe)), fold(t('settings.machine.foldBrewBoiler'), 'boiler', slots.bruehkessel),
      fold(t('settings.machine.foldSteamBoiler'), 'cloud', slots.dampfkessel), fold(t('settings.machine.foldPump'), 'drop', slots.pumpe)])), savebar);

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
        const select = h('select', { class: 'text' }, options.map(([v, txt]) => h('option', { value: v, selected: Number(s[key]) === v }, txt)));
        select.addEventListener('change', () => { set(key)(Number(select.value)); onChange?.(Number(select.value)); });
        return h('label', { class: 'field', style: { 'margin-top': '8px' } }, h('span', {}, label), select);
      };
      const group = (...nodes) => nodes.filter(Boolean);

      let flushRow = null;
      if (!classic) {
        flushRow = sliderRow({ label: t('settings.machine.flushDuration'), min: 1, max: 20, step: 1, value: Math.max(1, s.MA_HEATUP_FLUSH_DURATION || 1), unit: 's', digits: 0, onInput: set('MA_HEATUP_FLUSH_DURATION') });
        flushRow.hidden = Number(s.MA_FAST_HEATUP_TYPE) !== 1;
      }
      slots.start.replaceChildren(...group(
        sel(t('settings.machine.startMode'), 'MA_BOILER_START_MODE', [[1, t('settings.machine.startBothOn')], [2, t('settings.machine.startSteamOff')]]),
        classic ? null : sel(t('settings.machine.heatupFlush'), 'MA_FAST_HEATUP_TYPE', [[0, t('settings.machine.noFlush')], [1, t('settings.machine.autoFlush')]], (v) => { flushRow.hidden = v !== 1; }),
        flushRow,
        pages ? slider(t('settings.machine.heatupFlushClassic'), 'MA_HEATUP_FLUSH_DURATION', 0, 20, 1, 's', 0) : null,
        classic && !pages ? h('p', { class: 'muted small' }, t('settings.machine.classicLimited')) : null));
      slots.energy.replaceChildren(...group(
        pages ? slider(t('settings.machine.ecoAfter'), 'MA_SET_TIMER_ECO_MA', 1, 240, 1, 'min', 0) : null,
        pages ? slider(t('settings.machine.powerdownAfter'), 'MA_SET_TIMER_POWERDOWN', 1, 240, 1, 'min', 0) : null));
      slots.water.replaceChildren(...group(
        pages ? sel(t('settings.machine.waterSupply'), 'MA_FIX_WATER_SUPPLY', [[0, t('settings.machine.waterTank')], [1, t('settings.machine.waterFixed')]]) : null,
        pages ? sel(t('settings.machine.thermalStability'), 'MA_EXTENDED_THERMAL_STABILITY', [[0, t('settings.machine.thermalNormal')], [1, t('settings.machine.thermalOptimized')]]) : null));
      energyFold.hidden = !slots.energy.children.length;
      waterFold.hidden = !slots.water.children.length;
      slots.bruehgruppe.replaceChildren(...group(
        slider(t('settings.machine.temperature'), 'BG_SET_TEMP', 60, 96, 0.1, '°C'),
        full ? slider(t('settings.machine.ecoTemperature'), 'BG_SET_ECO_TEMP', 40, 95, 0.1, '°C') : null,
        full ? slider(t('settings.machine.hysteresis'), 'BG_SET_TEMP_HYST', 2, 5, 0.1, 'K') : null));
      slots.bruehkessel.replaceChildren(...group(
        slider(t('settings.machine.temperature'), 'BB_SET_TEMP', 60, 96, 0.1, '°C'),
        full ? slider(t('settings.machine.ecoTemperature'), 'BB_SET_ECO_TEMP', 40, 95, 0.1, '°C') : null,
        full ? slider(t('settings.machine.hysteresis'), 'BB_SET_TEMP_HYST', 2, 5, 0.1, 'K') : null));
      slots.dampfkessel.replaceChildren(...group(
        slider(t('settings.machine.pressure'), 'SB_SET_PRESS', 0, 1.8, 0.1, 'bar'),
        full ? slider(t('settings.machine.ecoPressure'), 'SB_SET_ECO_PRESS', 0, 1, 0.1, 'bar') : null,
        full ? slider(t('settings.machine.hysteresis'), 'SB_SET_PRESS_HYST', 0.1, 0.3, 0.1, 'bar') : null));
      slots.pumpe.replaceChildren(...group(
        pages ? slider(t('settings.machine.brewTime1'), 'PU_SET_BREW_TIMER_1', 15, 60, 1, 's', 0) : null,
        pages ? h('p', { class: 'muted small' }, t('settings.machine.brewTime1Hint')) : null,
        full ? slider(t('settings.machine.maxBrewTime'), 'PU_SET_MAX_TIMER', 30, 120, 1, 's', 0) : null,
        classic ? null : sel(t('settings.machine.counterStart'), 'MA_START_EXTRACTIONCOUNTER_EVENT', [[0, t('settings.machine.counterPump')], [1, t('settings.machine.counterBar')], [2, t('settings.machine.counterDrop')]]),
        !full ? h('p', { class: 'muted small' }, t('settings.machine.pumpOriginalOnly')) : null));
      if (!features.settings) {
        for (const el of Object.values(slots)) el.querySelectorAll('input,select').forEach((x) => { x.disabled = true; });
        first.append(h('p', { class: 'muted small' }, t('settings.machine.settingsOff')));
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
  const wifiBox = h('div', {}, h('div', { class: 'muted small' }, t('settings.machine.loading')));
  const wifiFold = fold(t('settings.machine.foldWifi'), 'wifi', wifiBox);
  wifiFold.hidden = true;
  const fwBox = h('div', {}, h('div', { class: 'muted small' }, t('settings.machine.loading')));
  (async () => {
    try {
      const d = await api('/api/machine/details');
      const m = d.machine || {};
      const i = d.info || {};
      const n = d.network || {};
      const st = store.machine || {};
      const sig = Number(n.WIFI_SIGNAL_STRENGTH);
      const sigTxt = Number.isFinite(sig) ? t('settings.machine.signalText', { dbm: sig, quality: sig > -55 ? t('settings.machine.signalVeryGood') : sig > -67 ? t('settings.machine.signalGood') : sig > -75 ? t('settings.machine.signalWeak') : t('settings.machine.signalVeryWeak') }) : '–';
      wifiFold.hidden = !n.WIFI_NAME && !Number.isFinite(sig);
      wifiBox.replaceChildren(h('dl', { class: 'kv' },
          h('dt', {}, t('settings.machine.signal')), h('dd', {}, sigTxt),
          h('dt', {}, t('settings.machine.wifiName')), h('dd', {}, n.WIFI_NAME || '–'),
          h('dt', {}, t('settings.machine.ipAddress')), h('dd', {}, n.WIFI_AP_IP || '–'),
          h('dt', {}, t('settings.machine.encryption')), h('dd', {}, n.WIFI_ENCRYPTION || '–'),
          h('dt', {}, t('settings.machine.softAp')), h('dd', {}, n.WIFI_SOFT_AP || '–'),
          h('dt', {}, t('settings.machine.lastContact')), h('dd', {}, ago(st.lastSeen))));
      fwBox.replaceChildren(h('dl', { class: 'kv' },
        h('dt', {}, t('settings.machine.model')), h('dd', {}, st.info?.typeName || t('settings.machine.typeN', { type: m.MA_TYPE })),
        h('dt', {}, t('settings.machine.firmware')), h('dd', {}, `${m.FW_VERSION_MAJOR}.${m.FW_VERSION_MINOR} / ${m.ESP_FW_MAJOR}.${m.ESP_FW_MINOR}`),
        h('dt', {}, t('settings.machine.interface')), h('dd', {}, isClassic() ? (classicPages() ? t('settings.machine.apiClassicPages') : t('settings.machine.apiClassic')) : 'Brew-by-Sync'),
        h('dt', {}, t('settings.machine.serial')), h('dd', {}, m.MA_SN || '–'),
        h('dt', {}, t('settings.machine.extractions')), h('dd', {}, fmtInt(m.MA_EXTRACTIONS)),
        h('dt', {}, t('settings.machine.operatingHours')), h('dd', {}, fmtInt(m.MA_OPERATING_HOURS)),
        h('dt', {}, t('settings.machine.energyTotal')), h('dd', {}, `${fmt(m.MA_ENERGY_TOTAL_KWH, 2)} kWh`),
        h('dt', {}, t('settings.machine.maxCurrent')), h('dd', {}, `${fmtInt(m.MA_MAX_AMPERE)} A`),
        i.TZ_IND !== undefined ? h('dt', {}, t('settings.machine.timezoneIndex')) : null, i.TZ_IND !== undefined ? h('dd', {}, String(i.TZ_IND)) : null),
      h('p', { class: 'muted small' }, t('settings.machine.firmwareHint')));
    } catch (e) {
      fwBox.replaceChildren(h('div', { class: 'muted small' }, e.message));
    }
  })();
  return [wifiFold, fold(t('settings.machine.foldFirmware'), 'info', fwBox)];
}

// Waage: Zielgewicht der Standardbezüge (Skripte 7/8). Die DBL-Oberfläche kennt sie nur als feste Werte.
function scaleCard(features) {
  const box = h('div', {}, h('div', { class: 'muted small' }, t('settings.machine.loading')));
  (async () => {
    try {
      const sw = await api('/api/machine/switches');
      const classic = isClassic();
      const single = h('input', { class: 'text', type: 'number', min: 1, max: 199, step: 0.5, value: sw.singleDoseG ?? '' });
      const double = h('input', { class: 'text', type: 'number', min: 1, max: 199, step: 0.5, value: sw.doubleDoseG ?? '' });
      box.replaceChildren(
        h('p', { class: 'muted small' }, classic
          ? t('settings.scale.classicHint')
          : t('settings.scale.hint')),
        h('div', { class: 'row' },
          h('label', { class: 'field grow' }, h('span', {}, classic ? t('settings.scale.singleClassic') : t('settings.scale.single')), single),
          h('label', { class: 'field grow' }, h('span', {}, classic ? t('settings.scale.doubleClassic') : t('settings.scale.double')), double)),
        h('div', { style: { height: '12px' } }),
        h('button', { class: 'btn filled wide', disabled: !features.settings, onclick: async () => {
          try {
            const r = await api('/api/machine/switches', { method: 'PUT', body: { singleDoseG: Number(single.value), doubleDoseG: Number(double.value) } });
            if (r.applied === false) {
              // Die Firmware hat die Werte nicht angenommen: zeigen, was wirklich gilt
              single.value = r.singleDoseG ?? single.value;
              double.value = r.doubleDoseG ?? double.value;
              snackbar(t('settings.scale.notApplied'), { duration: 7000 });
            } else snackbar(t('settings.scale.saved'));
          } catch (e) { snackbar(e.message); }
        } }, t('common.save')),
        classic ? h('p', { class: 'muted small', style: { 'margin-top': '8px' } }, t('settings.scale.classicNote')) : null);
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
    prefRow('cloud', t('settings.power.noSteam'), t('settings.power.noSteamSub'),
      switchEl({ checked: noSteamOn(), label: t('settings.power.noSteam'), onChange: (on) => setNoSteamOn(on) })));
}

// Tabs der unteren Leiste ein- und ausblenden (mindestens einer bleibt)
function navCard(unsubs) {
  const list = h('div', { class: 'list' });
  const paint = () => {
    const hidden = hiddenTabs();
    // „Einstellungen“ steht immer in der Leiste und taucht deshalb hier nicht auf
    const all = navChoices().filter((r) => !r.fixed);
    list.replaceChildren(all.map((r) => prefRow(r.icon, r.label, null, switchEl({ checked: !hidden.has(r.path), label: t('settings.view.tabInBar', { label: r.label }), onChange: (on) => { setTabHidden(r.path, !on); paint(); } }))));
  };
  paint();
  unsubs.push(onPrefs((k) => { if (k === 'hiddenComponents' || k === 'features') paint(); }));
  return h('div', {}, h('p', { class: 'muted small' }, t('settings.view.barHint')), list);
}

// Komponenten ausblenden (gilt für dieses Gerät)
function componentsCard() {
  return h('div', {}, h('p', { class: 'muted small' }, t('settings.view.componentsHint')),
    // Mühle nur, wenn eine eingerichtet ist (Einstellungen → Mühle & Grind-by-Sync); sonst gibt es nichts auszublenden
    h('div', { class: 'list' }, COMPONENTS.filter((c) => c.id !== 'grinder' || store.server?.grinder?.enabled).map((c) => prefRow(c.id === 'grinder' ? 'grinder' : c.id === 'scale' ? 'scale' : 'check', c.title, c.sub,
      switchEl({ checked: !isHidden(c.id), label: t('settings.view.showComponent', { title: c.title }), onChange: (on) => setComponentHidden(c.id, !on) })))));
}

// Bezüge unter einer Mindestdauer aussortieren (Backflush, Spülen, Fehlbezüge); gilt auf dem Server bzw. in der App
function shotFilterCard() {
  const box = h('div', {}, h('div', { class: 'muted small' }, t('settings.machine.loading')));
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
          snackbar(t('settings.shots.saved'));
        } catch (e) {
          snackbar(e.message);
          save.disabled = false;
        }
      } }, t('common.save'));
      const doseInput = h('input', { type: 'number', class: 'text', min: 3, max: 40, step: 0.1, inputmode: 'decimal', placeholder: t('settings.shots.dosePlaceholder'), value: dose ?? '', 'aria-label': t('settings.shots.doseAria'),
        oninput: () => { const v = doseInput.value.trim().replace(',', '.'); dose = v === '' ? null : Number(v); save.disabled = false; } });
      box.replaceChildren(
        h('h3', {}, t('settings.shots.filterTitle')),
        h('p', { class: 'muted small' }, t('settings.shots.filterHint', { n: st.defaultMinShotS })),
        sliderRow({ label: t('settings.shots.minDuration'), min: st.limits.min, max: st.limits.max, step: 1, value, unit: 's', digits: 0, onInput: (v) => { value = v; save.disabled = false; } }),
        h('h3', { style: { 'margin-top': '16px' } }, t('settings.shots.doseTitle')),
        h('p', { class: 'muted small' }, t('settings.shots.doseHint')),
        h('label', { class: 'field' }, h('span', {}, t('settings.shots.dose')), doseInput), // Beschriftung über dem Feld wie überall
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
        localStorageGet(key) ? h('button', { class: 'btn text', onclick: () => { try { localStorage.removeItem(key); } catch { /* privat */ } applyTheme(); paint(); } }, t('settings.theme.reset')) : null);
    };
    box.replaceChildren(
      h('div', { class: 'muted small' }, t('settings.theme.design')),
      chips(style, [['material', 'Material'], ['xenia', 'Xenia']], (v) => localStorageSet('uiStyle', v)),
      h('div', { class: 'muted small', style: { 'margin-top': '12px' } }, t('settings.theme.brightness')),
      chips(theme, [['system', t('settings.theme.system')], ['light', t('settings.theme.light')], ['dark', t('settings.theme.dark')]], (v) => localStorageSet('theme', v)),
      h('div', { class: 'muted small', style: { 'margin-top': '12px' } }, t('settings.theme.gauge')),
      // gleiche Reihenfolge in beiden Vorlagen: automatisch, hell, dunkel
      chips(gaugeChoice(style) || 'auto', [['auto', t('settings.theme.gaugeAuto')], ['white', t('settings.theme.light')], ['black', t('settings.theme.dark')]],
        (v) => { if (v === 'auto') { try { localStorage.removeItem(gaugeKey(style)); } catch { /* privat */ } } else localStorageSet(gaugeKey(style), v); }),
      h('div', { class: 'muted small', style: { 'margin-top': '12px' } }, t('settings.theme.colors')),
      color('accent', t('settings.theme.accent'), THEME_DEFAULTS.accent[style]),
      color('activeColor', t('settings.theme.active'), THEME_DEFAULTS.active[style]));
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
    box.replaceChildren(h('div', { class: 'muted' }, t('settings.push.android')));
    return;
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    box.replaceChildren(h('div', { class: 'muted' }, t('settings.push.unsupported')));
    return;
  }
  if (!push?.enabled) {
    box.replaceChildren(h('div', { class: 'muted' }, t('settings.push.notConfigured')));
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
  const toggle = switchEl({ checked: enabled, label: t('settings.push.toggle'), onChange: async (on, input) => {
    input.disabled = true;
    try {
      if (on) {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') throw new Error(t('settings.push.notAllowed'));
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(push.publicKey) });
        await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), prefs: {} } });
        snackbar(t('settings.push.enabled'));
      } else if (sub) {
        await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
        await sub.unsubscribe();
        sub = null;
        snackbar(t('settings.push.disabled'));
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
    h('div', { class: 'row' }, icon('bell'), h('div', { class: 'grow' }, h('div', {}, t('settings.push.thisDevice')), h('div', { class: 'small muted' }, enabled ? t('settings.push.active') : Notification.permission === 'denied' ? t('settings.push.blocked') : t('settings.push.off'))), toggle),
    enabled ? h('div', { style: { 'margin-top': '8px' } }, ...rows) : null,
    enabled ? h('button', { class: 'btn text', onclick: async () => {
      try { await api('/api/push/test', { method: 'POST', body: { endpoint: sub.endpoint } }); snackbar(t('settings.push.testSent')); } catch (e) { snackbar(e.message); }
    } }, t('settings.push.sendTest')) : null);
}
