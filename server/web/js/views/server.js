// Server & Sicherheit: alle Einstellungen des Servers im Browser (gespeichert in config.json, sofort wirksam).
import { h, icon, snackbar, switchEl, sheet, confirmDialog, ago } from '../ui.js';
import { api, refreshState } from '../api.js';
import { logout } from '../app.js';
import { fillProbe, revealToggle, shake, tunnelGuide, apiChoice } from '../setup.js';

const LOCK_HINT = 'per Umgebungsvariable festgelegt';

export function serverView(root) {
  let data = null;
  const dirty = {};
  const body = h('div', {}, h('div', { class: 'empty' }, h('span', { class: 'spinner' }), ' Lade Server-Einstellungen …'));
  const saveBtn = h('button', { class: 'btn filled', onclick: save }, icon('check', 's18'), 'Speichern');
  const savebar = h('div', { class: 'savebar', hidden: true, role: 'region', 'aria-label': 'Ungespeicherte Änderungen' },
    h('span', { class: 'savebar-text' }, 'Ungespeicherte Änderungen'),
    h('button', { class: 'btn text', onclick: () => { for (const k of Object.keys(dirty)) delete dirty[k]; paint(); } }, 'Verwerfen'),
    saveBtn);
  root.append(body, savebar);

  const updateBox = h('div');
  let updatePoll = null;
  let updateReady = false;
  function paintUpdate(u) {
    const job = u.job || {};
    const pending = job.state === 'queued' || job.state === 'running';
    const line = h('div', { class: 'small' },
      `Installiert: Xenios ${u.current || data?.status?.version || '–'}`,
      u.latest ? (u.newer ? ` · neu: ${u.latest}` : ' · aktuell') : null,
      u.latestError ? h('span', { class: 'muted' }, ` · ${u.latestError}`) : null);
    const progress = pending
      ? h('p', { class: 'muted small' }, h('span', { class: 'spinner' }), job.state === 'queued'
        ? ' Der Update-Dienst holt die neue Version …'
        : ' Aktualisierung läuft, der Server startet gleich neu …')
      : job.state === 'error' ? h('div', { class: 'note warn' }, icon('warn', 's18'), h('span', {}, job.error || 'Aktualisierung fehlgeschlagen'))
      : job.state === 'ok' && job.version ? h('p', { class: 'small' }, `Zuletzt aktualisiert auf ${job.version}.`) : null;
    const btn = h('button', { type: 'button', class: 'btn tonal', disabled: pending, onclick: requestUpdate },
      icon('refresh', 's18'), u.newer && u.latest ? `Auf ${u.latest} aktualisieren` : 'Aktualisieren');
    const hint = u.helper
      ? h('p', { class: 'small muted' }, 'Holt das neueste Image und startet Xenios neu. Konfiguration, Sitzungen und Bezüge bleiben.')
      : h('div', { class: 'small muted' },
        h('p', {}, 'Damit der Knopf selbst aktualisiert, einmal auf dem Linux-Server:'),
        h('pre', { class: 'hint-code' }, 'curl -fsSL https://raw.githubusercontent.com/TimS1998/Xenios/main/install.sh | sh'),
        h('p', {}, 'Ohne den Dienst: ', h('code', {}, 'sh ~/xenios/install.sh --update')));
    updateBox.replaceChildren(h('div', { class: 'divider' }), h('div', {}, 'Aktualisierung'), line, progress, h('div', { class: 'row', style: { 'margin-top': '8px' } }, btn), hint);
  }
  async function refreshUpdate() {
    try {
      const u = await api('/api/admin/update');
      paintUpdate(u);
      return u.job?.state === 'queued' || u.job?.state === 'running';
    } catch {
      updateBox.replaceChildren(h('p', { class: 'muted small' }, h('span', { class: 'spinner' }), ' Verbindung unterbrochen – warte auf den Neustart …'));
      return true;
    }
  }
  function startUpdatePoll(immediate = true) {
    const tick = async () => {
      const again = await refreshUpdate();
      updatePoll = again ? setTimeout(tick, 2500) : null;
    };
    if (updatePoll) return;
    if (immediate) tick();
    else updatePoll = setTimeout(tick, 2500);
  }
  async function requestUpdate() {
    if (!(await confirmDialog(
      'Xenios aktualisieren?',
      'Der Server holt die neue Version und startet neu. Die Seite kommt danach von selbst zurück. Konfiguration und Bezüge bleiben.',
      'Aktualisieren',
    ))) return;
    try {
      paintUpdate(await api('/api/admin/update', { method: 'POST' }));
      startUpdatePoll(false);
    } catch (e) { snackbar(e.message); }
  }

  const locked = (p) => data.locked.includes(p);
  const value = (p) => (p in dirty ? dirty[p] : data.values[p]);
  function change(p, v) {
    const orig = data.values[p];
    if (JSON.stringify(v) === JSON.stringify(orig) || (p === 'grinder.password' && v === '')) delete dirty[p];
    else dirty[p] = v;
    savebar.hidden = Object.keys(dirty).length === 0;
  }

  async function load() {
    try {
      data = await api('/api/admin/config');
      paint();
    } catch (e) {
      body.replaceChildren(h('div', { class: 'empty' }, e.message));
    }
  }

  async function save() {
    saveBtn.disabled = true;
    const keys = Object.keys(dirty);
    const listener = keys.some((k) => /^(http|https|lan|gbs)\.(enabled|host|port)$/.test(k));
    try {
      data = await api('/api/admin/config', { method: 'PUT', body: { changes: dirty } });
      for (const k of keys) delete dirty[k];
      paint();
      refreshState().catch(() => {});
      snackbar(listener ? 'Gespeichert – Zugänge werden neu gestartet' : 'Gespeichert und übernommen');
    } catch (e) {
      snackbar(e.message);
      shake(savebar);
    } finally {
      saveBtn.disabled = false;
    }
  }

  // --- Bausteine ---
  const lockNote = (p) => (locked(p) ? h('span', { class: 'lock-note' }, icon('shield', 's18'), LOCK_HINT) : null);
  function text(label, p, { type = 'text', placeholder = '', parse = (v) => v.trim(), format = (v) => v ?? '', autocomplete = 'off' } = {}) {
    const input = h('input', { class: 'text', type, value: format(value(p)), placeholder, disabled: locked(p), autocomplete, spellcheck: 'false' });
    input.addEventListener('input', () => change(p, parse(input.value)));
    return h('label', { class: 'field' }, h('span', {}, label, lockNote(p)), input);
  }
  function number(label, p, min, max) {
    const f = text(label, p, { type: 'number', parse: (v) => Number(v), format: (v) => String(v ?? '') });
    Object.assign(f.querySelector('input'), { min, max, inputMode: 'numeric' });
    return f;
  }
  function toggle(label, sub, p, { onChange } = {}) {
    return h('div', { class: 'row toggle-row' },
      h('div', { class: 'grow' }, h('div', {}, label), sub ? h('div', { class: 'small muted' }, sub) : null, lockNote(p)),
      switchEl({ checked: value(p), disabled: locked(p), label, onChange: (on) => { change(p, on); onChange?.(on); } }));
  }
  function select(label, p, options) {
    const sel = h('select', { class: 'text', disabled: locked(p) }, options.map(([v, t]) => h('option', { value: v ?? '', selected: (value(p) ?? '') === (v ?? '') }, t)));
    sel.addEventListener('change', () => change(p, sel.value === '' ? null : sel.value));
    return h('label', { class: 'field' }, h('span', {}, label, lockNote(p)), sel);
  }
  const card = (title, ic, ...kids) => h('section', { class: 'card setting-card' }, h('h3', { class: 'card-head' }, icon(ic, 's20'), title), ...kids);
  const gap = () => h('div', { class: 'gap' });
  const warn = (txt) => h('div', { class: 'note warn' }, icon('warn', 's18'), h('span', {}, txt));

  function tunnelPaste(tunnel) {
    const input = h('textarea', { class: 'text', rows: 3, spellcheck: 'false', autocomplete: 'off', placeholder: 'sudo cloudflared service install …' });
    const note = h('p', { class: 'error', role: 'alert' });
    const btn = h('button', { type: 'button', class: 'btn tonal' }, 'Token übernehmen');
    btn.onclick = async () => {
      btn.disabled = true;
      note.textContent = '';
      try {
        await api('/api/admin/tunnel-token', { method: 'POST', body: { token: input.value } });
        input.value = '';
        snackbar('Token übernommen. cloudflared startet.');
      } catch (e) {
        note.textContent = e.message;
        shake(input);
      } finally {
        btn.disabled = false;
      }
    };
    return h('div', { style: { 'margin-top': '12px' } },
      h('label', { class: 'field' }, h('span', {}, 'Befehl aus Cloudflare'), input),
      h('div', { class: 'row', style: { 'margin-top': '8px' } }, btn),
      note,
      tunnel.helper
        ? h('p', { class: 'muted small' }, 'Die Zeile einfügen. Xenios führt sie nicht aus, sondern startet cloudflared selbst.')
        : h('p', { class: 'muted small' }, 'Die Zeile einfügen. Damit sie ankommt, einmal auf dem Server im Ordner der Installation: ', h('code', {}, 'sh install.sh'), '. Als root zeigt ~ auf /root.'));
  }

  function probeButton(kind, getBody) {
    const box = h('div', { class: 'probe', 'aria-live': 'polite' });
    const btn = h('button', { type: 'button', class: 'btn tonal small-btn' }, icon('wifi', 's18'), 'Testen');
    btn.onclick = async () => {
      btn.disabled = true;
      box.className = 'probe show';
      box.replaceChildren(h('span', { class: 'spinner' }), 'Teste …');
      try {
        fillProbe(box, await api('/api/admin/probe', { method: 'POST', body: { kind, ...getBody() } }), { selectedApi: kind === 'machine' ? value('machine.api') : undefined });
      } catch (e) {
        fillProbe(box, { ok: false, error: e.message });
      } finally {
        btn.disabled = false;
      }
    };
    return [btn, box];
  }

  // --- Seite ---
  function paint() {
    const s = data.status;
    savebar.hidden = Object.keys(dirty).length === 0;

    // Geräte
    const [mTest, mBox] = probeButton('machine', () => ({ url: value('machine.url') }));
    const [gTest, gBox] = probeButton('grinder', () => ({ url: value('grinder.url'), password: dirty['grinder.password'] || '' }));
    const grinderFields = h('div', { class: 'collapse', hidden: !value('grinder.enabled') },
      h('div', { class: 'field-row' }, text('Adresse der Mühle', 'grinder.url', { type: 'url', placeholder: 'https://192.168.178.54' }), gTest),
      gBox,
      gap(),
      text('Owner-Passwort der Mühle', 'grinder.password', { type: 'password', placeholder: data.secrets['grinder.password'] ? '•••••••• (gespeichert, leer = unverändert)' : 'nicht gesetzt', parse: (v) => v, autocomplete: 'new-password' }),
      h('div', { class: 'cert-row' },
        h('div', { class: 'grow' }, h('div', { class: 'small muted' }, 'Gemerktes Zertifikat der Mühle'),
          h('code', { class: 'fp' }, s.grinderPin || 'noch keins (wird beim ersten Kontakt gemerkt)')),
        s.grinderPin ? h('button', { class: 'btn text', onclick: unpin }, 'Vergessen') : null),
      toggle('Datenbank-Download erlauben', 'Die Datenbank der Mühle enthält das WLAN-Passwort im Klartext.', 'grinder.allowDatabaseDownload'));
    const devices = card('Geräte', 'coffee',
      apiChoice(value('machine.api') === 'classic' ? 'classic' : 'bbs', (v) => { change('machine.api', v); paint(); }),
      h('div', { class: 'field-row' }, text('Adresse der Xenia', 'machine.url', { type: 'url', placeholder: 'http://192.168.178.55' }), mTest),
      mBox,
      h('div', { class: 'divider' }),
      toggle('Mahlkönig-Mühle', 'E64 WS: Rezepte, Mahlvorgänge, Meldungen', 'grinder.enabled', { onChange: () => paint() }),
      grinderFields);

    // Von unterwegs (Cloudflare-Tunnel)
    const [tTest, tBox] = probeButton('tunnel', () => ({ url: value('publicUrl') }));
    const remote = card('Von unterwegs (Cloudflare-Tunnel)', 'cloud',
      h('div', { class: 'field-row' }, text('Öffentliche Adresse', 'publicUrl', { type: 'url', placeholder: 'https://xenios.deine-domain.de', parse: (v) => v.trim() || null, format: (v) => v || '' }), tTest),
      tBox,
      s.tunnel.httpEnabled ? null : warn('Der Tunnel-Port ist aus. Unten unter „Tunnel-Port (Cloudflare)“ einschalten, sonst erreicht cloudflared den Server nicht.'),
      s.tunnel.docker ? tunnelPaste(s.tunnel) : null,
      h('details', { class: 'adv', open: !data.values.publicUrl }, h('summary', {}, 'Anleitung', icon('more', 's20')), tunnelGuide(s.tunnel)));

    // Funktionen
    const features = card('Funktionen der App', 'tune',
      toggle('Paddle', 'Pumpe direkt steuern', 'features.paddle'),
      toggle('Skript-Editor', 'Skripte anlegen, ändern, löschen', 'features.scriptEditor'),
      toggle('Maschinen-Einstellungen', 'Temperaturen, Druck, Tastenbelegung ändern', 'features.settings'),
      toggle('Uhr stellen', 'Uhrzeit und Zeitzone der Maschine setzen', 'features.clockSync'));

    // Zeit
    const time = card('Zeit', 'clock',
      select('Zeitzone für Zeitplan und Wecker', 'timezone', [[null, `System (${s.timezone})`], ...data.timezones.map((t) => [t, t.replace(/_/g, ' ')])]),
      h('div', { class: 'small muted', style: { 'margin-top': '6px' } }, `Serverzeit: ${new Date(s.serverTime).toLocaleString('de-DE', { timeZone: s.timezone })}`));

    // Sicherheit
    const sessionsBox = h('div', { class: 'sessions' }, h('div', { class: 'muted small' }, 'Lade …'));
    const security = card('Anmeldung', 'shield',
      h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', {}, 'App-Passwort'), h('div', { class: 'small muted' }, 'scrypt-Hash; ändern meldet alle anderen Geräte ab')),
        h('button', { class: 'btn tonal', onclick: changePassword }, 'Ändern')),
      gap(),
      number('Angemeldet bleiben (Tage)', 'auth.sessionDays', 1, 365),
      h('div', { class: 'divider' }),
      h('h4', {}, 'Sicherung'),
      h('p', { class: 'small muted' }, 'ZIP mit Konfiguration, Bezügen, Zeitplänen und Schlüsseln. Enthält secret.key – wie ein Passwort aufbewahren.'),
      h('div', { class: 'row', style: { 'margin-top': '8px', 'flex-wrap': 'wrap' } },
        h('button', { type: 'button', class: 'btn tonal', onclick: downloadBackup }, icon('download', 's18'), 'Sichern'),
        h('button', { type: 'button', class: 'btn tonal', onclick: restoreBackup }, icon('upload', 's18'), 'Einspielen')),
      h('div', { class: 'divider' }),
      h('div', { class: 'row' }, h('h3', { class: 'grow', style: { margin: 0 } }, 'Angemeldete Geräte'),
        h('button', { class: 'btn text danger-text', onclick: revokeAll }, 'Alle abmelden')),
      sessionsBox);
    loadSessions(sessionsBox);

    // Zugänge & Verschlüsselung
    const httpHost = value('http.host');
    const listeners = h('div', { class: 'chips listener-chips' }, s.listeners.map((l) => h('span', { class: `chip status ${l.ok ? 'on' : l.error ? 'bad' : ''}`, title: l.error || '' },
      h('span', { class: 'dot' }), `${{ http: 'Tunnel', https: 'HTTPS', lan: 'Heimnetz-HTTP', gbs: 'Grind-by-Sync' }[l.kind]} :${l.port}`)));
    const tls = s.tls;
    const network = card('Zugänge & Verschlüsselung', 'wifi',
      listeners,
      h('p', { class: 'small muted' }, `Diese Seite: ${s.via.secure ? 'verschlüsselt (HTTPS)' : 'unverschlüsselt'} · IP ${s.via.ip}`),
      h('h4', {}, 'HTTPS im Heimnetz'),
      toggle('HTTPS', 'Selbstsigniertes Zertifikat (TLS 1.2+)', 'https.enabled'),
      h('div', { class: 'grid2' }, text('Adresse', 'https.host'), number('Port', 'https.port', 1, 65535)),
      gap(),
      text('Weitere Namen/IPs fürs Zertifikat', 'https.hosts', { placeholder: 'z. B. 192.168.178.32, xenia.fritz.box', parse: (v) => v.split(/[\s,;]+/).filter(Boolean), format: (v) => (v || []).join(', ') }),
      tls ? h('div', { class: 'cert' },
        h('div', { class: 'small muted' }, `Zertifikat gültig bis ${new Date(tls.validTo).toLocaleDateString('de-DE')} · ${tls.names.length} Namen`),
        h('code', { class: 'fp' }, tls.fingerprint),
        h('div', { class: 'small muted names' }, tls.names.join(' · ')),
        h('button', { class: 'btn text', onclick: renewCert }, icon('refresh', 's18'), 'Neu erzeugen')) : null,
      h('div', { class: 'divider' }),
      h('h4', {}, 'Tunnel-Port (Cloudflare)'),
      toggle('Tunnel-Port', 'Unverschlüsselt, nur für cloudflared – TLS macht Cloudflare', 'http.enabled'),
      h('div', { class: 'grid2' }, text('Adresse', 'http.host'), number('Port', 'http.port', 1, 65535)),
      !['127.0.0.1', '::1', 'localhost'].includes(httpHost) && !s.docker ? warn(`Der Tunnel-Port lauscht auf ${httpHost}: unverschlüsselt im ganzen Netz erreichbar. Empfohlen: 127.0.0.1.`) : null,
      select('Proxy-Header vertrauen von', 'trustProxy', [['loopback', 'nur diesem Rechner (cloudflared lokal)'], ['private', 'Heim-/Docker-Netz (cloudflared im Container)'], ['all', 'allen (nicht empfohlen)'], ['none', 'niemandem']]),
      h('div', { class: 'divider' }),
      h('h4', {}, 'Heimnetz-HTTP (optional)'),
      toggle('Unverschlüsseltes HTTP', 'Für die Android-App zu Hause ohne Zertifikat', 'lan.enabled'),
      h('div', { class: 'grid2' }, text('Adresse', 'lan.host'), number('Port', 'lan.port', 1, 65535)),
      value('lan.enabled') ? warn('Passwort und Sitzung gehen hier im Klartext durchs WLAN. Nur in einem vertrauenswürdigen Heimnetz nutzen.') : null);

    // Grind-by-Sync-Vermittler
    const urlIp = (() => {
      try {
        const host = new URL(value('grinder.url')).hostname.replace(/^\[|\]$/g, '');
        return /^[\d.]+$|:/.test(host) ? host : null;
      } catch { return null; }
    })();
    const gbsCard = card('Grind-by-Sync mit Druckprofilen', 'grinder',
      h('p', { class: 'small muted' }, 'Xenios gibt sich der Mühle gegenüber als Xenia aus und reicht alles an die echte Xenia weiter. Nur der Start per Drehknopf wird gegen das unter Skripte gewählte Profil getauscht; es stoppt wie das Original beim Zielgewicht des Mühlenrezepts.'),
      toggle('Vermittler', 'Unverschlüsselt und ohne Anmeldung, aber nur für die IP der Mühle', 'gbs.enabled'),
      h('div', { class: 'grid2' }, text('Adresse', 'gbs.host'), number('Port', 'gbs.port', 1, 65535)),
      gap(),
      text('IP der Mühle', 'gbs.grinderIp', { placeholder: urlIp ? `aus der Adresse der Mühle: ${urlIp}` : 'z. B. 192.168.178.54', parse: (v) => v.trim() || null, format: (v) => v || '' }),
      s.docker ? h('p', { class: 'small muted' }, `Im Container lauscht der Vermittler auf Port ${value('gbs.port')}. In compose.yaml die Zeile „80:${value('gbs.port')}“ aktivieren – die Mühle fragt immer Port 80 ab.`) : null,
      !s.docker && Number(value('gbs.port')) !== 80 ? warn('Die Mühle fragt immer Port 80 ab. Ein anderer Port geht nur mit einer Weiterleitung von 80 auf diesen Port.') : null,
      h('details', { class: 'adv' }, h('summary', {}, 'Mühle umstellen', icon('more', 's20')),
        h('ol', { class: 'small' },
          h('li', {}, 'Vermittler einschalten und speichern.'),
          h('li', {}, 'Am Display der Mühle (nicht in der Web-Oberfläche): unten links Settings → Connectivity → Machine To Machine → Xenia → Configuration.'),
          h('li', {}, 'Die Suche findet Xenios nicht: als Host die IP dieses Servers von Hand eintragen statt der IP der Xenia.'),
          h('li', {}, 'Unter Skripte das Profil für den Drehknopf wählen.')),
        h('p', { class: 'small muted' }, 'Läuft Xenios nicht, findet die Mühle keine Xenia. Zurück: in der Mühle wieder die IP der Xenia eintragen.')));


    // System
    const up = s.uptimeS;
    const uptime = up < 3600 ? `${Math.round(up / 60)} min` : up < 86400 ? `${Math.round(up / 3600)} h` : `${Math.round(up / 86400)} Tage`;
    const kv = (k, v) => [h('dt', {}, k), h('dd', {}, v)];
    const system = card('System', 'info',
      h('dl', { class: 'kv' },
        kv('Version', `Xenios ${s.version}`),
        kv('Node.js', s.node),
        kv('Läuft seit', uptime),
        kv('Umgebung', s.docker ? 'Docker' : 'direkt'),
        kv('Konfiguration', s.configFile),
        kv('Daten', s.dataDir),
        kv('Geheimnis-Schlüssel', { env: 'XENIOS_SECRET_KEY', 'file-env': 'XENIOS_SECRET_KEY_FILE', file: 'secret.key im Datenordner' }[s.secretKey])),
      gap(),
      updateBox,
      gap(),
      select('Protokoll-Stufe', 'logLevel', [['error', 'nur Fehler'], ['warn', 'Warnungen'], ['info', 'Normal'], ['debug', 'Ausführlich (Fehlersuche)']]));
    if (!updateReady) { updateReady = true; startUpdatePoll(); }

    body.replaceChildren(h('div', { class: 'stagger' }, devices, remote, features, time, security, network, value('grinder.enabled') && value('machine.api') !== 'classic' ? gbsCard : null, system));
  }

  async function loadSessions(box) {
    try {
      const { sessions } = await api('/api/sessions');
      box.replaceChildren(...sessions.map((x) => h('div', { class: `session ${x.current ? 'current' : ''}` },
        icon(/Android/.test(x.ua) ? 'grinder' : 'wifi', 's20 muted'),
        h('div', { class: 'grow' },
          h('div', {}, x.device || uaShort(x.ua), x.current ? h('span', { class: 'badge ok', style: { 'margin-left': '6px' } }, 'dieses Gerät') : null),
          h('div', { class: 'small muted' }, `${x.ip} · zuletzt ${ago(new Date(x.lastSeen).toISOString())}`)),
        h('button', { class: 'icon-btn', 'aria-label': 'Abmelden', title: 'Dieses Gerät abmelden', onclick: async (e) => {
          const row = e.currentTarget.closest('.session');
          if (!(await confirmDialog('Gerät abmelden?', `${x.device || uaShort(x.ua)} (${x.ip}) muss sich neu anmelden.`, 'Abmelden', 'danger'))) return;
          try {
            const r = await api(`/api/sessions/${encodeURIComponent(x.id)}`, { method: 'DELETE' });
            if (r.self) return logout();
            row.classList.add('leaving');
            setTimeout(() => row.remove(), 280);
          } catch (ex) { snackbar(ex.message); }
        } }, icon('close', 's20')))));
    } catch (e) {
      box.replaceChildren(h('div', { class: 'muted small' }, e.message));
    }
  }

  async function downloadBackup() {
    try {
      const res = await api('/api/admin/backup', { raw: true });
      const blob = await res.blob();
      const m = /filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') || '');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = m?.[1] || 'xenios-backup.zip';
      a.click();
      URL.revokeObjectURL(a.href);
      snackbar('Sicherung heruntergeladen');
    } catch (e) { snackbar(e.message); }
  }

  async function restoreBackup() {
    const input = h('input', { type: 'file', accept: '.zip,application/zip' });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!(await confirmDialog(
        'Sicherung einspielen?',
        'Ersetzt Konfiguration, Bezüge, Zeitpläne und Schlüssel durch die Datei. Das App-Passwort wird das aus der Sicherung. Diese Sitzung bleibt angemeldet.',
        'Einspielen',
        'danger',
      ))) return;
      try {
        await api('/api/admin/backup', { method: 'POST', body: await file.arrayBuffer(), binary: true });
        snackbar('Sicherung eingespielt');
        for (const k of Object.keys(dirty)) delete dirty[k];
        savebar.hidden = true;
        await load();
        refreshState().catch(() => {});
      } catch (e) { snackbar(e.message); }
    });
    input.click();
  }

  async function revokeAll() {
    if (!(await confirmDialog('Alle Geräte abmelden?', 'Alle angemeldeten Geräte (auch dieses und die Android-Widgets) müssen sich neu anmelden.', 'Alle abmelden', 'danger'))) return;
    await api('/api/sessions/revoke-all', { method: 'POST' }).catch(() => {});
    logout();
  }

  function changePassword() {
    const cur = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    const next = h('input', { type: 'password', autocomplete: 'new-password', minlength: 10, required: true });
    const next2 = h('input', { type: 'password', autocomplete: 'new-password', required: true });
    const err = h('p', { class: 'error', role: 'alert' });
    const ok = h('button', { class: 'btn filled wide', type: 'submit' }, 'Passwort ändern');
    const form = h('form', { class: 'stack' },
      h('label', { class: 'field' }, h('span', {}, 'Aktuelles Passwort'), cur),
      h('label', { class: 'field' }, h('span', {}, 'Neues Passwort (mind. 10 Zeichen)'), next),
      h('label', { class: 'field' }, h('span', {}, 'Neues Passwort wiederholen'), next2),
      revealToggle([cur, next, next2]),
      h('p', { class: 'small muted' }, 'Alle anderen Geräte (auch Android-Widgets) werden abgemeldet.'),
      err, ok);
    const close = sheet('App-Passwort ändern', form);
    setTimeout(() => cur.focus(), 260);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      if (next.value !== next2.value) { err.textContent = 'Neue Passwörter stimmen nicht überein'; return shake(next2); }
      ok.disabled = true;
      try {
        await api('/api/admin/password', { method: 'POST', body: { current: cur.value, next: next.value } });
        close();
        snackbar('Passwort geändert, andere Geräte abgemeldet');
        load();
      } catch (ex) {
        err.textContent = ex.message;
        shake(form);
      } finally {
        ok.disabled = false;
      }
    });
  }

  async function unpin() {
    if (!(await confirmDialog('Zertifikat vergessen?', 'Nur tun, wenn die Mühle neu eingerichtet, getauscht oder per Firmware-Update aktualisiert wurde. Beim nächsten Kontakt wird das dann gesendete Zertifikat gemerkt.', 'Vergessen', 'danger'))) return;
    try {
      data = await api('/api/admin/grinder/unpin', { method: 'POST' });
      paint();
      snackbar('Zertifikat vergessen');
    } catch (e) { snackbar(e.message); }
  }

  async function renewCert() {
    if (!(await confirmDialog('Zertifikat neu erzeugen?', 'Browser und Android-App zeigen danach einmal eine neue Zertifikatswarnung.', 'Neu erzeugen'))) return;
    try {
      data = await api('/api/admin/tls/renew', { method: 'POST' });
      paint();
      snackbar('Neues Zertifikat aktiv');
    } catch (e) { snackbar(e.message); }
  }

  load();
  return () => { clearTimeout(updatePoll); savebar.remove(); };
}

function uaShort(ua = '') {
  if (/Android-App/.test(ua)) return 'Android-App';
  if (/Android/.test(ua)) return 'Android' + (/Chrome/.test(ua) ? ' · Chrome' : '');
  if (/iPhone|iPad/.test(ua)) return 'iOS';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS/.test(ua)) return 'Mac';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Gerät';
}
