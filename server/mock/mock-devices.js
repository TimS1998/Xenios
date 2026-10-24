#!/usr/bin/env node
// Simulierte Xenia (HTTP :8091) und Mahlkönig E64 WS (HTTPS :8092) für Entwicklung und Tests.
// Verhält sich wie die echten Geräte (gleiche Endpunkte, Formate und Eigenheiten).
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createSelfSignedCert } from '../src/tls.js';
import { openSqlite } from '../src/sqlite-read.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THUSRDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

export function createMockXenia({ speed = 1 } = {}) {
  const s = {
    MA_STATUS: 0, SB_STATUS: 1, bg: 24.0, bb: 24.5, sb: 0, pump: 0, pumpPw: 0, extractionMs: 0, scale: 0, flowMl: 0,
    general: {
      BB_FILL_LEVEL: 1, BB_SET_TEMP: 92, BB_SET_ECO_TEMP: 70, BB_SET_TEMP_HYST: 2, BB_SET_POWER: 500, BB_TEMPERATURE_OFFSET: 3,
      BG_SET_TEMP: 92, BG_SET_ECO_TEMP: 70, BG_SET_TEMP_HYST: 2, BG_SET_POWER: 300, BG_TEMPERATURE_OFFSET: 3,
      PU_SET_MAX_TIMER: 90, SB_SET_PRESS: 1.6, SB_SET_ECO_PRESS: 0.5, SB_SET_PRESS_HYST: 0.1, SB_SET_POWER: 1200,
      MA_FIX_WATER_SUPPLY: 0, MA_FAST_HEATUP_TYPE: 0, MA_HEATUP_FLUSH_DURATION: 0, MA_BOILER_START_MODE: 1,
      MA_START_EXTRACTIONCOUNTER_EVENT: 0,
    },
    switches: { SWITCH_SET_LEFT_LEFT_0: 2, SWITCH_SET_LEFT_LEFT_1: 0, SWITCH_SET_RIGHT_LEFT_0: 8, SWITCH_SET_RIGHT_LEFT_1: 0, SWITCH_SET_RIGHT_RIGHT_0: 7, SWITCH_SET_RIGHT_RIGHT_1: 0, MA_BEVERAGE_WEIGHT_SGL_INT_SCALE: 18, MA_BEVERAGE_WEIGHT_DBL_INT_SCALE: 40 },
    timers: { MA_SET_TIMER_ECO_MA: 20, MA_SET_TIMER_POWERDOWN: 10 },
    tz: 322, view: 1, extractions: 350, energy: 0.729577, tank: 1,
    scripts: { 12: { title: 'Blooming Espresso', content: '1;13;3 40 2000;12 4000;4 9000 25000;6;7;' }, 17: { title: '6 Bar', content: '1;13;4 6000 30000;6;7;' } },
    editId: 'none', paddle: false, brewing: null, log: [],
  };
  for (const d of DAYS) {
    s.timers[`TI_${d}_ON1`] = 0; s.timers[`TI_${d}_ON2`] = 0;
    s.timers[`TI_${d}_ON1_BOILER`] = 0; s.timers[`TI_${d}_ON2_BOILER`] = 0;
  }
  s.timers.TI_SATURDAY_ON1 = (8 << 16) | (0 << 8); s.timers.TI_SATURDAY_ON1_BOILER = 3;
  s.timers.TI_SATURDAY_ON2 = (11 << 16) | (30 << 8); s.timers.TI_SATURDAY_ON2_BOILER = 3;

  const pack = (h, m, sec) => (h << 16) | (m << 8) | sec;
  const now = () => new Date();
  const clock = () => { const d = now(); return pack(d.getHours(), d.getMinutes(), d.getSeconds()); };
  const cal = () => { const d = now(); return ((d.getDate() << 24) | ((d.getMonth() + 1) << 16) | d.getFullYear()) >>> 0; };

  // Physik-Simulation (stark vereinfacht)
  const tick = setInterval(() => {
    const on = [1, 3, 4, 5].includes(s.MA_STATUS);
    const eco = s.MA_STATUS === 2;
    const g = s.general;
    const target = (t) => (on ? t : eco ? g.BG_SET_ECO_TEMP : 22) + g.BG_TEMPERATURE_OFFSET;
    s.bg += (target(g.BG_SET_TEMP) - s.bg) * 0.08 * speed;
    s.bb += (target(g.BB_SET_TEMP) - s.bb) * 0.1 * speed;
    const sbTarget = on && s.SB_STATUS === 2 ? g.SB_SET_PRESS : 0;
    s.sb += (sbTarget - s.sb) * 0.06 * speed;
    if (s.brewing) {
      const b = s.brewing;
      b.t += 250 * speed;
      s.extractionMs = b.t;
      const target = b.t < 4000 ? 2 : 9;
      s.pump += (target - s.pump) * 0.35;
      s.pumpPw = Math.round(50 + s.pump * 4);
      if (b.t > 6000) { s.scale += 0.45 * speed; s.flowMl += 0.5 * speed; }
      if (b.t >= b.duration || (b.stopAt && s.scale >= b.stopAt)) {
        s.MA_STATUS = 4; s.brewing = null; s.extractions++;
        setTimeout(() => { if (s.MA_STATUS === 4) s.MA_STATUS = 1; s.pump = 0; s.pumpPw = 0; }, 2500 / speed);
      }
    } else if (!s.paddle) {
      s.pump *= 0.5;
      if (s.pump < 0.05) s.pump = 0;
    }
  }, 250);
  tick.unref();

  const r1 = (v) => Math.round(v * 10) / 10;
  const live = () => ({
    BG_LEVEL_PW_CONTROL: s.MA_STATUS ? Math.max(0, Math.round((s.general.BG_SET_TEMP + 3 - s.bg) * 20)) : 0,
    BB_LEVEL_PW_CONTROL: s.MA_STATUS ? Math.max(0, Math.round((s.general.BB_SET_TEMP + 3 - s.bb) * 20)) : 0,
    PU_LEVEL_PW_CONTROL: s.pumpPw,
    BG_SENS_TEMP_A: r1(s.bg), BB_SENS_TEMP_A: r1(s.bb),
    PU_SENS_FLOW_METER_VOLUME: r1(s.flowMl), PU_SENS_FLOW_METER_FLOWRATE: s.brewing ? 2 : 0,
    PU_LOADCELL_VOLUME: r1(s.scale), PU_LOADCELL_RATE: s.brewing && s.brewing.t > 6000 ? 1.8 : 0,
    PU_SENS_FLOW_METER_ML: r1(s.flowMl), PU_SENS_PRESS: r1(s.pump), SB_SENS_PRESS: Math.round(s.sb * 100) / 100,
    SB_STATUS: s.SB_STATUS, EXTRACTION_TIME_MS: Math.round(s.extractionMs), MA_STATUS: s.MA_STATUS,
  });

  const startBrew = (id) => {
    if (![1, 4].includes(s.MA_STATUS)) return false;
    s.MA_STATUS = 3; s.extractionMs = 0; s.scale = 0; s.flowMl = 0;
    // Befehl 27 (Bezug stoppen bei x g) beendet den Bezug am Gewicht
    const stop = /(?:^|;)27 (\d+(?:\.\d+)?)/.exec(s.scripts[id]?.content || '');
    s.brewing = { t: 0, duration: id === 2 ? 60000 : 27000, id, stopAt: stop ? Number(stop[1]) : null };
    return true;
  };

  const html = '<!DOCTYPE html><html lang="en"><head><title>Mahlkönig</title></head><body>index</body></html>';

  function handler(req, res) {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const p = url.pathname.replace(/\/+$/, '') || '/';
      let j = {};
      try { j = body ? JSON.parse(body) : {}; } catch { j = {}; }
      s.log.push(`${req.method} ${p} ${body}`);
      if (s.log.length > 500) s.log.shift();
      const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      const ok = () => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(); };
      const g = s.general;
      const GET = req.method === 'GET';
      switch (`${req.method} ${p}`) {
        case 'GET /api/v2/status': return json({ MA_STATUS: s.MA_STATUS });
        case 'GET /api/v2/diagram/get': case 'GET /api/v2/diagram_get': return json(live());
        case 'GET /api/v2/overview': return json({ MA_EXTRACTIONS: s.extractions, MA_OPERATING_HOURS: 20, MA_STATUS: s.MA_STATUS, MA_CLOCK: clock(), MA_CUR_PWR: 0, MA_MAX_PWR: 10, MA_ENERGY_TOTAL_KWH: s.energy, BG_SENS_TEMP_A: r1(s.bg), BG_LEVEL_PW_CONTROL: 0, PU_SENS_PRESS: r1(s.pump), PU_LEVEL_PW_CONTROL: s.pumpPw, PU_SET_LEVEL_PW_CONTROL: 0, PU_SENS_FLOW_METER_ML: 0, SB_SENS_PRESS: r1(s.sb), BB_SENS_TEMP_A: r1(s.bb), BB_LEVEL_PW_CONTROL: 0, SB_STATUS: s.SB_STATUS, MA_LAST_EXTRACTION_ML: '', MA_SET_TIMER_POWERDOWN: s.timers.MA_SET_TIMER_POWERDOWN, PU_SENS_SCALE_VOLUME: 0, SCALE_WEIGHT: 0, PU_SENS_SCALE_RATE: 0, PU_SENS_FLOW_METER_VOLUME: 0, PU_SENS_FLOW_METER_FLOWRATE: 0 });
        case 'GET /api/v2/overview_single': return json({ BG_SET_TEMP: g.BG_SET_TEMP, BG_TEMPERATURE_OFFSET: 3, PU_SET_PRESS: 9, BB_OFFSET_TO_BG: 0, BB_TEMPERATURE_OFFSET: 3, PU_SENS_WATER_TANK_LEVEL: s.tank, SB_SET_PRESS: g.SB_SET_PRESS, BB_SET_TEMP: g.BB_SET_TEMP, PSP: 70, MA_MAC: '00:11:22:33:44:55', MA_EXTRACTIONS_START: 0, POP_UP: 0 });
        case 'GET /api/v2/general': return json({ ...g, SB_STATUS: s.SB_STATUS, MA_STATUS: s.MA_STATUS, VIEW: s.view });
        case 'POST /api/v2/general':
          for (const [k, v] of Object.entries(j)) if (k in g) g[k] = Number(v);
          return ok();
        case 'GET /api/v2/machine': return json({ MA_TYPE: 3, MA_SUBTYPE: 1, MA_EXTRACTIONS: s.extractions, MA_OPERATING_HOURS: 20, MA_EXTRACTIONS_START: 0, MA_FIX_WATER_SUPPLY: 0, MA_HEATUP_FLUSH_DURATION: 0, MA_BOILER_START_MODE: g.MA_BOILER_START_MODE, MA_EXTENDED_THERMAL_STABILITY: 0, MA_SET_TIMER_ECO_MA: s.timers.MA_SET_TIMER_ECO_MA, MA_SET_TIMER_POWERDOWN: s.timers.MA_SET_TIMER_POWERDOWN, MA_MAX_AMPERE: 10, MA_ENERGY_TOTAL_KWH: s.energy, PU_SET_BREW_TIMER_1: 37, FW_VERSION_MAJOR: 4, FW_VERSION_MINOR: 226, PU_SET_QUANTITY_MEASUREMENT: 3, ESP_FW_MAJOR: 3, ESP_FW_MINOR: 87, BLE: 0, MA_DELAY: -1, BT_SCALE_NAME: '', MA_SN: '000000001234' });
        case 'GET /api/v2/info': return json({ MSN: '', FW_VERSION_MAJOR: 4, FW_VERSION_MINOR: 226, ESP_FW_MAJOR: 3, ESP_FW_MINOR: 87, MA_TYPE: 3, MA_EXTRACTIONS: s.extractions, MA_OPERATING_HOURS: 5, MA_MAC: '4455', MA_TIMEZONE: 1, TZ_IND: s.tz, MA_CLOCK: clock(), MA_CALENDAR: cal(), VIEW: s.view });
        case 'GET /tz/tz.json': return json({ 322: ['Europe/Berlin', 'CET-1CEST,M3.5.0,M10.5.0/3', 'DE', 1] });
        case 'POST /api/v2/timer2/sync': s.lastSync = j; return ok();
        case 'GET /api/v2/network': return json({ WIFI_NAME: 'MockNet', WIFI_SIGNAL_STRENGTH: '-60', WIFI_ENCRYPTION: 'WPA2_PSK', WIFI_SOFT_AP: '172.16.0.1', WIFI_SOFT_AP_MAC: '00:11:22:33:44:56', WIFI_AP_SSID: 'MockNet', WIFI_AP_IP: '127.0.0.1', WIFI_AP_MAC: '00:11:22:33:44:55', WIFI_STATUS: 3, VIEW: s.view });
        case 'GET /api/v2/mako': return json({ MA_STATUS: s.MA_STATUS, PU_SENS_FLOW_METER_VOLUME: r1(s.flowMl), PU_SENS_FLOW_METER_FLOWRATE: 0, MA_EXTRACTION_STATUS: s.brewing ? 1 : 0, BG_SET_TEMP: g.BG_SET_TEMP, BG_SENS_TEMP: r1(s.bg - 3), REAL_EXTRACTION_TIME_MS: Math.round(s.extractionMs), TANK_LEVEL: s.tank, TIMESTAMP: now().toISOString().slice(0, 19).replace('T', ' '), script: '' });
        case 'GET /api/v2/language': return json({ pref_lang: 'en' });
        case 'GET /api/v2/upload/status': return json({ status: 'good' });
        case 'POST /api/v2/machine/control': {
          const a = Number(j.action);
          if (a === 0) { s.MA_STATUS = 0; s.brewing = null; } else if (a === 1) s.MA_STATUS = 1; else if (a === 2) s.MA_STATUS = 2;
          return ok();
        }
        case 'POST /api/v2/toggle/sb': s.SB_STATUS = Number(j.TOGGLE) ? 2 : 1; return ok();
        case 'GET /api/v2/switches': return json({ ...s.switches, MA_SET_TIMER_POWERDOWN: s.timers.MA_SET_TIMER_POWERDOWN, VIEW: s.view });
        case 'POST /api/v2/switches': Object.assign(s.switches, Object.fromEntries(Object.entries(j).map(([k, v]) => [k, Number(v)]))); return ok();
        case 'GET /api/v2/scriptslist': {
          const ids = Object.keys(s.scripts).map(Number);
          return json({ index_list: ids, title_list: ids.map((i) => s.scripts[i].title) });
        }
        case 'POST /api/v2/scripts/read': {
          const sc = s.scripts[Number(j.FILE_NAME)];
          return sc ? json({ Title: sc.title, Content: sc.content }) : (res.writeHead(500), res.end());
        }
        case 'POST /api/v2/scripts/execute': {
          if (!startBrew(Number(j.ID))) { res.writeHead(500); return res.end(); }
          return ok();
        }
        case 'GET /api/v2/scripts/stop':
          if (s.MA_STATUS !== 3) { res.writeHead(500); return res.end(); }
          s.brewing = null; s.MA_STATUS = 4; setTimeout(() => { s.MA_STATUS = 1; }, 1500);
          return ok();
        case 'POST /api/v2/scriptsedit': s.editId = Number(j.SCRIPT_ID); return ok();
        case 'GET /api/v2/scripts/edit': return json({ id: s.editId });
        case 'POST /api/v2/scripts/create': {
          if (!j.name || !/^1;.*7;$/.test(j.instruction)) { res.writeHead(400); return res.end(); }
          let id;
          if (j.Edit === 'Enabled' && Number(j.script_id) === s.editId) id = Number(j.script_id);
          else {
            const range = j.script === 'paddle' ? [200, 249] : [10, 149];
            for (id = range[0]; id <= range[1] && s.scripts[id]; id++);
            if (id > range[1]) { res.writeHead(403); return res.end(); }
          }
          s.scripts[id] = { title: j.name, content: j.instruction };
          s.editId = 'none';
          return ok();
        }
        case 'POST /api/v2/scripts/delete': {
          const id = parseInt(String(j.scr_file_name), 10);
          delete s.scripts[id];
          return ok();
        }
        case 'POST /api/v2/scripts/iddownload': {
          const sc = s.scripts[Number(j.ID)];
          return json({ [sc?.title || 'none']: sc?.content || '' });
        }
        case 'GET /api/v2/timer2': return json({ MA_TYPE: 3, ...s.timers, MA_TIMEZONE: 1, TZ_IND: s.tz, MA_CLOCK: clock(), MA_CALENDAR: cal(), VIEW: s.view });
        case 'POST /api/v2/timer2':
          for (const d of DAYS) {
            for (const n of [1, 2]) {
              if (`TI_${d}_ON${n}` in j) {
                const sec = Number(j[`TI_${d}_ON${n}`]);
                s.timers[`TI_${d}_ON${n}`] = sec ? pack(Math.floor(sec / 3600), Math.floor((sec % 3600) / 60), 0) : 0;
              }
              if (`TI_${d}_ON${n}_STATUS` in j) s.timers[`TI_${d}_ON${n}_BOILER`] = Number(j[`TI_${d}_ON${n}_STATUS`]);
            }
          }
          if ('MA_SET_TIMER_ECO_MA' in j) s.timers.MA_SET_TIMER_ECO_MA = Number(j.MA_SET_TIMER_ECO_MA);
          if ('MA_SET_TIMER_POWERDOWN' in j) s.timers.MA_SET_TIMER_POWERDOWN = Number(j.MA_SET_TIMER_POWERDOWN);
          return ok();
        case 'POST /api/v2/timer3':
          for (const k of ['MA_SET_TIMER_ECO_MA', 'MA_SET_TIMER_POWERDOWN']) if (k in j) s.timers[k] = Number(j[k]) ? (s.timers[k] || 20) : 0;
          return ok();
        case 'GET /api/v2/paddle': s.paddle = true; return json({ VIEW: s.view, BB_SET_SUPPLY_VALVE: 0, BB_SET_SUPPLY_VALVE_2: 0, MA_STATUS: s.MA_STATUS, PU_SET_LEVEL_PW_CONTROL: 0 });
        case 'GET /api/v2/paddle/press': return json({ MA_STATUS: s.MA_STATUS, BB_SET_SUPPLY_VALVE: s.pumpPw > 0 ? 1 : 0, BB_SET_SUPPLY_VALVE_2: 0, PU_SENS_PRESS: r1(s.pump) });
        case 'POST /api/v2/paddle/pumppower': {
          if (![1, 5].includes(s.MA_STATUS)) { res.writeHead(500); return res.end(); }
          const lv = Number(j.PU_SET_LEVEL_PW_CONTROL);
          s.paddle = lv > 0; s.MA_STATUS = lv > 0 ? 5 : 1; s.pumpPw = lv; s.pump = lv / 10;
          return json({ BB_SET_SUPPLY_VALVE: lv > 0 ? 1 : 0, BB_SET_SUPPLY_VALVE_2: 0 });
        }
        case 'GET /api/v2/paddle/stop': s.paddle = false; s.pumpPw = 0; if (s.MA_STATUS === 5) s.MA_STATUS = 1; return ok();
        case 'GET /api/v2/brewgroup/pid': return json({ BG_P_VAL: 18, BG_I_VAL: 0.00033, BG_D_VAL: 0, BG_SET_SENSOR_SLOPE: 0.03501, BG_SET_SENSOR_OFFSET: -14.2, BG_SET_POWER: 300, BG_TEMPERATURE_OFFSET: 3 });
        // Endpunkte für die Mühle (Grind-by-Sync)
        case 'POST /api/v2/brewratio': s.lastBrewRatio = j; return ok();
        default:
          if (GET && p.startsWith('/api/v2/') && /alldelete|forget|tara|get_time|forcescan/.test(p)) {
            s.dangerous = (s.dangerous || 0) + 1; // Test: darf nie aufgerufen werden
          }
          res.writeHead(200, { 'Content-Type': 'text/html' });
          return res.end(html);
      }
    });
  }
  return { server: http.createServer(handler), state: s, stop: () => clearInterval(tick) };
}

// --- Mühle ------------------------------------------------------------------
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const nameBuf = Buffer.from(name);
    const comp = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lh, nameBuf, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

export function createMockGrinder({ password = 'mockpass' } = {}) {
  const dbFile = path.join(HERE, 'fixtures', 'grinder-mock.db');
  const db = fs.readFileSync(dbFile);
  const sessions = new Set();
  const st = { logins: 0, failed: 0, downloads: 0, dangerous: 0, requests: 0 };
  const { cert, key } = createSelfSignedCert({ commonName: 'hemro-mock', ips: ['127.0.0.1'] });

  const grindCsv = () => {
    const d = openSqlite(db);
    const rows = d.rows('grind_log').slice(-40).reverse();
    const head = 'grind_id,grind_uuid,grind_date_time,recipe_index,recipe_cpr_id,recipe_data_id,grind_ddd,grind_duration,grind_duration_noload,grind_weight,grind_successfull,grind_trigger_id,grind_trigger,recipe_gbs_enabled';
    return Buffer.from([head, ...rows.map((r) => [r.grind_id, r.grind_uuid, r.grind_date_time, r.recipe_index, 0, r.recipe_data_id, r.grind_ddd, r.grind_duration, 0, r.grind_weight, r.grind_successfull, r.grind_trigger_id, r.grind_trigger_id === 1 ? 'StartButton' : 'PortafilterDetection', r.recipe_gbs_enabled].join(','))].join('\n') + '\n');
  };

  function handler(req, res) {
    st.requests++;
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'https://x');
      const p = url.pathname;
      const cookie = /PHPSESSID=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];
      const authed = cookie && sessions.has(cookie);
      const json = (o, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o, null, 4)); };
      const denied = () => json({ console: 'Access denied!', success: false, errorCode: 0 }, 400);
      if (p === '/login.php' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
        return res.end('<html><title>Login Hemro E64</title><form action="/login.php" method="post"></form></html>');
      }
      if (p === '/login.php' && req.method === 'POST') {
        const f = new URLSearchParams(body);
        if (f.get('userRole') === 'Owner' && f.get('password') === password) {
          const id = crypto.randomBytes(16).toString('hex');
          sessions.add(id);
          st.logins++;
          res.writeHead(302, { Location: '/index.php', 'Set-Cookie': `PHPSESSID=${id}; path=/; secure; HttpOnly` });
        } else {
          st.failed++;
          res.writeHead(200, { 'Content-Type': 'text/html' });
        }
        return res.end();
      }
      if (p === '/index.php') {
        if (!authed) { res.writeHead(302, { Location: '/login.php' }); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end('<html><title>Hemro E64</title></html>');
      }
      const cmd = p.startsWith('/rest_api/') ? p.slice(10) : null;
      switch (cmd) {
        case 'ping': res.writeHead(200, { 'Content-Type': 'text/plain;charset=UTF-8' }); return res.end(authed ? 'pong\n' : 'expired');
        case 'check_session': res.writeHead(200, { 'Content-Type': 'text/plain;charset=UTF-8' }); return res.end(authed ? 'session_valid' : 'session_invalid');
        case 'get_machine_info': return json({ grinderType: 5, grinderTypeName: 'E64 WS', error: '' });
        case 'get_wifi_info': return authed ? json({ data: { hostname: 'hemro_hsg_MOCK', mode: 'Station', apIp: '', apMacAddress: '', staIp: '127.0.0.1', staMacAddress: '00:00:00:00:00:01' }, console: '', success: true, errorCode: 0 }) : denied();
        case 'download_database':
          if (!authed) return denied();
          st.downloads++;
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="HsgSqlite_SNMOCK_20261022_120000.db"', 'Content-Length': db.length });
          return res.end(db);
        case 'download_machine_logs': {
          if (!authed) return denied();
          const zip = makeZip({ 'HemroHsgGrindLogs_SNMOCK_20261022_120000.csv': grindCsv(), 'HemroHsgServiceLogs_SNMOCK_20261022_120000.csv': Buffer.from('event_id,event_type_id,event_type,event_date_time,event_details\n') });
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="HemroHsgMachineLogs_SNMOCK_20261022_120000.zip"' });
          return res.end(zip);
        }
        case 'kill_swupdate': case 'scan_wifi': st.dangerous++; return json({ success: true });
        default: if (cmd !== null) return json({ console: 'Error, unknown REST command', success: false, errorCode: 0 }, 400);
      }
      res.writeHead(404); res.end();
    });
  }
  return { server: https.createServer({ cert, key }, handler), state: st };
}

// Direkt gestartet: beide Geräte simulieren
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const x = createMockXenia();
  x.server.listen(8091, '127.0.0.1', () => console.log('Mock-Xenia:  http://127.0.0.1:8091'));
  const m = createMockGrinder();
  m.server.listen(8092, '127.0.0.1', () => console.log('Mock-Mühle:  https://127.0.0.1:8092  (Passwort: mockpass)'));
}
