// Ersteinrichtung im Browser: Einrichtungscode (aus dem Server-Log), App-Passwort, Maschine, Mühle.
import { h, icon, switchEl } from './ui.js';
import { api } from './api.js';

const STEPS = ['Code', 'Passwort', 'Xenia', 'Mühle', 'Fertig'];

export function showSetup(root, { onDone }) {
  const st = {
    step: 0, dir: 1, code: '', password: '', password2: '',
    machineUrl: 'http://192.168.178.55',
    grinder: { enabled: true, url: 'https://192.168.178.54', password: '' },
    locked: [],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    probe: {},
  };

  const progress = h('div', { class: 'setup-progress', role: 'progressbar', 'aria-valuemin': 1, 'aria-valuemax': STEPS.length },
    STEPS.map((s, i) => h('div', { class: 'setup-dot', dataset: { i: String(i) } }, h('span', { class: 'n' }, String(i + 1)), h('span', { class: 'l' }, s))));
  const stage = h('div', { class: 'setup-stage' });
  const card = h('div', { class: 'setup-card' },
    h('img', { src: '/icons/icon.svg', alt: '', class: 'login-icon', width: 56, height: 56 }),
    h('h1', {}, 'Xenios einrichten'),
    progress, stage);
  root.replaceChildren(card);

  function go(step) {
    st.dir = step >= st.step ? 1 : -1;
    st.step = step;
    paint();
  }

  function paint() {
    progress.setAttribute('aria-valuenow', String(st.step + 1));
    progress.querySelectorAll('.setup-dot').forEach((d, i) => {
      d.classList.toggle('done', i < st.step);
      d.classList.toggle('active', i === st.step);
    });
    progress.style.setProperty('--p', String(st.step / (STEPS.length - 1)));
    const panel = [codeStep, passwordStep, machineStep, grinderStep, doneStep][st.step]();
    panel.classList.add('setup-panel', st.dir > 0 ? 'from-right' : 'from-left');
    stage.replaceChildren(panel);
    setTimeout(() => panel.querySelector('input:not([type=checkbox])')?.focus(), 260);
  }

  const err = () => h('p', { class: 'error', role: 'alert' });
  function nav(back, next) {
    return h('div', { class: 'setup-nav' }, back ? h('button', { type: 'button', class: 'btn text', onclick: back }, icon('left', 's18'), 'Zurück') : h('span'), next);
  }
  async function busy(btn, fn) {
    btn.disabled = true;
    btn.classList.add('loading');
    try { await fn(); } finally {
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  }
  const locked = (p) => st.locked.includes(p);

  // 1. Code
  function codeStep() {
    const e = err();
    const input = h('input', { class: 'code-input', inputmode: 'text', autocomplete: 'one-time-code', autocapitalize: 'characters', spellcheck: 'false', maxlength: 9, placeholder: 'XXXX-XXXX', value: st.code, 'aria-label': 'Einrichtungscode' });
    input.addEventListener('input', () => {
      const raw = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      input.value = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
      st.code = input.value;
    });
    const next = h('button', { class: 'btn filled', type: 'submit' }, 'Weiter', icon('right', 's18'));
    const form = h('form', {}, h('p', { class: 'muted' }, 'Der Server ist noch nicht eingerichtet. Den Einrichtungscode zeigt das Server-Protokoll beim Start an.'),
      h('pre', { class: 'hint-code' }, 'docker compose logs xenia\n# oder im Fenster von „npm start“'),
      input, e, nav(null, next));
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      busy(next, async () => {
        try {
          const r = await api('/auth/setup/check', { method: 'POST', body: { code: st.code } });
          st.locked = r.locked || [];
          st.machineUrl = r.values['machine.url'] || st.machineUrl;
          st.grinder.enabled = r.values['grinder.enabled'] !== false;
          st.grinder.url = r.values['grinder.url'] || st.grinder.url;
          go(1);
        } catch (ex) {
          e.textContent = ex.message;
          shake(input);
        }
      });
    });
    return form;
  }

  // 2. Passwort
  function passwordStep() {
    const e = err();
    const meter = h('div', { class: 'meter' }, h('i'));
    const pw = h('input', { type: 'password', autocomplete: 'new-password', value: st.password, minlength: 10, required: true });
    const pw2 = h('input', { type: 'password', autocomplete: 'new-password', value: st.password2, required: true });
    const rate = () => {
      const v = pw.value;
      const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(v)).length;
      const score = v.length < 10 ? Math.min(1, v.length / 10) * 0.3 : Math.min(1, 0.35 + (v.length - 10) * 0.04 + variety * 0.12);
      meter.style.setProperty('--s', score.toFixed(2));
      meter.dataset.level = score < 0.35 ? 'weak' : score < 0.7 ? 'ok' : 'strong';
      st.password = pw.value;
      st.password2 = pw2.value;
    };
    pw.addEventListener('input', rate);
    pw2.addEventListener('input', rate);
    rate();
    const next = h('button', { class: 'btn filled', type: 'submit' }, 'Weiter', icon('right', 's18'));
    const form = h('form', {},
      h('p', { class: 'muted' }, 'Mit diesem Passwort melden sich alle Geräte an. Gespeichert wird nur ein scrypt-Hash.'),
      h('label', { class: 'field' }, h('span', {}, 'App-Passwort (mind. 10 Zeichen)'), pw), meter,
      h('label', { class: 'field' }, h('span', {}, 'Wiederholen'), pw2),
      revealToggle([pw, pw2]),
      e, nav(() => go(0), next));
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (pw.value.length < 10) { e.textContent = 'Mindestens 10 Zeichen'; return shake(pw); }
      if (pw.value !== pw2.value) { e.textContent = 'Passwörter stimmen nicht überein'; return shake(pw2); }
      go(2);
    });
    return form;
  }

  // 3. Xenia
  function machineStep() {
    const url = h('input', { type: 'url', class: 'text', value: st.machineUrl, disabled: locked('machine.url'), placeholder: 'http://192.168.178.55' });
    url.addEventListener('input', () => { st.machineUrl = url.value.trim(); });
    const result = probeResult('machine');
    const test = h('button', { type: 'button', class: 'btn tonal' }, icon('wifi', 's18'), 'Verbindung testen');
    test.onclick = () => busy(test, () => runProbe('machine', { url: st.machineUrl }, result));
    const next = h('button', { class: 'btn filled', type: 'submit' }, 'Weiter', icon('right', 's18'));
    const form = h('form', {},
      h('p', { class: 'muted' }, 'Adresse der Espressomaschine im Heimnetz (steht im Router oder im Display der Xenia).'),
      h('label', { class: 'field' }, h('span', {}, locked('machine.url') ? 'Adresse (per Umgebungsvariable festgelegt)' : 'Adresse der Xenia'), url),
      h('div', { class: 'row', style: { 'margin-top': '8px' } }, test), result,
      nav(() => go(1), next));
    form.addEventListener('submit', (ev) => { ev.preventDefault(); go(3); });
    return form;
  }

  // 4. Mühle
  function grinderStep() {
    const g = st.grinder;
    const url = h('input', { type: 'url', class: 'text', value: g.url, disabled: locked('grinder.url'), placeholder: 'https://192.168.178.54' });
    const pw = h('input', { type: 'password', class: 'text', value: g.password, autocomplete: 'off', disabled: locked('grinder.password'), placeholder: locked('grinder.password') ? 'per Umgebungsvariable gesetzt' : 'Owner-Passwort' });
    url.addEventListener('input', () => { g.url = url.value.trim(); });
    pw.addEventListener('input', () => { g.password = pw.value; });
    const result = probeResult('grinder');
    const test = h('button', { type: 'button', class: 'btn tonal' }, icon('wifi', 's18'), 'Verbindung testen');
    test.onclick = () => busy(test, () => runProbe('grinder', { url: g.url, password: g.password }, result));
    const fields = h('div', { class: 'collapse', hidden: !g.enabled },
      h('label', { class: 'field' }, h('span', {}, 'Adresse der Mühle'), url),
      h('label', { class: 'field', style: { 'margin-top': '8px' } }, h('span', {}, 'Owner-Passwort (wird verschlüsselt gespeichert)'), pw),
      h('div', { class: 'row', style: { 'margin-top': '8px' } }, test), result);
    const next = h('button', { class: 'btn filled', type: 'submit' }, 'Weiter', icon('right', 's18'));
    const form = h('form', {},
      h('div', { class: 'row', style: { margin: '4px 0 12px' } },
        h('div', { class: 'grow' }, h('div', {}, 'Mahlkönig E64 WS einbinden'), h('div', { class: 'small muted' }, 'Rezepte, Mahlvorgänge, Meldungen')),
        switchEl({ checked: g.enabled, label: 'Mühle einbinden', onChange: (on) => { g.enabled = on; fields.hidden = !on; } })),
      fields,
      nav(() => go(2), next));
    form.addEventListener('submit', (ev) => { ev.preventDefault(); go(4); });
    return form;
  }

  // 5. Zusammenfassung
  function doneStep() {
    const e = err();
    const finish = h('button', { class: 'btn filled', type: 'submit' }, icon('check', 's18'), 'Einrichtung abschließen');
    const row = (k, v) => [h('dt', {}, k), h('dd', {}, v)];
    const form = h('form', {},
      h('dl', { class: 'kv summary' },
        row('App-Passwort', '•'.repeat(Math.min(12, st.password.length))),
        row('Xenia', st.machineUrl),
        row('Mühle', st.grinder.enabled ? st.grinder.url : 'nicht eingebunden'),
        row('Zeitzone', st.timezone || 'System')),
      h('p', { class: 'muted small' }, 'Alles lässt sich später unter Einstellungen → Server ändern: Ports, Zertifikat, Funktionen, Zeitzone, Passwort.'),
      e, nav(() => go(3), finish));
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      busy(finish, async () => {
        try {
          await api('/auth/setup', { method: 'POST', body: {
            code: st.code, password: st.password, timezone: st.timezone,
            machineUrl: locked('machine.url') ? undefined : st.machineUrl,
            grinder: { enabled: st.grinder.enabled, url: locked('grinder.url') ? undefined : st.grinder.url, password: st.grinder.password || undefined },
          } });
          card.classList.add('finished');
          setTimeout(onDone, 450);
        } catch (ex) {
          e.textContent = ex.message;
          shake(finish);
        }
      });
    });
    return form;
  }

  function probeResult(kind) {
    const box = h('div', { class: 'probe', 'aria-live': 'polite' });
    if (st.probe[kind]) fillProbe(box, st.probe[kind]);
    return box;
  }
  async function runProbe(kind, body, box) {
    box.replaceChildren(h('span', { class: 'spinner' }), 'Teste …');
    box.className = 'probe';
    let r;
    try {
      r = await api('/auth/setup/probe', { method: 'POST', body: { code: st.code, kind, ...body } });
    } catch (ex) {
      r = { ok: false, error: ex.message };
    }
    st.probe[kind] = r;
    fillProbe(box, r);
  }

  paint();
}

export function fillProbe(box, r) {
  box.className = `probe show ${r.ok ? 'ok' : 'bad'}`;
  if (!r.ok) return box.replaceChildren(icon('warn', 's18'), h('span', {}, r.error));
  box.replaceChildren(icon('check', 's18'), h('div', {},
    h('div', {}, `${r.name}${r.detail ? ` · ${r.detail}` : ''}`),
    r.login === false ? h('div', { class: 'small bad-text' }, 'Passwort falsch') : r.login ? h('div', { class: 'small' }, 'Anmeldung ok') : null,
    r.fingerprint ? h('div', { class: 'small muted fp' }, `Zertifikat ${r.fingerprint.slice(0, 23)}…`) : null));
}

export function revealToggle(inputs) {
  return h('label', { class: 'check small' }, h('input', { type: 'checkbox', onchange: (e) => inputs.forEach((i) => { i.type = e.target.checked ? 'text' : 'password'; }) }), h('span', {}, 'Passwort anzeigen'));
}

export function shake(el) {
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}
