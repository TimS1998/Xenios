// Verlauf der Live-Werte der letzten 10 Minuten; sammelt im Hintergrund, auch während andere Seiten offen sind.
import { store, subscribe } from './api.js';
import { t } from '../shared/i18n.js';

export const SERIES = [
  { key: 'bg', get label() { return t('home.live.series.bg'); }, axis: 'temp', cls: 'bg' },
  { key: 'bb', get label() { return t('home.live.series.bb'); }, axis: 'temp', cls: 'bb' },
  { key: 'pu', get label() { return t('home.live.series.pu'); }, axis: 'bar', cls: 'pu' },
  { key: 'sb', get label() { return t('home.live.series.sb'); }, axis: 'bar', cls: 'sb' },
];

export const liveHistory = [];
subscribe((part) => {
  if (part !== 'machine' && part !== 'all') return;
  const m = store.machine;
  if (!m?.online) return;
  const t = Date.now();
  if (liveHistory.length && t - liveHistory[liveHistory.length - 1].t < 400) return;
  liveHistory.push({ t, bg: m.temp.group, bb: m.temp.boiler, pu: m.pressure.pump, sb: m.pressure.steam });
  while (liveHistory.length && t - liveHistory[0].t > 10 * 60e3) liveHistory.shift();
});
