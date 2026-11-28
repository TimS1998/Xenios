// Zwei Xenia-APIs: die aktuelle Brew-by-Sync-Firmware und die ältere DBL-API
// (https://www.xenia-espresso.de/api.html, xenia-home).
// Werte: machine.api = 'bbs' | 'classic'
import { t } from './i18n.js';

export const MACHINE_API = {
  bbs: {
    id: 'bbs',
    get label() { return t('core.machineApi.bbs.label'); },
    get detail() { return t('core.machineApi.bbs.detail'); },
    livePath: '/api/v2/diagram/get',
    scriptsList: ['/api/v2/scriptslist', '/api/v2/scripts/list'],
    general: true,
    info: true,
    weeklyTimers: true,
    paddle: true,
    clock: true,
    toggleSb: true,
  },
  classic: {
    id: 'classic',
    get label() { return t('core.machineApi.classic.label'); },
    get detail() { return t('core.machineApi.classic.detail'); },
    livePath: '/api/v2/overview',
    scriptsList: ['/api/v2/scripts/list', '/api/v2/scriptslist'],
    general: false,
    info: false,
    weeklyTimers: false,
    paddle: false,
    clock: false,
    toggleSb: false,
  },
};

export const CLASSIC_SETTING_FIELDS = ['BG_SET_TEMP', 'BB_SET_TEMP', 'SB_SET_PRESS'];

export function machineApiId(v) {
  return v === 'classic' ? 'classic' : 'bbs';
}

export function machineApi(v) {
  return MACHINE_API[machineApiId(v)];
}

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

// Felder der neuen Firmware auf die Namen bringen, die der Rest des Codes erwartet.
export function normalizeLive(d) {
  return {
    ...d,
    // Alte Xenia (DBL): SCALE_WEIGHT ist die Bluetooth-Waage, PU_SENS_SCALE_VOLUME die (meist fehlende) interne –
    // die steht dann auf 0. Deshalb den Wert nehmen, der tatsächlich etwas misst.
    PU_LOADCELL_VOLUME: measured(d.PU_LOADCELL_VOLUME, d.SCALE_WEIGHT, d.PU_SENS_SCALE_VOLUME),
    PU_LOADCELL_RATE: measured(d.PU_LOADCELL_RATE, d.PU_SENS_SCALE_RATE),
    PU_SENS_FLOW_METER_VOLUME: first(d.PU_SENS_FLOW_METER_VOLUME, d.PU_SENS_FLOW_METER_ML),
    PU_SENS_FLOW_METER_FLOWRATE: first(d.PU_SENS_FLOW_METER_FLOWRATE),
    PU_SENS_FLOW_METER_ML: first(d.PU_SENS_FLOW_METER_ML, d.PU_SENS_FLOW_METER_VOLUME),
  };
}

// Erster Wert ungleich 0; sonst der erste vorhandene (auch 0)
function measured(...vals) {
  for (const v of vals) {
    const n = num(v);
    if (n !== null && Number.isFinite(n) && n !== 0) return n;
  }
  return first(...vals);
}

function first(...vals) {
  for (const v of vals) {
    const n = num(v);
    if (n !== null && Number.isFinite(n)) return n;
  }
  return null;
}
