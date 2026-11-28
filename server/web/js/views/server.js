// Einstellungen, die auf dem Server liegen (config.json, sofort wirksam). Jede Unterseite der Einstellungen zeigt
// einen Teil davon: Modell & Aussehen, Mühle & Grind-by-Sync, Von unterwegs, Benachrichtigungen, Sicherheit, System.
import { h, icon, snackbar, switchEl, sheet, confirmDialog, ago } from '../ui.js';
import { api, refreshState } from '../api.js';
import { logout } from '../app.js';
import { paintPush, deviceFolds } from './settings.js';
import { fillProbe, revealToggle, shake, tunnelGuide, apiChoice } from '../setup.js';
import { t, locale } from '../../shared/i18n.js';

const LOCK_HINT = () => t('settings.server.lockHint');

// Text mit Platzhaltern wie {cmd} in Knoten zerlegen und an diesen Stellen Elemente (z. B. <code>) einsetzen
const withNodes = (text, nodes) => text.split(/\{(\w+)\}/).map((part, i) => (i % 2 ? nodes[part] ?? `{${part}}` : part));

// Funktionen ein-/ausschalten: gilt auf dem Server für alle Geräte
const FEATURES = () => [
  ['features.paddle', t('settings.features.paddle'), t('settings.features.paddleSub')],
  ['features.scriptEditor', t('settings.features.scriptEditor'), t('settings.features.scriptEditorSub')],
  ['features.settings', t('settings.features.settings'), t('settings.features.settingsSub')],
  ['features.clockSync', t('settings.features.clockSync'), t('settings.features.clockSyncSub')],
];

// part: 'modell' | 'muehle' | 'unterwegs' | 'benachrichtigungen' | 'sicherheit' | 'system'
export const serverPage = (part) => (root) => {
  let data = null;
  const dirty = {};
  const body = h('div', {}, h('div', { class: 'empty' }, h('span', { class: 'spinner' }), ' ' + t('settings.server.loading')));
  const saveBtn = h('button', { class: 'btn filled', onclick: save }, icon('check', 's18'), t('common.save'));
  const savebar = h('div', { class: 'savebar', hidden: true, role: 'region', 'aria-label': t('settings.server.unsaved') },
    h('span', { class: 'savebar-text' }, t('settings.server.unsaved')),
    h('button', { class: 'btn text', onclick: () => { for (const k of Object.keys(dirty)) delete dirty[k]; paint(); } }, t('settings.server.discard')),
    saveBtn);
  root.append(body, savebar);

  const updateBox = h('div');
  let updatePoll = null;
  let updateReady = false;
  function paintUpdate(u) {
    const job = u.job || {};
    // Angefordert, aber kein Update-Dienst holt die Anforderung ab: nicht endlos „holt die neue Version …“ zeigen
    const stuck = job.state === 'queued' && !u.helper;
    const pending = !stuck && (job.state === 'queued' || job.state === 'running');
    const line = h('div', { class: 'small' },
      t('settings.update.installed', { version: u.current || data?.status?.version || '–' }),
      u.latest ? (u.newer ? t('settings.update.newer', { version: u.latest }) : t('settings.update.current')) : null,
      u.latestError ? h('span', { class: 'muted' }, ` · ${u.latestError}`) : null);
    const cancel = h('button', { type: 'button', class: 'btn text', onclick: cancelUpdate }, t('settings.update.cancel'));
    const progress = stuck
      ? h('div', {}, h('div', { class: 'note warn' }, icon('warn', 's18'), h('span', {}, t('settings.update.stuck'))), cancel)
      : pending
      ? h('p', { class: 'muted small' }, h('span', { class: 'spinner' }), job.state === 'queued'
        ? ' ' + t('settings.update.queued')
        : ' ' + t('settings.update.running'))
      : job.state === 'error' ? h('div', { class: 'note warn' }, icon('warn', 's18'), h('span', {}, job.error || t('settings.update.failed')))
      : job.state === 'ok' && job.version ? h('p', { class: 'small' }, t('settings.update.done', { version: job.version })) : null;
    const btn = h('button', { type: 'button', class: 'btn tonal', disabled: pending || stuck || !u.helper, onclick: requestUpdate },
      icon('refresh', 's18'), u.newer && u.latest ? t('settings.update.updateTo', { version: u.latest }) : t('settings.update.update'));
    // Update-Dienst: Docker (install.sh) oder ohne Docker als systemd-Dienst (native-update.sh)
    const native = u.helperMode === 'native' || (!u.helper && u.docker === false);
    const hint = u.helper
      ? h('p', { class: 'small muted' }, native
        ? t('settings.update.hintNative')
        : t('settings.update.hintDocker'))
      : native
      ? h('div', { class: 'small muted' },
        h('p', {}, t('settings.update.noHelperNative')),
        h('pre', { class: 'hint-code' }, 'curl -fsSL https://raw.githubusercontent.com/TimS1998/Xenios/main/native-update.sh | sudo sh -s -- --setup'),
        h('p', {}, ...withNodes(t('settings.update.otherService'), { service: h('code', {}, '… --setup --service <name>'), update: h('code', {}, 'sudo xenios-update') })))
      : h('div', { class: 'small muted' },
        h('p', {}, t('settings.update.noHelperDocker')),
        h('pre', { class: 'hint-code' }, 'sh ~/xenios/install.sh --update'),
        h('p', {}, ...withNodes(t('settings.update.withoutInstall'), { cmd: h('code', {}, 'curl -fsSL https://raw.githubusercontent.com/TimS1998/Xenios/main/install.sh | sh') })));
    updateBox.replaceChildren(h('div', { class: 'divider' }), h('div', {}, t('settings.update.title')), line, progress, h('div', { class: 'row', style: { 'margin-top': '8px' } }, btn), hint);
  }
  async function refreshUpdate() {
    try {
      const u = await api('/api/admin/update');
      paintUpdate(u);
      return u.job?.state === 'running' || (u.job?.state === 'queued' && u.helper);
    } catch {
      updateBox.replaceChildren(h('p', { class: 'muted small' }, h('span', { class: 'spinner' }), ' ' + t('settings.update.reconnecting')));
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
  async function cancelUpdate() {
    try {
      paintUpdate(await api('/api/admin/update', { method: 'DELETE' }));
      snackbar(t('settings.update.cancelled'));
    } catch (e) { snackbar(e.message); }
  }
  async function requestUpdate() {
    if (!(await confirmDialog(
      t('settings.update.confirmTitle'),
      t('settings.update.confirmText'),
      t('settings.update.update'),
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

  // Sprung von außen (z. B. „Ansicht ändern“ unter Schalter, …#aussehen): Karte nach dem ersten Zeichnen in den Blick
  // holen und kurz hervorheben, danach die Marke aus der Adresse nehmen
  let anchor = location.hash.slice(1);
  function reveal() {
    if (!anchor) return;
    const el = body.querySelector(`[data-anchor="${anchor}"]`);
    anchor = '';
    history.replaceState(history.state, '', location.pathname);
    if (el?.tagName === 'DETAILS') { el.open = true; foldOpen.set('look', true); }
    if (el) setTimeout(() => { el.scrollIntoView({ block: 'start', behavior: 'smooth' }); el.classList.add('flash'); }, 350);
  }

  async function load() {
    try {
      data = await api('/api/admin/config');
      paint();
      reveal();
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
      const features = keys.some((k) => k.startsWith('features.'));
      refreshState().catch(() => {}).then(() => {
        // Leiste und Tabs neu: ausgeschaltete Funktionen blenden ihre Seiten aus
        if (features) window.dispatchEvent(new CustomEvent('xenios-prefs', { detail: 'features' }));
      });
      snackbar(listener ? t('settings.server.savedRestart') : t('settings.server.saved'));
    } catch (e) {
      snackbar(e.message);
      shake(savebar);
    } finally {
      saveBtn.disabled = false;
    }
  }

  // --- Bausteine ---
  const lockNote = (p) => (locked(p) ? h('span', { class: 'lock-note' }, icon('shield', 's18'), LOCK_HINT()) : null);
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
    const sel = h('select', { class: 'text', disabled: locked(p) }, options.map(([v, txt]) => h('option', { value: v ?? '', selected: (value(p) ?? '') === (v ?? '') }, txt)));
    sel.addEventListener('change', () => change(p, sel.value === '' ? null : sel.value));
    return h('label', { class: 'field' }, h('span', {}, label, lockNote(p)), sel);
  }
  // Karte mit Kopfzeile; jede Unterseite hat nur wenige, deshalb offen statt eingeklappt
  const card = (head, ic, ...kids) => {
    const { title, badge, anchor: id } = typeof head === 'string' ? { title: head } : head;
    return h('section', { class: 'card setting-card', 'data-anchor': id },
      h('div', { class: 'card-head' }, icon(ic, 's20'), h('h3', { class: 'grow' }, title), badge || null),
      ...kids.filter(Boolean));
  };
  // Einklappbarer Bereich, der sein Auf/Zu beim Neuzeichnen (nach jeder Änderung) behält
  const foldOpen = new Map();
  const sfold = ({ id, title, anchor, open = false }, ic, ...kids) => {
    const el = h('details', { class: 'card fold', 'data-anchor': anchor, open: foldOpen.get(id) ?? open },
      h('summary', {}, icon(ic, 's20'), h('span', { class: 'grow' }, title), icon('more', 's20 chev')),
      h('div', { class: 'fold-body' }, ...kids.filter(Boolean)));
    el.addEventListener('toggle', () => foldOpen.set(id, el.open));
    return el;
  };
  // Wi-Fi und Firmware unter „Modell, Aussehen & Firmware“: einmal laden, beim Neuzeichnen dieselben Elemente
  let devFolds = null;
  const gap = () => h('div', { class: 'gap' });
  const warn = (txt) => h('div', { class: 'note warn' }, icon('warn', 's18'), h('span', {}, txt));

  function tunnelPaste(tunnel) {
    const input = h('textarea', { class: 'text', rows: 3, spellcheck: 'false', autocomplete: 'off', placeholder: 'sudo cloudflared service install …' });
    const note = h('p', { class: 'error', role: 'alert' });
    const btn = h('button', { type: 'button', class: 'btn tonal' }, t('settings.tunnelPaste.apply'));
    btn.onclick = async () => {
      btn.disabled = true;
      note.textContent = '';
      try {
        await api('/api/admin/tunnel-token', { method: 'POST', body: { token: input.value } });
        input.value = '';
        snackbar(t('settings.tunnelPaste.applied'));
      } catch (e) {
        note.textContent = e.message;
        shake(input);
      } finally {
        btn.disabled = false;
      }
    };
    return h('div', { style: { 'margin-top': '12px' } },
      h('label', { class: 'field' }, h('span', {}, t('settings.tunnelPaste.label')), input),
      h('div', { class: 'row', style: { 'margin-top': '8px' } }, btn),
      note,
      tunnel.helper
        ? h('p', { class: 'muted small' }, t('settings.tunnelPaste.hintHelper'))
        : h('p', { class: 'muted small' }, ...withNodes(t('settings.tunnelPaste.hintManual'), { cmd: h('code', {}, 'sh install.sh') })));
  }

  function probeButton(kind, getBody) {
    const box = h('div', { class: 'probe', 'aria-live': 'polite' });
    const btn = h('button', { type: 'button', class: 'btn tonal small-btn' }, icon('wifi', 's18'), t('settings.server.test'));
    btn.onclick = async () => {
      btn.disabled = true;
      box.className = 'probe show';
      box.replaceChildren(h('span', { class: 'spinner' }), t('settings.server.testing'));
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

  // --- Seiten ---
  // Modell, Adresse und Aussehen der Xenia
  function modelCards() {
    const [mTest, mBox] = probeButton('machine', () => ({ url: value('machine.url') }));
    const connection = sfold({ id: 'model', title: t('settings.model.connection'), open: true }, 'coffeeLine',
      apiChoice(value('machine.api') === 'classic' ? 'classic' : 'bbs', (v) => { change('machine.api', v); paint(); }),
      h('div', { class: 'field-row' }, text(t('settings.model.address'), 'machine.url', { type: 'url', placeholder: 'http://192.168.178.55' }), mTest),
      mBox);
    // Aussehen der Xenia für die Frontansicht unter „Schalter“: Ansicht, Farben (Vorlagen oder eigene) und Ausstattung
    // Reihe mit Beschriftung; Farbreihe: Vorlagen, optional „Wie Gehäuse“ (Wert null) und „Eigene“ mit Farbwähler
    const row = (label, ...kids) => h('div', { class: 'look-row' }, h('div', { class: 'small muted' }, label), ...kids);
    const pick = (label, key, options, current) => h('div', { class: 'chips', role: 'radiogroup', 'aria-label': label },
      options.map(([v, text]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(current === v), onclick: () => { change(key, v); paint(); } }, text)));
    const colorRow = (label, key, presets, { fallback, same } = {}) => {
      const cur = value(key) || null;
      const shown = cur || fallback;
      const input = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(shown || '') ? shown : '#c98a4f', 'aria-label': t('settings.model.ownColorAria', { label }) });
      input.addEventListener('change', () => { change(key, input.value); paint(); });
      const own = Boolean(cur) && !presets.some(([c]) => c === cur);
      return row(label, h('div', { class: 'chips', role: 'radiogroup', 'aria-label': label },
        same ? h('button', { type: 'button', class: 'chip', 'aria-pressed': String(!cur), onclick: () => { change(key, null); paint(); } }, same) : null,
        presets.map(([c, text, swatch]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String((same ? cur : shown) === c), onclick: () => { change(key, c); paint(); } },
          h('span', { class: 'swatch', style: { background: swatch || c } }), text)),
        h('label', { class: 'chip color-chip', 'aria-pressed': String(own) }, input, t('settings.model.ownColor'))));
    };
    // Auswahl je nach gesteuerter Maschine, nur was es zu kaufen gibt bzw. gab. Alte Xenia (DBL, Xenia Espresso):
    // Gehäuse Schwarz, Anthrazit, Weiß (eloxal mit Glimmereffekt), Edelstahl satiniert/spiegelnd, Rot (eloxal), Rost; ein
    // Gitter über die ganze Abtropfschale (Edelstahl, Schwarz, Weiß); Griffe Kunststoff schwarz (Standard) oder Holz
    // (Olive, Eiche, Nuss, Kirsche, Grenadill, schwarze Esche); Manometer schwarz oder weiß. Neue Xenia (Mahlkönig,
    // Brew-by-Sync): Gehäuse Mattschwarz, sonst RAL über „Eigene“; Griffe Original ohne Holz,
    // Eiche, Nuss, Olive, Eiche schwarz gebeizt; Abtropfschale und Manometer (schwarz) ohne Auswahl.
    const dbl = value('machine.api') === 'classic';
    const BODY = dbl
      ? [['#26272b', t('settings.model.colors.black')], ['#3a3d42', t('settings.model.colors.anthracite')], ['#f2f1ee', t('settings.model.colors.white')], ['#c4c7cb', t('settings.model.colors.steelSatin')], ['#e3e6e9', t('settings.model.colors.steelMirror')],
        ['#9e1f24', t('settings.model.colors.red')], ['#8a4a2b', t('settings.model.colors.rust')]]
      : [['#26272b', t('settings.model.colors.matteBlack')]];
    const TRAY = [['#c4c7cb', t('settings.model.colors.steel')], ['#26272b', t('settings.model.colors.black')], ['#f2f1ee', t('settings.model.colors.white')]];
    const GRIP = dbl
      ? [['#1d1e21', t('settings.model.colors.plasticBlack')], ['#e0aa6a', t('settings.model.colors.olive')], ['#c49a6c', t('settings.model.colors.oak')], ['#6e4127', t('settings.model.colors.walnut')], ['#9b4e2f', t('settings.model.colors.cherry')], ['#4a3128', t('settings.model.colors.grenadill')], ['#2b2624', t('settings.model.colors.blackAsh')]]
      : [['chrome', t('settings.model.colors.chrome'), 'linear-gradient(90deg, #7d8186, #f4f6f8, #8a8e93)'], ['#c49a6c', t('settings.model.colors.oak')], ['#6e4127', t('settings.model.colors.walnut')], ['#e0aa6a', t('settings.model.colors.olive')], ['#2e2a27', t('settings.model.colors.oakBlack')]];
    const GAUGE = [['#141518', t('settings.model.colors.black')], ['#f4f4f1', t('settings.model.colors.white')]];
    const simple = value('machine.look.style') === 'simple';
    const look = sfold({ id: 'look', title: t('settings.model.look'), anchor: 'aussehen' }, 'palette',
      h('p', { class: 'small muted' }, t('settings.model.lookHint')),
      pick(t('settings.model.view'), 'machine.look.style', [['render', t('settings.model.render')], ['simple', t('settings.model.simple')]], simple ? 'simple' : 'render'),
      simple ? null : h('div', { class: 'look-pick' },
        colorRow(t('settings.model.body'), 'machine.look.color', BODY, { fallback: BODY[0][0] }),
        dbl ? colorRow(t('settings.model.tray'), 'machine.look.tray', TRAY, { fallback: TRAY[0][0] }) : null,
        colorRow(t('settings.model.grip'), 'machine.look.grip', GRIP, { fallback: dbl ? GRIP[0][0] : 'chrome' }),
        dbl ? colorRow(t('settings.model.gauge'), 'machine.look.gauge', GAUGE, { fallback: GAUGE[0][0] }) : null,
        row(t('settings.model.steamWand'), pick(t('settings.model.steamWand'), 'machine.look.steamSide', [['left', t('settings.model.left')], ['right', t('settings.model.right')]], value('machine.look.steamSide') === 'right' ? 'right' : 'left')),
        dbl ? row(t('settings.model.valves'), pick(t('settings.model.valves'), 'machine.look.valves', [['lever', t('settings.model.lever')], ['rotary', t('settings.model.rotary')]], value('machine.look.valves') === 'rotary' ? 'rotary' : 'lever')) : null),
      toggle(t('settings.model.editButton'), t('settings.model.editButtonSub'), 'machine.look.editButton'));
    devFolds ||= deviceFolds();
    return [connection, look, ...devFolds];
  }

  // Mühle und Grind-by-Sync-Vermittler
  function grinderCards() {
    const s = data.status;
    const [gTest, gBox] = probeButton('grinder', () => ({ url: value('grinder.url'), password: dirty['grinder.password'] || '' }));
    const grinder = card(t('settings.grinder.card'), 'grinder',
      toggle(t('settings.grinder.enable'), t('settings.grinder.enableSub'), 'grinder.enabled', { onChange: () => paint() }),
      value('grinder.enabled') ? h('div', { class: 'collapse' },
        h('div', { class: 'divider' }),
        h('div', { class: 'field-row' }, text(t('settings.grinder.address'), 'grinder.url', { type: 'url', placeholder: 'https://192.168.178.54' }), gTest),
        gBox,
        gap(),
        text(t('settings.grinder.password'), 'grinder.password', { type: 'password', placeholder: data.secrets['grinder.password'] ? t('settings.grinder.passwordStored') : t('settings.grinder.passwordUnset'), parse: (v) => v, autocomplete: 'new-password' }),
        h('div', { class: 'cert-row' },
          h('div', { class: 'grow' }, h('div', { class: 'small muted' }, t('settings.grinder.cert')),
            h('code', { class: 'fp' }, s.grinderPin || t('settings.grinder.certNone'))),
          s.grinderPin ? h('button', { class: 'btn text', onclick: unpin }, t('settings.grinder.forget')) : null),
        toggle(t('settings.grinder.dbDownload'), t('settings.grinder.dbDownloadSub'), 'grinder.allowDatabaseDownload')) : null);
    if (!value('grinder.enabled')) return [grinder];

    const urlIp = (() => {
      try {
        const host = new URL(value('grinder.url')).hostname.replace(/^\[|\]$/g, '');
        return /^[\d.]+$|:/.test(host) ? host : null;
      } catch { return null; }
    })();
    const gbs = card(t('settings.gbs.card'), 'speed',
      h('p', { class: 'small muted' }, value('machine.api') === 'classic'
        ? t('settings.gbs.hintClassic')
        : t('settings.gbs.hint')),
      toggle(t('settings.gbs.proxy'), t('settings.gbs.proxySub'), 'gbs.enabled'),
      h('div', { class: 'grid2' }, text(t('settings.server.address'), 'gbs.host'), number(t('settings.server.port'), 'gbs.port', 1, 65535)),
      gap(),
      text(t('settings.gbs.grinderIp'), 'gbs.grinderIp', { placeholder: urlIp ? t('settings.gbs.grinderIpFromUrl', { ip: urlIp }) : t('settings.gbs.grinderIpExample'), parse: (v) => v.trim() || null, format: (v) => v || '' }),
      s.docker ? h('p', { class: 'small muted' }, t('settings.gbs.docker', { port: value('gbs.port') })) : null,
      !s.docker && Number(value('gbs.port')) !== 80 ? warn(t('settings.gbs.port80')) : null,
      h('details', { class: 'adv' }, h('summary', {}, t('settings.gbs.switchTitle'), icon('more', 's20')),
        h('ol', { class: 'small' },
          h('li', {}, t('settings.gbs.step1')),
          h('li', {}, t('settings.gbs.step2')),
          h('li', {}, t('settings.gbs.step3')),
          h('li', {}, t('settings.gbs.step4'))),
        h('p', { class: 'small muted' }, t('settings.gbs.back'))));
    return [grinder, gbs];
  }

  // Von unterwegs (Cloudflare-Tunnel): ein Schalter, alles Weitere nur, solange er an ist
  function remoteCards() {
    const s = data.status;
    const [tTest, tBox] = probeButton('tunnel', () => ({ url: value('publicUrl') }));
    const httpHost = value('http.host');
    const tunnelOn = Boolean(value('http.enabled'));
    return [card({ title: t('settings.remote.card'), badge: h('span', { class: `badge ${tunnelOn ? 'ok' : ''}` }, tunnelOn ? t('settings.remote.on') : t('settings.remote.off')) }, 'cloud',
      toggle(t('settings.remote.toggle'), tunnelOn ? t('settings.remote.toggleOn') : t('settings.remote.toggleOff'), 'http.enabled', { onChange: () => paint() }),
      tunnelOn ? h('div', { class: 'collapse' },
        h('div', { class: 'divider' }),
        h('div', { class: 'field-row' }, text(t('settings.remote.publicUrl'), 'publicUrl', { type: 'url', placeholder: 'https://xenios.example.de', parse: (v) => v.trim() || null, format: (v) => v || '' }), tTest),
        tBox,
        s.tunnel.docker ? tunnelPaste(s.tunnel) : null,
        h('details', { class: 'adv', open: !data.values.publicUrl }, h('summary', {}, t('settings.remote.guide'), icon('more', 's20')), tunnelGuide(s.tunnel)),
        h('details', { class: 'adv' }, h('summary', {}, t('settings.remote.portAdvanced'), icon('more', 's20')),
          h('p', { class: 'muted small' }, t('settings.remote.portHint')),
          h('div', { class: 'grid2' }, text(t('settings.server.address'), 'http.host'), number(t('settings.server.port'), 'http.port', 1, 65535)),
          !['127.0.0.1', '::1', 'localhost'].includes(httpHost) && !s.docker ? warn(t('settings.remote.portWarn', { host: httpHost })) : null,
          select(t('settings.remote.trustProxy'), 'trustProxy', [['loopback', t('settings.remote.trustLoopback')], ['private', t('settings.remote.trustPrivate')], ['all', t('settings.remote.trustAll')], ['none', t('settings.remote.trustNone')]]))) : null)];
  }

  // Push-Benachrichtigungen dieses Geräts (der Server verschickt sie)
  function notifyCards() {
    const pushBox = h('div', {});
    paintPush(pushBox);
    return [card(t('settings.push.card'), 'bell', pushBox)];
  }

  // Anmeldung, angemeldete Geräte, Zugänge & Verschlüsselung, Funktionen sperren
  function securityCards() {
    const s = data.status;
    const sessionsBox = h('div', { class: 'sessions' }, h('div', { class: 'muted small' }, t('settings.machine.loading')));
    const login = card(t('settings.security.login'), 'shield',
      h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', {}, t('settings.security.appPassword')), h('div', { class: 'small muted' }, t('settings.security.appPasswordSub'))),
        h('button', { class: 'btn tonal', onclick: changePassword }, t('settings.security.change'))),
      gap(),
      number(t('settings.security.sessionDays'), 'auth.sessionDays', 1, 365),
      h('div', { class: 'divider' }),
      h('div', { class: 'row' }, h('h4', { class: 'grow', style: { margin: 0 } }, t('settings.security.devices')),
        h('button', { class: 'btn text danger-text', onclick: revokeAll }, t('settings.security.revokeAll'))),
      sessionsBox);
    loadSessions(sessionsBox);

    const listeners = h('div', { class: 'chips listener-chips' }, s.listeners.map((l) => h('span', { class: `chip status ${l.ok ? 'on' : l.error ? 'bad' : ''}`, title: l.error || '' },
      h('span', { class: 'dot' }), `${{ http: t('settings.security.listenerKinds.http'), https: t('settings.security.listenerKinds.https'), lan: t('settings.security.listenerKinds.lan'), gbs: t('settings.security.listenerKinds.gbs') }[l.kind]} :${l.port}`)));
    const tls = s.tls;
    const network = card(t('settings.security.network'), 'wifi',
      listeners,
      h('p', { class: 'small muted' }, t('settings.security.thisPage', { state: s.via.secure ? t('settings.security.encrypted') : t('settings.security.unencrypted'), ip: s.via.ip })),
      h('h4', {}, t('settings.security.httpsTitle')),
      toggle('HTTPS', t('settings.security.httpsSub'), 'https.enabled'),
      h('div', { class: 'grid2' }, text(t('settings.server.address'), 'https.host'), number(t('settings.server.port'), 'https.port', 1, 65535)),
      gap(),
      text(t('settings.security.certHosts'), 'https.hosts', { placeholder: t('settings.security.certHostsExample'), parse: (v) => v.split(/[\s,;]+/).filter(Boolean), format: (v) => (v || []).join(', ') }),
      tls ? h('div', { class: 'cert' },
        h('div', { class: 'small muted' }, t('settings.security.certValid', { date: new Date(tls.validTo).toLocaleDateString(locale()), n: tls.names.length })),
        h('code', { class: 'fp' }, tls.fingerprint),
        h('div', { class: 'small muted names' }, tls.names.join(' · ')),
        h('button', { class: 'btn text', onclick: renewCert }, icon('refresh', 's18'), t('settings.security.renew'))) : null,
      h('div', { class: 'divider' }),
      h('h4', {}, t('settings.security.lanTitle')),
      toggle(t('settings.security.lan'), t('settings.security.lanSub'), 'lan.enabled'),
      h('div', { class: 'grid2' }, text(t('settings.server.address'), 'lan.host'), number(t('settings.server.port'), 'lan.port', 1, 65535)),
      value('lan.enabled') ? warn(t('settings.security.lanWarn')) : null);

    const features = card(t('settings.security.features'), 'tune',
      h('p', { class: 'small muted' }, t('settings.security.featuresHint')),
      ...FEATURES().map(([key, title, sub]) => toggle(title, sub, key)));
    return [login, network, features];
  }

  // Version, Aktualisierung, Protokoll, Zeit, Sicherung
  function systemCards() {
    const s = data.status;
    const up = s.uptimeS;
    const uptime = up < 3600 ? `${Math.round(up / 60)} min` : up < 86400 ? `${Math.round(up / 3600)} h` : t('settings.system.uptimeDays', { n: Math.round(up / 86400) });
    const kv = (k, v) => [h('dt', {}, k), h('dd', {}, v)];
    const system = card(t('settings.system.server'), 'info',
      h('dl', { class: 'kv' },
        kv(t('settings.system.version'), t('settings.system.versionValue', { version: s.version })),
        kv('Node.js', s.node),
        kv(t('settings.system.uptime'), uptime),
        kv(t('settings.system.environment'), s.docker ? 'Docker' : t('settings.system.envDirect')),
        kv(t('settings.system.config'), s.configFile),
        kv(t('settings.system.data'), s.dataDir),
        kv(t('settings.system.secretKey'), { env: 'XENIOS_SECRET_KEY', 'file-env': 'XENIOS_SECRET_KEY_FILE', file: t('settings.system.secretKeyFile') }[s.secretKey])),
      gap(),
      updateBox,
      gap(),
      select(t('settings.system.logLevel'), 'logLevel', [['error', t('settings.system.logError')], ['warn', t('settings.system.logWarn')], ['info', t('settings.system.logInfo')], ['debug', t('settings.system.logDebug')]]));
    if (!updateReady) { updateReady = true; startUpdatePoll(); }
    const time = card(t('settings.system.time'), 'clock',
      select(t('settings.system.timezone'), 'timezone', [[null, t('settings.system.timezoneSystem', { tz: s.timezone })], ...data.timezones.map((tz) => [tz, tz.replace(/_/g, ' ')])]),
      h('div', { class: 'small muted', style: { 'margin-top': '6px' } }, t('settings.system.serverTime', { time: new Date(s.serverTime).toLocaleString(locale(), { timeZone: s.timezone }) })));
    const backup = card(t('settings.backup.card'), 'download',
      h('p', { class: 'small muted' }, t('settings.backup.hint')),
      h('div', { class: 'row', style: { 'margin-top': '8px', 'flex-wrap': 'wrap' } },
        h('button', { type: 'button', class: 'btn tonal', onclick: downloadBackup }, icon('download', 's18'), t('settings.backup.download')),
        h('button', { type: 'button', class: 'btn tonal', onclick: restoreBackup }, icon('upload', 's18'), t('settings.backup.restore'))));
    return [system, time, backup];
  }

  const PARTS = { modell: modelCards, muehle: grinderCards, unterwegs: remoteCards, benachrichtigungen: notifyCards, sicherheit: securityCards, system: systemCards };
  function paint() {
    savebar.hidden = Object.keys(dirty).length === 0;
    body.replaceChildren(h('div', { class: 'folds' }, ...PARTS[part]()));
  }

  async function loadSessions(box) {
    try {
      const { sessions } = await api('/api/sessions');
      box.replaceChildren(...sessions.map((x) => h('div', { class: `session ${x.current ? 'current' : ''}` },
        icon(/Android/.test(x.ua) ? 'grinder' : 'wifi', 's20 muted'),
        h('div', { class: 'grow' },
          h('div', {}, x.device || uaShort(x.ua), x.current ? h('span', { class: 'badge ok', style: { 'margin-left': '6px' } }, t('settings.security.thisDevice')) : null),
          h('div', { class: 'small muted' }, t('settings.security.lastSeen', { ip: x.ip, ago: ago(new Date(x.lastSeen).toISOString()) }))),
        h('button', { class: 'icon-btn', 'aria-label': t('settings.security.logout'), title: t('settings.security.logoutDevice'), onclick: async (e) => {
          const row = e.currentTarget.closest('.session');
          if (!(await confirmDialog(t('settings.security.logoutTitle'), t('settings.security.logoutText', { device: x.device || uaShort(x.ua), ip: x.ip }), t('settings.security.logout'), 'danger'))) return;
          try {
            const r = await api(`/api/sessions/${encodeURIComponent(x.id)}`, { method: 'DELETE' });
            if (r.self) return logout();
            row.remove(); // blendet wie überall aus und klappt zusammen (motion.js)
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
      snackbar(t('settings.backup.downloaded'));
    } catch (e) { snackbar(e.message); }
  }

  async function restoreBackup() {
    const input = h('input', { type: 'file', accept: '.zip,application/zip' });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!(await confirmDialog(
        t('settings.backup.restoreTitle'),
        t('settings.backup.restoreText'),
        t('settings.backup.restore'),
        'danger',
      ))) return;
      try {
        await api('/api/admin/backup', { method: 'POST', body: await file.arrayBuffer(), binary: true });
        snackbar(t('settings.backup.restored'));
        for (const k of Object.keys(dirty)) delete dirty[k];
        savebar.hidden = true;
        await load();
        refreshState().catch(() => {});
      } catch (e) { snackbar(e.message); }
    });
    input.click();
  }

  async function revokeAll() {
    if (!(await confirmDialog(t('settings.security.revokeAllTitle'), t('settings.security.revokeAllText'), t('settings.security.revokeAll'), 'danger'))) return;
    await api('/api/sessions/revoke-all', { method: 'POST' }).catch(() => {});
    logout();
  }

  function changePassword() {
    const cur = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    const next = h('input', { type: 'password', autocomplete: 'new-password', minlength: 10, required: true });
    const next2 = h('input', { type: 'password', autocomplete: 'new-password', required: true });
    const err = h('p', { class: 'error', role: 'alert' });
    const ok = h('button', { class: 'btn filled wide', type: 'submit' }, t('settings.security.pwChange'));
    const form = h('form', { class: 'stack' },
      h('label', { class: 'field' }, h('span', {}, t('settings.security.pwCurrent')), cur),
      h('label', { class: 'field' }, h('span', {}, t('settings.security.pwNew')), next),
      h('label', { class: 'field' }, h('span', {}, t('settings.security.pwRepeat')), next2),
      revealToggle([cur, next, next2]),
      h('p', { class: 'small muted' }, t('settings.security.pwHint')),
      err, ok);
    const close = sheet(t('settings.security.pwTitle'), form);
    setTimeout(() => cur.focus(), 260);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      if (next.value !== next2.value) { err.textContent = t('settings.security.pwMismatch'); return shake(next2); }
      ok.disabled = true;
      try {
        await api('/api/admin/password', { method: 'POST', body: { current: cur.value, next: next.value } });
        close();
        snackbar(t('settings.security.pwChanged'));
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
    if (!(await confirmDialog(t('settings.grinder.unpinTitle'), t('settings.grinder.unpinText'), t('settings.grinder.forget'), 'danger'))) return;
    try {
      data = await api('/api/admin/grinder/unpin', { method: 'POST' });
      paint();
      snackbar(t('settings.grinder.unpinned'));
    } catch (e) { snackbar(e.message); }
  }

  async function renewCert() {
    if (!(await confirmDialog(t('settings.security.renewTitle'), t('settings.security.renewText'), t('settings.security.renew')))) return;
    try {
      data = await api('/api/admin/tls/renew', { method: 'POST' });
      paint();
      snackbar(t('settings.security.renewed'));
    } catch (e) { snackbar(e.message); }
  }

  load();
  return () => { clearTimeout(updatePoll); savebar.remove(); };
};

function uaShort(ua = '') {
  if (/Android-App/.test(ua)) return t('settings.security.uaAndroidApp');
  if (/Android/.test(ua)) return 'Android' + (/Chrome/.test(ua) ? ' · Chrome' : '');
  if (/iPhone|iPad/.test(ua)) return 'iOS';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS/.test(ua)) return 'Mac';
  if (/Linux/.test(ua)) return 'Linux';
  return t('settings.security.uaDevice');
}
