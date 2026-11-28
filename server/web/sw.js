// Service Worker: App-Hülle offline verfügbar, Push-Benachrichtigungen, Aktionen aus der Benachrichtigung.
const VERSION = 'xenios-v2.5.2';
const SHELL = [
  '/', '/index.html', '/app.css', '/manifest.webmanifest',
  '/fonts/open-sans-latin-300-normal.woff2', '/fonts/open-sans-latin-400-normal.woff2', '/fonts/open-sans-latin-600-normal.woff2',
  '/js/app.js', '/js/motion.js', '/js/live.js', '/js/api.js', '/js/ui.js', '/js/icons-xenia.js', '/js/prefs.js', '/js/gauge.js', '/js/setup.js',
  '/js/views/dashboard.js', '/js/views/shot-detail.js', '/js/views/community.js', '/shared/shot-analysis.js', '/shared/i18n.js', '/shared/i18n/de/index.js', '/shared/i18n/de/common.js', '/shared/i18n/de/app.js', '/shared/i18n/de/home.js', '/shared/i18n/de/shots.js', '/shared/i18n/de/settings.js', '/shared/i18n/de/core.js', '/shared/i18n/de/server.js', '/shared/visualizer.js', '/shared/machine-core.js', '/shared/machine-api.js', '/shared/grinder-core.js', '/shared/emitter.js', '/shared/sqlite-read.js', '/shared/log.js',
  '/js/views/scripts.js', '/js/views/controls.js', '/js/views/shots.js', '/js/views/timer.js', '/js/views/grinder.js', '/js/views/settings.js', '/js/views/server.js',
  '/icons/icon.svg', '/icons/icon-192.png', '/icons/badge-96.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // API, Login und Live-Stream nie cachen
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/') || url.pathname === '/healthz') return;
  if (e.request.mode === 'navigate') {
    // Netz zuerst (Updates), sonst die gespeicherte App-Hülle
    e.respondWith(fetch(e.request).catch(() => caches.match('/index.html')));
    return;
  }
  // Statische Dateien: Netz zuerst (immer aktuelle App), Cache nur offline
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request)),
  );
});

// --- Push -----------------------------------------------------------------------
// Texte der Benachrichtigungs-Knöpfe und -Rückmeldungen. Der Service Worker ist ein klassisches Skript und kann die
// Kataloge (shared/i18n/…) nicht als Modul laden; deshalb hier eine eigene kleine Tabelle je Sprache (Sprache des
// Geräts, sonst Deutsch). Neue Sprache: Eintrag mit denselben Schlüsseln ergänzen.
const SW_TEXT = {
  de: { open: 'Öffnen', off: 'Ausschalten', steamOff: 'Dampf aus', switchedOff: 'Ausgeschaltet', steamIsOff: 'Dampfkessel aus', failed: 'Aktion fehlgeschlagen – bitte App öffnen' },
};
const tx = (k) => (SW_TEXT[String(self.navigator?.language || '').slice(0, 2).toLowerCase()] || SW_TEXT.de)[k];
const ACTIONS = {
  heated: () => [{ action: 'open', title: tx('open') }, { action: 'off', title: tx('off') }],
  power: () => [{ action: 'off', title: tx('off') }],
  steam: () => [{ action: 'steam-off', title: tx('steamOff') }],
};

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Xenia', body: e.data?.text() }; }
  const title = d.title || 'Xenios';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    tag: d.tag || d.topic || 'xenia',
    renotify: true,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    timestamp: d.at ? Date.parse(d.at) : Date.now(),
    data: { topic: d.topic, url: d.topic === 'grinder' ? '/muehle' : '/' },
    actions: ACTIONS[d.topic]?.() || [],
    vibrate: d.topic === 'shot' || d.topic === 'heated' ? [80, 40, 80] : undefined,
  }));
});

async function post(path, body) {
  const res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Xenia': '1' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(String(res.status));
}

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const action = e.action;
  e.waitUntil((async () => {
    try {
      if (action === 'off') {
        await post('/api/machine/power', { mode: 'off' });
        return self.registration.showNotification('Xenios', { body: tx('switchedOff'), tag: 'action', icon: '/icons/icon-192.png', badge: '/icons/badge-96.png' });
      }
      if (action === 'steam-off') {
        await post('/api/machine/steam', { on: false });
        return self.registration.showNotification('Xenios', { body: tx('steamIsOff'), tag: 'action', icon: '/icons/icon-192.png', badge: '/icons/badge-96.png' });
      }
    } catch {
      return self.registration.showNotification('Xenios', { body: tx('failed'), tag: 'action', icon: '/icons/icon-192.png' });
    }
    const target = e.notification.data?.url || '/';
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === location.origin) {
        c.postMessage({ type: 'navigate', path: target });
        return c.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
