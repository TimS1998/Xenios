#!/usr/bin/env node
// Einrichtung im Terminal (Alternative zur Einrichtung im Browser): App-Passwort und Geräte-Adressen.
// Aufruf: npm run setup   (oder: node server/setup.js --config pfad/zur/config.json)
// Nicht-interaktiv: XENIOS_PASSWORD=... [XENIOS_GRINDER_PASSWORD=...] node server/setup.js --yes
// Alles Weitere (Ports, Zertifikat, Funktionen, Zeitzone) lässt sich in der App unter Einstellungen → Server ändern.
import readline from 'node:readline';
import { configPath, loadConfig, updateConfigFile } from './config.js';
import { hashPassword, passwordProblem } from './auth.js';
import { deviceUrl } from './admin.js';

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
  console.log('\n☕  Xenios – Einrichtung');
  console.log(`   Konfiguration: ${file}\n`);
  const changes = {};

  // 1. App-Passwort
  const hasPw = Boolean(cfg.auth.passwordHash);
  let setPw = !hasPw;
  if (hasPw && !nonInteractive) setPw = /^[jy]/i.test(await ask('App-Passwort ändern? (j/N)', 'n'));
  if (nonInteractive) setPw = Boolean(process.env.XENIOS_PASSWORD) || !hasPw;
  while (setPw) {
    const pw = nonInteractive ? process.env.XENIOS_PASSWORD || '' : await askHidden('Neues App-Passwort (mind. 10 Zeichen): ');
    const err = passwordProblem(pw);
    if (err) {
      console.log(`  ✗ Zu schwach: ${err}`);
      if (nonInteractive) process.exit(1);
      continue;
    }
    if (!nonInteractive && pw !== (await askHidden('Passwort wiederholen: '))) {
      console.log('  ✗ Stimmt nicht überein');
      continue;
    }
    changes['auth.passwordHash'] = hashPassword(pw);
    console.log('  ✓ Passwort gesetzt (nur als scrypt-Hash gespeichert)');
    break;
  }

  // 2. Geräte (per Umgebungsvariable festgelegte Werte bleiben unberührt)
  const which = await ask('Welche Xenia? 1 = neu (Brew-by-Sync), 2 = alt (DBL)', cfg.machine.api === 'classic' ? '2' : '1');
  changes['machine.api'] = which === '2' || /^alt/i.test(which) ? 'classic' : 'bbs';
  if (!cfg._locked.includes('machine.url')) changes['machine.url'] = await askUrl('Adresse der Xenia', cfg.machine.url);
  const useGrinder = !/^n/i.test(await ask('Mahlkönig-Mühle einbinden? (J/n)', cfg.grinder.enabled ? 'j' : 'n'));
  changes['grinder.enabled'] = useGrinder;
  if (useGrinder) {
    if (!cfg._locked.includes('grinder.url')) changes['grinder.url'] = await askUrl('Adresse der Mühle', cfg.grinder.url);
    if (!cfg._locked.includes('grinder.password')) {
      const gp = nonInteractive ? '' : await askHidden(`Owner-Passwort der Mühle${cfg.grinder.password ? ' (Enter = unverändert)' : ''}: `);
      if (gp) changes['grinder.password'] = gp;
    }
  }

  updateConfigFile(file, changes, cfg._box);
  console.log(`  ✓ Gespeichert: ${file} (Mühlen-Passwort verschlüsselt)`);
  console.log('\nFertig. Starten mit:  npm start');
  console.log('Weitere Einstellungen: in der App unter Einstellungen → Server.\n');
  rl.close();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
