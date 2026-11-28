// Ersteinrichtung im Browser: Einrichtungscode (aus dem Server-Log), App-Passwort, Maschine, Mühle.
import { h, icon, switchEl, snackbar } from './ui.js';
import { api } from './api.js';
import { t } from '../shared/i18n.js';

const STEPS = () => [t('app.setup.steps.code'), t('app.setup.steps.password'), t('app.setup.steps.machine'), t('app.setup.steps.grinder'), t('app.setup.steps.remote'), t('app.setup.steps.done')];

// Satz aus dem Katalog, in dem {name} für ein Element steht (Link, Hervorhebung): Text und Elemente in Satzreihenfolge
function rich(text, nodes) {
  return text.split(/\{(\w+)\}/).map((p, i) => (i % 2 ? nodes[p] : p)).filter((p) => p !== '');
}

export function showSetup(root, { onDone }) {
  const st = {
    step: 0, dir: 1, code: '', password: '', password2: '',
    machineUrl: 'http://192.168.178.55',
    machineApi: 'bbs',
    grinder: { enabled: true, url: 'https://192.168.178.54', password: '' },
    tunnel: { enabled: false, url: '', token: '' },
    env: { docker: false, service: 'http://127.0.0.1:8080', httpEnabled: true },
    locked: [],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    probe: {},
  };

  const steps = STEPS();
  const progress = h('div', { class: 'setup-progress', role: 'progressbar', 'aria-valuemin': 1, 'aria-valuemax': steps.length },
    steps.map((s, i) => h('div', { class: 'setup-dot', dataset: { i: String(i) } }, h('span', { class: 'n' }, String(i + 1)), h('span', { class: 'l' }, s))));
  const stage = h('div', { class: 'setup-stage' });
  const card = h('div', { class: 'setup-card' },
    h('img', { src: '/icons/icon.svg', alt: '', class: 'login-icon', width: 56, height: 56 }),
    h('h1', {}, t('app.setup.title')),
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
    progress.style.setProperty('--p', String(st.step / (steps.length - 1)));
    const panel = [codeStep, passwordStep, machineStep, grinderStep, tunnelStep, doneStep][st.step]();
    panel.classList.add('setup-panel', st.dir > 0 ? 'from-right' : 'from-left');
    stage.replaceChildren(panel);
    setTimeout(() => panel.querySelector('input:not([type=checkbox])')?.focus(), 260);
  }

  const err = () => h('p', { class: 'error', role: 'alert' });
  function nav(back, next) {
    return h('div', { class: 'setup-nav' }, back ? h('button', { type: 'button', class: 'btn text', onclick: back }, icon('left', 's18'), t('common.back')) : h('span'), next);
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
    const input = h('input', { class: 'code-input', inputmode: 'text', autocomplete: 'one-time-code', autocapitalize: 'characters', spellcheck: 'false', maxlength: 9, placeholder: 'XXXX-XXXX', value: st.code, 'aria-label': t('app.setup.code.label') });
    input.addEventListener('input', () => {
      const raw = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      input.value = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
      st.code = input.value;
    });
    const next = h('button', { class: 'btn filled', type: 'submit' }, t('common.next'), icon('right', 's18'));
    const form = h('form', {}, h('p', { class: 'muted' }, t('app.setup.code.intro')),
      h('pre', { class: 'hint-code' }, t('app.setup.code.hint')),
      input, e, nav(null, next));
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      busy(next, async () => {
        try {
          const r = await api('/auth/setup/check', { method: 'POST', body: { code: st.code } });
          st.locked = r.locked || [];
          st.machineUrl = r.values['machine.url'] || st.machineUrl;
          st.machineApi = r.values['machine.api'] === 'classic' ? 'classic' : 'bbs';
          st.grinder.enabled = r.values['grinder.enabled'] !== false;
          st.grinder.url = r.values['grinder.url'] || st.grinder.url;
          st.tunnel.url = r.values.publicUrl || '';
          st.tunnel.enabled = Boolean(r.values.publicUrl);
          st.env = r.env || st.env;
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
    const next = h('button', { class: 'btn filled', type: 'submit' }, t('common.next'), icon('right', 's18'));
    const form = h('form', {},
      h('p', { class: 'muted' }, t('app.setup.password.intro')),
      h('label', { class: 'field' }, h('span', {}, t('app.setup.password.label')), pw), meter,
      h('label', { class: 'field' }, h('span', {}, t('app.setup.password.repeat')), pw2),
      revealToggle([pw, pw2]),
      e, nav(() => go(0), next));
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (pw.value.length < 10) { e.textContent = t('app.setup.password.tooShort'); return shake(pw); }
      if (pw.value !== pw2.value) { e.textContent = t('app.setup.password.mismatch'); return shake(pw2); }
      go(2);
    });
    return form;
  }

  // 3. Xenia
  function machineStep() {
    const url = h('input', { type: 'url', class: 'text', value: st.machineUrl, disabled: locked('machine.url'), placeholder: 'http://192.168.178.55' });
    url.addEventListener('input', () => { st.machineUrl = url.value.trim(); });
    const result = probeResult('machine');
    const test = h('button', { type: 'button', class: 'btn tonal' }, icon('wifi', 's18'), t('app.setup.testConnection'));
    test.onclick = () => busy(test, () => runProbe('machine', { url: st.machineUrl }, result));
    const next = h('button', { class: 'btn filled', type: 'submit' }, t('common.next'), icon('right', 's18'));
    const form = h('form', {},
      h('p', { class: 'muted' }, t('app.setup.machine.intro')),
      apiChoice(st.machineApi, (v) => {
        st.machineApi = v;
        if (st.probe.machine) fillProbe(result, st.probe.machine, { selectedApi: v });
      }),
      h('label', { class: 'field' }, h('span', {}, locked('machine.url') ? t('app.setup.machine.addressLocked') : t('app.setup.machine.address')), url),
      h('div', { class: 'row', style: { 'margin-top': '8px' } }, test), result,
      nav(() => go(1), next));
    form.addEventListener('submit', (ev) => { ev.preventDefault(); go(3); });
    return form;
  }

  // 4. Mühle
  function grinderStep() {
    const g = st.grinder;
    const url = h('input', { type: 'url', class: 'text', value: g.url, disabled: locked('grinder.url'), placeholder: 'https://192.168.178.54' });
    const pw = h('input', { type: 'password', class: 'text', value: g.password, autocomplete: 'off', disabled: locked('grinder.password'), placeholder: locked('grinder.password') ? t('app.setup.grinder.passwordLocked') : t('app.setup.grinder.ownerPassword') });
    url.addEventListener('input', () => { g.url = url.value.trim(); });
    pw.addEventListener('input', () => { g.password = pw.value; });
    const result = probeResult('grinder');
    const test = h('button', { type: 'button', class: 'btn tonal' }, icon('wifi', 's18'), t('app.setup.testConnection'));
    test.onclick = () => busy(test, () => runProbe('grinder', { url: g.url, password: g.password }, result));
    const fields = h('div', { class: 'collapse', hidden: !g.enabled },
      h('label', { class: 'field' }, h('span', {}, t('app.setup.grinder.address')), url),
      h('label', { class: 'field', style: { 'margin-top': '8px' } }, h('span', {}, t('app.setup.grinder.passwordLabel')), pw),
      h('div', { class: 'row', style: { 'margin-top': '8px' } }, test), result);
    const next = h('button', { class: 'btn filled', type: 'submit' }, t('common.next'), icon('right', 's18'));
    const form = h('form', {},
      h('div', { class: 'row', style: { margin: '4px 0 12px' } },
        h('div', { class: 'grow' }, h('div', {}, t('app.setup.grinder.enable')), h('div', { class: 'small muted' }, t('app.setup.grinder.enableSub'))),
        switchEl({ checked: g.enabled, label: t('app.setup.grinder.enableLabel'), onChange: (on) => { g.enabled = on; fields.hidden = !on; } })),
      fields,
      nav(() => go(2), next));
    form.addEventListener('submit', (ev) => { ev.preventDefault(); go(4); });
    return form;
  }

  // 5. Von unterwegs: Cloudflare-Tunnel (optional)
  function tunnelStep() {
    const tn = st.tunnel;
    const url = h('input', { type: 'url', class: 'text', value: tn.url, placeholder: 'https://xenios.example.de', disabled: locked('publicUrl'), autocomplete: 'off', spellcheck: 'false' });
    url.addEventListener('input', () => { tn.url = url.value.trim(); });
    const result = probeResult('tunnel');
    const test = h('button', { type: 'button', class: 'btn tonal' }, icon('cloud', 's18'), t('app.setup.tunnel.test'));
    test.onclick = () => busy(test, () => runProbe('tunnel', { url: tn.url }, result));
    const tokenInput = h('textarea', { class: 'text', rows: 3, spellcheck: 'false', autocomplete: 'off', placeholder: 'sudo cloudflared service install …', value: tn.token });
    tokenInput.addEventListener('input', () => { tn.token = tokenInput.value; });
    const tokenErr = err();
    const take = h('button', { type: 'button', class: 'btn tonal' }, t('app.setup.tunnel.takeToken'));
    take.onclick = () => busy(take, async () => {
      tokenErr.textContent = '';
      try {
        await api('/auth/setup/tunnel', { method: 'POST', body: { code: st.code, token: tn.token } });
        snackbar(t('app.setup.tunnel.tokenTaken'));
      } catch (ex) {
        tokenErr.textContent = ex.message;
        shake(tokenInput);
      }
    });
    const paste = st.env.docker
      ? h('div', {},
        h('label', { class: 'field' }, h('span', {}, t('app.setup.tunnel.command')), tokenInput),
        h('div', { class: 'row', style: { 'margin-top': '8px' } }, take),
        tokenErr,
        h('p', { class: 'muted small' }, t('app.setup.tunnel.commandHint')))
      : null;
    const fields = h('div', { class: 'collapse', hidden: !tn.enabled },
      tunnelGuide(st.env),
      paste,
      h('div', { class: 'field-row' }, h('label', { class: 'field' }, h('span', {}, t('app.setup.tunnel.publicUrl')), url), test),
      result,
      h('p', { class: 'muted small' }, t('app.setup.tunnel.later')));
    const next = h('button', { class: 'btn filled', type: 'submit' }, t('common.next'), icon('right', 's18'));
    const form = h('form', {},
      h('p', { class: 'muted' }, t('app.setup.tunnel.intro')),
      h('div', { class: 'row', style: { margin: '4px 0 12px' } },
        h('div', { class: 'grow' }, h('div', {}, t('app.setup.tunnel.title')), h('div', { class: 'small muted' }, t('app.setup.tunnel.sub'))),
        switchEl({ checked: tn.enabled, label: t('app.setup.tunnel.title'), onChange: (on) => { tn.enabled = on; fields.hidden = !on; } })),
      fields,
      nav(() => go(3), next));
    form.addEventListener('submit', (ev) => { ev.preventDefault(); go(5); });
    return form;
  }

  // 6. Zusammenfassung
  function doneStep() {
    const e = err();
    const finish = h('button', { class: 'btn filled', type: 'submit' }, icon('check', 's18'), t('app.setup.summary.finish'));
    const row = (k, v) => [h('dt', {}, k), h('dd', {}, v)];
    const form = h('form', {},
      h('dl', { class: 'kv summary' },
        row(t('app.setup.summary.password'), '•'.repeat(Math.min(12, st.password.length))),
        row(t('app.setup.summary.machine'), t('app.setup.summary.machineValue', { model: st.machineApi === 'classic' ? t('app.setup.summary.classic') : t('app.setup.summary.bbs'), url: st.machineUrl })),
        row(t('app.setup.summary.grinder'), st.grinder.enabled ? st.grinder.url : t('app.setup.summary.grinderOff')),
        row(t('app.setup.summary.remote'), st.tunnel.enabled && st.tunnel.url ? st.tunnel.url : t('app.setup.summary.remoteLater')),
        st.tunnel.token.trim() ? row(t('app.setup.summary.token'), t('app.setup.summary.tokenTaken')) : null,
        row(t('app.setup.summary.timezone'), st.timezone || t('app.setup.summary.timezoneSystem'))),
      h('p', { class: 'muted small' }, t('app.setup.summary.note')),
      e, nav(() => go(4), finish));
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      busy(finish, async () => {
        try {
          await api('/auth/setup', { method: 'POST', body: {
            code: st.code, password: st.password, timezone: st.timezone,
            machineUrl: locked('machine.url') ? undefined : st.machineUrl,
            machineApi: st.machineApi,
            grinder: { enabled: st.grinder.enabled, url: locked('grinder.url') ? undefined : st.grinder.url, password: st.grinder.password || undefined },
            publicUrl: st.tunnel.enabled && st.tunnel.url && !locked('publicUrl') ? st.tunnel.url : undefined,
            tunnelToken: st.tunnel.enabled && st.tunnel.token.trim() ? st.tunnel.token : undefined,
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
    if (st.probe[kind]) fillProbe(box, st.probe[kind], { selectedApi: kind === 'machine' ? st.machineApi : undefined });
    return box;
  }
  async function runProbe(kind, body, box) {
    box.replaceChildren(h('span', { class: 'spinner' }), t('app.setup.testing'));
    box.className = 'probe';
    let r;
    try {
      r = await api('/auth/setup/probe', { method: 'POST', body: { code: st.code, kind, ...body } });
    } catch (ex) {
      r = { ok: false, error: ex.message };
    }
    st.probe[kind] = r;
    fillProbe(box, r, { selectedApi: kind === 'machine' ? st.machineApi : undefined });
  }

  paint();
}

export function fillProbe(box, r, { selectedApi } = {}) {
  box.className = `probe show ${r.ok ? 'ok' : 'bad'}`;
  if (!r.ok) return box.replaceChildren(icon('warn', 's18'), h('span', {}, r.error));
  const hint = r.apiHint && selectedApi && r.apiHint !== selectedApi
    ? h('div', { class: 'small bad-text' }, r.apiHint === 'classic'
      ? t('app.setup.probe.useClassic')
      : t('app.setup.probe.useBbs'))
    : r.apiHint ? h('div', { class: 'small muted' }, r.apiHint === 'classic' ? t('app.setup.probe.fitsClassic') : t('app.setup.probe.fitsBbs')) : null;
  box.replaceChildren(icon('check', 's18'), h('div', {},
    h('div', {}, `${r.name}${r.detail ? ` · ${r.detail}` : ''}`),
    hint,
    r.login === false ? h('div', { class: 'small bad-text' }, t('app.setup.probe.wrongPassword')) : r.login ? h('div', { class: 'small' }, t('app.setup.probe.loginOk')) : null,
    r.fingerprint ? h('div', { class: 'small muted fp' }, t('app.setup.probe.certificate', { fingerprint: r.fingerprint.slice(0, 23) })) : null));
}

export function apiChoice(value, onChange) {
  const box = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': t('app.setup.model.group') });
  const paint = (v) => [...box.children].forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.id === v)));
  for (const [id, title] of [['bbs', t('app.setup.model.bbs')], ['classic', t('app.setup.model.classic')]]) {
    box.append(h('button', { type: 'button', class: 'chip', dataset: { id }, 'aria-pressed': String(value === id),
      onclick: () => { onChange(id); paint(id); } }, title));
  }
  return h('div', { style: { margin: '4px 0 12px' } },
    h('div', {}, t('app.setup.model.question')),
    h('div', { class: 'small muted', style: { margin: '2px 0 8px' } }, t('app.setup.model.help')),
    box);
}

// Schritt-für-Schritt-Anleitung für den Cloudflare-Tunnel, passend zur Installation (Docker oder direkt).
// env: { docker, service, httpEnabled } vom Server
export function tunnelGuide(env) {
  const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
  return h('ol', { class: 'guide' },
    h('li', {}, t('app.setup.guide.account')),
    h('li', {}, rich(t('app.setup.guide.create'), { link: link('https://one.dash.cloudflare.com', 'one.dash.cloudflare.com'), path: h('b', {}, t('app.setup.guide.createPath')) })),
    env.docker
      ? h('li', {}, rich(t('app.setup.guide.copyDocker'), { cmd: h('b', {}, 'sudo cloudflared service install …') }))
      : h('li', {}, t('app.setup.guide.installDirect')),
    env.docker
      ? h('li', {}, rich(t('app.setup.guide.pasteDocker'), { field: h('b', {}, t('app.setup.tunnel.command')), button: h('b', {}, t('app.setup.tunnel.takeToken')) }))
      : null,
    env.docker
      ? h('li', {}, t('app.setup.guide.troubleIntro'),
        copyBlock('sh /home/test/xenios/install.sh --apply-requested'),
        t('app.setup.guide.troubleThen'),
        copyBlock('cd /home/test/xenios/docker\ndocker compose ps'),
        t('app.setup.guide.troubleResult'))
      : null,
    h('li', {}, rich(t('app.setup.guide.route'), { route: h('b', {}, t('app.setup.guide.routePath')), service: h('b', {}, t('app.setup.guide.serviceUrl')) }), copyBlock(env.service)),
    h('li', {}, rich(t('app.setup.guide.publicUrl'), { test: h('b', {}, t('app.setup.tunnel.test')) })));
}

function copyBlock(text) {
  const code = h('code', {}, text);
  const btn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('app.setup.copy'), title: t('app.setup.copy'), onclick: async () => {
    try {
      await navigator.clipboard.writeText(text);
      snackbar(t('app.setup.copied'));
    } catch {
      // ohne Zwischenablage (z. B. http): Text markieren, dann Strg+C
      const r = document.createRange();
      r.selectNodeContents(code);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    }
  } }, icon('copy', 's18'));
  return h('div', { class: 'copy-block' }, code, btn);
}

export function revealToggle(inputs) {
  return h('label', { class: 'check small' }, h('input', { type: 'checkbox', onchange: (e) => inputs.forEach((i) => { i.type = e.target.checked ? 'text' : 'password'; }) }), h('span', {}, t('app.setup.showPassword')));
}

export function shake(el) {
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}
