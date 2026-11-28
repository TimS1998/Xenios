// native-update.sh (Update-Dienst ohne Docker) gegen ein nachgebautes systemctl und curl: Erkennen des Dienstes,
// Aktualisierung aus der App mit Statusdatei, Übernahme lokaler Dateien und Rückkehr zum alten Stand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readUpdate } from '../src/update.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'native-update.sh');
const NO_SH = spawnSync('sh', ['-c', 'command -v tar >/dev/null && command -v node >/dev/null']).status === 0 ? false : 'kein sh/tar/node vorhanden';

function setup() {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'xenios-native-'));
  const prog = path.join(t, 'opt', 'xenios');
  const data = path.join(t, 'var', 'xenios');
  const state = path.join(t, 'state');
  for (const d of [path.join(prog, 'src'), data, state, path.join(t, 'bin'), path.join(t, 'rel', 'Xenios-9.9.9', 'server', 'src')]) fs.mkdirSync(d, { recursive: true });
  // installierter Stand 1.0.0 mit lokaler config.json im Programmordner
  fs.writeFileSync(path.join(prog, 'package.json'), '{"version":"1.0.0"}');
  fs.writeFileSync(path.join(prog, 'src', 'index.js'), '');
  fs.writeFileSync(path.join(prog, 'config.json'), '{"dataDir":"../../var/xenios"}');
  // Release 9.9.9 als Archiv, wie GitHub es liefert
  const rel = path.join(t, 'rel', 'Xenios-9.9.9');
  fs.writeFileSync(path.join(rel, 'server', 'package.json'), '{"version":"9.9.9"}');
  fs.writeFileSync(path.join(rel, 'server', 'src', 'index.js'), '');
  fs.copyFileSync(SCRIPT, path.join(rel, 'native-update.sh'));
  spawnSync('tar', ['czf', path.join(t, 'rel.tgz'), '-C', path.join(t, 'rel'), 'Xenios-9.9.9']);
  fs.writeFileSync(path.join(t, 'bin', 'systemctl'), `#!/bin/sh
S=${state}
case "$1" in
  show) case "$4" in
    LoadState) echo loaded ;;
    WorkingDirectory) echo / ;;
    ExecStart) echo "{ path=/usr/bin/node ; argv[]=/usr/bin/node ${prog}/src/index.js ; ignore_errors=no ; }" ;;
    NRestarts) echo 0 ;;
    *) echo ;;
  esac ;;
  is-active) [ -f $S/active ] ;;
  start) echo start >> $S/log; [ -f $S/fail ] && exit 1; touch $S/active ;;
  stop) echo stop >> $S/log; rm -f $S/active ;;
esac
`);
  fs.writeFileSync(path.join(t, 'bin', 'curl'), `#!/bin/sh
for a; do u=$a; done
case "$u" in *api.github.com*) echo '{"tag_name":"v9.9.9"}' ;; *archive*) cat ${path.join(t, 'rel.tgz')} ;; *) exit 22 ;; esac
`);
  fs.chmodSync(path.join(t, 'bin', 'systemctl'), 0o755);
  fs.chmodSync(path.join(t, 'bin', 'curl'), 0o755);
  fs.writeFileSync(path.join(state, 'active'), '');
  const conf = path.join(t, 'native.conf');
  fs.writeFileSync(conf, `SERVICE=xenios\nPROG=${prog}\nDATA=${data}\nREPO=TimS1998/Xenios\n`);
  const run = (...args) => {
    const r = spawnSync('sh', [SCRIPT, ...args], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${path.join(t, 'bin')}:${process.env.PATH}`, XENIOS_SYSTEMCTL: path.join(t, 'bin', 'systemctl'),
        XENIOS_NATIVE_CONF: conf, XENIOS_NATIVE_LIB: path.join(t, 'lib'), XENIOS_STABLE_SECONDS: '0', XENIOS_START_POLL: '0' },
    });
    return { status: r.status, output: r.stdout + r.stderr };
  };
  return { t, prog, data, state, run, version: (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version };
}

test('native-update.sh: Dienst erkennen (Programm, Datenordner aus config.json)', { skip: NO_SH }, () => {
  const e = setup();
  const r = e.run('--detect');
  assert.equal(r.status, 0, r.output);
  assert.match(r.output, new RegExp(`Programm ${e.prog} · Daten ${e.data} · Xenios 1\\.0\\.0`));
});

test('native-update.sh: Aktualisierung aus der App, lokale Dateien bleiben', { skip: NO_SH }, () => {
  const e = setup();
  // ohne Anforderung: nur Lebenszeichen als Dienst „ohne Docker“
  assert.equal(e.run('--apply-requested').status, 0);
  let u = readUpdate(e.data);
  assert.equal(u.helperAlive, true);
  assert.equal(u.helper.mode, 'native');
  assert.equal(e.version(e.prog), '1.0.0');
  // Anforderung aus der App
  fs.writeFileSync(path.join(e.data, 'update.request'), '{}');
  const r = e.run('--apply-requested');
  assert.equal(r.status, 0, r.output);
  u = readUpdate(e.data);
  assert.equal(u.requested, false);
  assert.equal(u.job.state, 'ok');
  assert.equal(u.job.version, '9.9.9');
  assert.equal(e.version(e.prog), '9.9.9');
  assert.equal(e.version(`${e.prog}.alt`), '1.0.0', 'alter Stand bleibt als Sicherung');
  assert.equal(fs.readFileSync(path.join(e.prog, 'config.json'), 'utf8'), '{"dataDir":"../../var/xenios"}', 'lokale config.json übernommen');
  assert.equal(fs.readFileSync(path.join(e.state, 'log'), 'utf8'), 'stop\nstart\n');
});

test('native-update.sh: startet der neue Stand nicht, läuft der alte weiter', { skip: NO_SH }, () => {
  const e = setup();
  fs.writeFileSync(path.join(e.state, 'fail'), '');
  fs.writeFileSync(path.join(e.data, 'update.request'), '{}');
  const r = e.run('--apply-requested');
  assert.notEqual(r.status, 0);
  const u = readUpdate(e.data);
  assert.equal(u.job.state, 'error');
  assert.match(u.job.error, /alter Stand läuft weiter/);
  assert.equal(e.version(e.prog), '1.0.0');
});
