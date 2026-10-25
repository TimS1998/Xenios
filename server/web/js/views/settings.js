// Einstellungen: Maschinenwerte, Benachrichtigungen, Infos, Darstellung, Konto.
import { h, icon, fmt, fmtInt, snackbar, switchEl, sliderRow, ago } from '../ui.js';
import { api, store, isClassic } from '../api.js';
import { logout, applyTheme, localStorageGet, localStorageSet, inAndroidApp, navigate } from '../app.js';

const listButton = (ic, title, sub, onclick) => h('button', { class: 'list-item clickable as-button', onclick },
  h('span', { class: 'lead' }, icon(ic)),
  h('span', { class: 'grow' }, h('div', { class: 'title' }, title), sub ? h('div', { class: 'sub' }, sub) : null),
  icon('right', 's20 muted'));

export function settingsView(root) {
  const features = store.server?.features || {};
  const direct = store.server?.mode === 'direct';
  const machineBox = h('div', {}, h('div', { class: 'empty' }, 'Lade Einstellungen …'));
  const pushBox = h('div', { class: 'card' });
  const infoBox = h('div', { class: 'card low' }, h('div', { class: 'muted' }, 'Lade …'));

  root.append(
    h('div', { class: 'section-title' }, 'Maschine'),
    machineBox,
    h('div', { class: 'section-title' }, 'Benachrichtigungen'),
    pushBox,
    h('div', { class: 'section-title' }, 'Darstellung'),
    themeCard(),
    h('div', { class: 'section-title' }, 'Info'),
    infoBox,
    h('div', { class: 'section-title' }, 'Konto & Server'),
    direct ? h('div', { class: 'card low muted small' }, 'Direkt-Modus: Die App spricht Maschine und Mühle ohne Server im Heimnetz an. Eine Anmeldung gibt es dabei nicht. Wechsel des Modus unter „App-Verbindung“.') : null,
    h('div', { class: 'list' },
      direct ? null : listButton('shield', 'Server & Sicherheit', 'Geräte-Adressen, Passwort, angemeldete Geräte, Ports, Zertifikat', () => navigate('/server')),
      inAndroidApp() ? listButton('wifi', 'App-Verbindung', 'Server-Adresse und Anmeldung der Android-App', () => window.XeniaApp.reauth()) : null,
      listButton('logout', 'Abmelden', null, logout)),
    h('p', { class: 'muted small', style: { 'text-align': 'center', 'margin-top': '24px' } }, `Xenios ${store.server?.version || ''}`),
  );

  // --- Maschinenwerte -------------------------------------------------------
  (async () => {
    try {
      const { settings: s } = await api('/api/machine/settings');
      const changes = {};
      const set = (k) => (v) => { changes[k] = v; save.disabled = false; };
      const save = h('button', { class: 'btn filled wide', disabled: true, onclick: async () => {
        save.disabled = true;
        try {
          await api('/api/machine/settings', { method: 'POST', body: { changes } });
          for (const k of Object.keys(changes)) delete changes[k];
          snackbar('Einstellungen gespeichert');
        } catch (e) {
          snackbar(e.message);
          save.disabled = false;
        }
      } }, 'Einstellungen speichern');
      const sel = (label, key, options) => {
        const select = h('select', { class: 'text' }, options.map(([v, t]) => h('option', { value: v, selected: Number(s[key]) === v }, t)));
        select.addEventListener('change', () => {
          set(key)(Number(select.value));
          if (key === 'MA_FAST_HEATUP_TYPE') flushRow.hidden = Number(select.value) !== 1;
        });
        return h('label', { class: 'field', style: { 'margin-top': '8px' } }, h('span', {}, label), select);
      };
      const flushRow = sliderRow({ label: 'Dauer der Aufheiz-Spülung', min: 1, max: 20, step: 1, value: Math.max(1, s.MA_HEATUP_FLUSH_DURATION || 1), unit: 's', digits: 0, onInput: set('MA_HEATUP_FLUSH_DURATION') });
      flushRow.hidden = Number(s.MA_FAST_HEATUP_TYPE) !== 1;
      const disabled = !features.settings;
      const classic = isClassic();
      machineBox.replaceChildren(
        h('div', { class: 'card' },
          h('h3', {}, 'Brühgruppe & Brühkessel'),
          sliderRow({ label: 'Brühgruppe', min: 60, max: 96, step: 0.1, value: s.BG_SET_TEMP, unit: '°C', onInput: set('BG_SET_TEMP') }),
          sliderRow({ label: 'Brühkessel', min: 60, max: 96, step: 0.1, value: s.BB_SET_TEMP, unit: '°C', onInput: set('BB_SET_TEMP') }),
          classic ? null : h('details', { class: 'adv' }, h('summary', {}, 'Eco & Hysterese', icon('more', 's20')),
            sliderRow({ label: 'Brühgruppe Eco', min: 40, max: 95, step: 0.1, value: s.BG_SET_ECO_TEMP, unit: '°C', onInput: set('BG_SET_ECO_TEMP') }),
            sliderRow({ label: 'Brühkessel Eco', min: 40, max: 95, step: 0.1, value: s.BB_SET_ECO_TEMP, unit: '°C', onInput: set('BB_SET_ECO_TEMP') }),
            sliderRow({ label: 'Hysterese Brühgruppe', min: 2, max: 5, step: 0.1, value: s.BG_SET_TEMP_HYST, unit: 'K', onInput: set('BG_SET_TEMP_HYST') }),
            sliderRow({ label: 'Hysterese Brühkessel', min: 2, max: 5, step: 0.1, value: s.BB_SET_TEMP_HYST, unit: 'K', onInput: set('BB_SET_TEMP_HYST') }))),
        h('div', { class: 'card' },
          h('h3', {}, 'Dampfkessel'),
          sliderRow({ label: 'Dampfdruck', min: 0, max: 1.8, step: 0.1, value: s.SB_SET_PRESS, unit: 'bar', onInput: set('SB_SET_PRESS') }),
          classic ? null : h('details', { class: 'adv' }, h('summary', {}, 'Eco & Hysterese', icon('more', 's20')),
            sliderRow({ label: 'Dampfdruck Eco', min: 0, max: 1, step: 0.1, value: s.SB_SET_ECO_PRESS, unit: 'bar', onInput: set('SB_SET_ECO_PRESS') }),
            sliderRow({ label: 'Hysterese', min: 0.1, max: 0.3, step: 0.1, value: s.SB_SET_PRESS_HYST, unit: 'bar', onInput: set('SB_SET_PRESS_HYST') }))),
        classic ? null : h('div', { class: 'card' },
          h('h3', {}, 'Allgemein'),
          sliderRow({ label: 'Max. Bezugszeit', min: 30, max: 120, step: 1, value: s.PU_SET_MAX_TIMER, unit: 's', digits: 0, onInput: set('PU_SET_MAX_TIMER') }),
          sel('Beim Einschalten', 'MA_BOILER_START_MODE', [[1, 'Brühkessel AN & Dampfkessel AN'], [2, 'Brühkessel AN & Dampfkessel AUS']]),
          sel('Aufheiz-Spülung', 'MA_FAST_HEATUP_TYPE', [[0, 'Keine Spülung'], [1, 'Automatische Spülung']]),
          flushRow,
          sel('Bezugszeit startet bei', 'MA_START_EXTRACTIONCOUNTER_EVENT', [[0, 'Pumpenstart'], [1, '1 bar Druck'], [2, 'Erster Tropfen in der Tasse']])),
        classic ? h('p', { class: 'muted small' }, 'Auf der alten Xenia lassen sich Temperatur und Dampfdruck über die API setzen. Weitere Werte stehen in der Original-Oberfläche.') : null,
        disabled ? h('p', { class: 'muted small' }, 'Ändern ist in der Server-Konfiguration deaktiviert.') : save,
      );
      if (disabled) machineBox.querySelectorAll('input,select').forEach((el) => { el.disabled = true; });
    } catch (e) {
      machineBox.replaceChildren(h('div', { class: 'empty' }, e.message));
    }
  })();

  // --- Push ------------------------------------------------------------------------
  paintPush(pushBox);

  // --- Info ---------------------------------------------------------------------------
  (async () => {
    try {
      const d = await api('/api/machine/details');
      const m = d.machine || {};
      const i = d.info || {};
      const n = d.network || {};
      const st = store.machine || {};
      const sig = Number(n.WIFI_SIGNAL_STRENGTH);
      const sigTxt = Number.isFinite(sig) ? `${sig} dBm (${sig > -55 ? 'sehr gut' : sig > -67 ? 'gut' : sig > -75 ? 'schwach' : 'sehr schwach'})` : '–';
      infoBox.replaceChildren(h('dl', { class: 'kv' },
        h('dt', {}, 'Modell'), h('dd', {}, st.info?.typeName || `Typ ${m.MA_TYPE}`),
        h('dt', {}, 'Firmware (Steuerung / WLAN)'), h('dd', {}, `${m.FW_VERSION_MAJOR}.${m.FW_VERSION_MINOR} / ${m.ESP_FW_MAJOR}.${m.ESP_FW_MINOR}`),
        h('dt', {}, 'Seriennummer'), h('dd', {}, m.MA_SN || '–'),
        h('dt', {}, 'Bezüge gesamt'), h('dd', {}, fmtInt(m.MA_EXTRACTIONS)),
        h('dt', {}, 'Betriebsstunden'), h('dd', {}, fmtInt(m.MA_OPERATING_HOURS)),
        h('dt', {}, 'Energie gesamt'), h('dd', {}, `${fmt(m.MA_ENERGY_TOTAL_KWH, 2)} kWh`),
        h('dt', {}, 'Max. Strom'), h('dd', {}, `${fmtInt(m.MA_MAX_AMPERE)} A`),
        h('dt', {}, 'WLAN'), h('dd', {}, sigTxt),
        h('dt', {}, 'Erweiterte thermische Stabilität'), h('dd', {}, m.MA_EXTENDED_THERMAL_STABILITY === undefined ? '–' : Number(m.MA_EXTENDED_THERMAL_STABILITY) ? 'an' : 'aus'),
        h('dt', {}, 'Festwasseranschluss'), h('dd', {}, m.MA_FIX_WATER_SUPPLY === undefined ? '–' : Number(m.MA_FIX_WATER_SUPPLY) ? 'ja' : 'nein (Tank)'),
        h('dt', {}, 'WLAN-Name'), h('dd', {}, n.WIFI_NAME || '–'),
        h('dt', {}, 'IP-Adresse'), h('dd', {}, n.WIFI_AP_IP || '–'),
        h('dt', {}, 'Verschlüsselung'), h('dd', {}, n.WIFI_ENCRYPTION || '–'),
        h('dt', {}, 'Eigener Access Point'), h('dd', {}, n.WIFI_SOFT_AP || '–'),
        h('dt', {}, 'Letzter Kontakt'), h('dd', {}, ago(st.lastSeen)),
        h('dt', {}, 'Zeitzone (Index)'), h('dd', {}, String(i.TZ_IND ?? '–'))),
      isClassic() ? null : serviceDetails());
    } catch (e) {
      infoBox.replaceChildren(h('div', { class: 'muted' }, e.message));
    }
  })();

  return () => {};
}


function themeCard() {
  const current = localStorageGet('theme') || 'system';
  const chip = (v, label) => h('button', { class: 'chip', 'aria-pressed': String(current === v), onclick: (e) => {
    localStorageSet('theme', v);
    applyTheme(v);
    e.currentTarget.parentElement.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c === e.currentTarget)));
  } }, label);
  return h('div', { class: 'card low' }, h('div', { class: 'chips' }, chip('system', 'System'), chip('light', 'Hell'), chip('dark', 'Dunkel')));
}

// --- Push-Benachrichtigungen -------------------------------------------------------------
function b64ToBytes(b64) {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

// Werte der Seite „Factory“ der Original-Oberfläche – nur lesend; Ändern bleibt dort (Regelverhalten/Kalibrierung).
const SERVICE = [
  ['Brühgruppe (PID/Sensor)', 'brewgroup/pid'],
  ['Brühkessel (PID/Sensor)', 'brewboiler/pid'],
  ['Pumpe (PID/Sensor)', 'pump/pid'],
  ['Dampfkessel (Sensor)', 'steamboiler/pid'],
  ['Waage, Durchfluss, Display', 'mahlkonig/get'],
];
function serviceDetails() {
  const body = h('div', {}, h('div', { class: 'muted small' }, 'Lade …'));
  const det = h('details', { class: 'adv' }, h('summary', {}, 'Service-Werte (nur lesen)', icon('more', 's20')), body);
  let loaded = false;
  det.addEventListener('toggle', async () => {
    if (!det.open || loaded) return;
    loaded = true;
    const parts = [];
    for (const [title, ep] of SERVICE) {
      try {
        const d = await api(`/api/raw/machine/${ep}`);
        const rows = Object.entries(d).filter(([k]) => k !== 'VIEW').flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, String(v))]);
        parts.push(h('h3', { style: { 'margin-top': '12px' } }, title), h('dl', { class: 'kv' }, ...rows));
      } catch (e) {
        parts.push(h('h3', { style: { 'margin-top': '12px' } }, title), h('div', { class: 'muted small' }, e.message));
      }
    }
    body.replaceChildren(h('p', { class: 'muted small' }, 'Regelparameter und Kalibrierung ändert der Server bewusst nicht (Gefahr falscher Temperaturen bzw. Waage). Dafür die Original-Oberfläche im WLAN nutzen.'), ...parts);
  });
  return det;
}

async function paintPush(box) {
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
