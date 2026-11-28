#!/usr/bin/env node
// Einrichtung im Terminal (Alternative zur Einrichtung im Browser): App-Passwort und Geräte-Adressen.
// Aufruf: npm run setup   (oder: node server/setup.js --config pfad/zur/config.json)
// Nicht-interaktiv: XENIOS_PASSWORD=... [XENIOS_GRINDER_PASSWORD=...] node server/setup.js --yes
// Alles Weitere (Ports, Zertifikat, Funktionen, Zeitzone) lässt sich in der App unter Einstellungen → Server ändern.
import readline from 'node:readline';
import { configPath, loadConfig, updateConfigFile } from './config.js';
import { hashPassword, passwordProblem } from './auth.js';
import { deviceUrl } from './admin.js';
import { t } from '../web/shared/i18n.js';

const file = configPath();
const nonInteractive = process.argv.includes('--yes');
const cfg = loadConfig(file);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

function ask(q, def) {
  if (nonInteractive) return Promise.resolve(def ?? '');
  return new Promise((res) => rl.question(def !== undefined && def !== '' ? `${q} [${def}]: ` : `${q}: `, (a) => res(a.trim() || def || '')));
}

function askHidden(q) {
  if (nonInteractive) return Promise.resolve('');
  return new Promise((resolve) => {
    const orig = rl._writeToOutput;
    rl._writeToOutput = (s) => orig.call(rl, s.startsWith(q) ? s : '*'.repeat(s.length));
    rl.question(q, (a) => {
      rl._writeToOutput = orig;
      rl.output.write('\n');
      resolve(a);
    });
  });
}

async function askUrl(label, def) {
  for (;;) {
    try {
      return deviceUrl(await ask(label, def), label);
    } catch (e) {
      console.log(`  ✗ ${e.message}`);
      if (nonInteractive) process.exit(1);
    }
  }
}

async function main() {
  console.log(`\n☕  ${t('server.setup.heading')}`);
  console.log(`   ${t('server.setup.configFile', { file })}\n`);
  const changes = {};

  // 1. App-Passwort
  const hasPw = Boolean(cfg.auth.passwordHash);
  let setPw = !hasPw;
  if (hasPw && !nonInteractive) setPw = /^[jy]/i.test(await ask(t('server.setup.changePassword'), 'n'));
  if (nonInteractive) setPw = Boolean(process.env.XENIOS_PASSWORD) || !hasPw;
  while (setPw) {
    const pw = nonInteractive ? process.env.XENIOS_PASSWORD || '' : await askHidden(t('server.setup.newPassword'));
    const err = passwordProblem(pw);
    if (err) {
      console.log(`  ✗ ${t('server.setup.tooWeak', { problem: err })}`);
      if (nonInteractive) process.exit(1);
      continue;
    }
    if (!nonInteractive && pw !== (await askHidden(t('server.setup.repeatPassword')))) {
      console.log(`  ✗ ${t('server.setup.mismatch')}`);
      continue;
    }
    changes['auth.passwordHash'] = hashPassword(pw);
    console.log(`  ✓ ${t('server.setup.passwordSet')}`);
    break;
  }

  // 2. Geräte (per Umgebungsvariable festgelegte Werte bleiben unberührt)
  const which = await ask(t('server.setup.whichXenia'), cfg.machine.api === 'classic' ? '2' : '1');
  changes['machine.api'] = which === '2' || /^alt/i.test(which) ? 'classic' : 'bbs';
  if (!cfg._locked.includes('machine.url')) changes['machine.url'] = await askUrl(t('server.fields.machineUrl'), cfg.machine.url);
  const useGrinder = !/^n/i.test(await ask(t('server.setup.useGrinder'), cfg.grinder.enabled ? 'j' : 'n'));
  changes['grinder.enabled'] = useGrinder;
  if (useGrinder) {
    if (!cfg._locked.includes('grinder.url')) changes['grinder.url'] = await askUrl(t('server.fields.grinderUrl'), cfg.grinder.url);
    if (!cfg._locked.includes('grinder.password')) {
      const gp = nonInteractive ? '' : await askHidden(cfg.grinder.password ? t('server.setup.grinderPasswordKeep') : t('server.setup.grinderPassword'));
      if (gp) changes['grinder.password'] = gp;
    }
  }

  updateConfigFile(file, changes, cfg._box);
  console.log(`  ✓ ${t('server.setup.saved', { file })}`);
  console.log(`\n${t('server.setup.done')}`);
  console.log(`${t('server.setup.more')}\n`);
  rl.close();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
