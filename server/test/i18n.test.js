// Texte in mehreren Sprachen: Nachschlagen, Werte einsetzen, Mehrzahl, Rückfall auf Deutsch, gleiche Schlüssel in allen
// Sprachen und keine Schlüssel im Code, die im deutschen Katalog fehlen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { t, tRaw, pickLang, setLang, lang, locale, CATALOGS, DEFAULT_LANG } from '../web/shared/i18n.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('i18n: Nachschlagen, Einsetzen, Mehrzahl, unbekannte Schlüssel', () => {
  assert.equal(lang(), 'de', 'der Server startet auf Deutsch');
  assert.equal(t('common.save'), 'Speichern');
  assert.deepEqual(tRaw('common.weekdaysShort').slice(0, 2), ['So', 'Mo']);
  assert.equal(t('gibt.es.nicht'), 'gibt.es.nicht');
  CATALOGS.de.__test = { hello: 'Hallo {name}', cups: { one: '{n} Bezug', other: '{n} Bezüge' } };
  try {
    assert.equal(t('__test.hello', { name: 'Xenia' }), 'Hallo Xenia');
    assert.equal(t('__test.hello'), 'Hallo {name}');
    assert.equal(t('__test.cups', { n: 1 }), '1 Bezug');
    assert.equal(t('__test.cups', { n: 3 }), '3 Bezüge');
    assert.equal(t('__test.cups', { n: 0 }), '0 Bezüge');
    // unbekannte Sprache: Deutsch
    assert.equal(t('__test.hello', { name: 'X' }, 'xx'), 'Hallo X');
  } finally { delete CATALOGS.de.__test; }
  assert.equal(pickLang('de-AT'), 'de');
  assert.equal(pickLang('fr-FR'), DEFAULT_LANG);
  assert.equal(setLang('zz'), 'de');
  assert.equal(locale(), 'de-DE');
});

// alle Schlüssel eines Katalogs als „a.b.c“ (Listen und Mehrzahl-Objekte zählen als ein Wert)
function keys(o, pre = '') {
  return Object.entries(o).flatMap(([k, v]) => {
    const p = pre ? `${pre}.${k}` : k;
    const leaf = typeof v !== 'object' || v === null || Array.isArray(v) || 'other' in v;
    return leaf ? [p] : keys(v, p);
  });
}

test('i18n: jede Sprache hat dieselben Schlüssel wie Deutsch', () => {
  const de = new Set(keys(CATALOGS.de));
  for (const [l, cat] of Object.entries(CATALOGS)) {
    if (l === 'de') continue;
    const k = new Set(keys(cat));
    assert.deepEqual([...de].filter((x) => !k.has(x)), [], `${l}: fehlende Schlüssel`);
    assert.deepEqual([...k].filter((x) => !de.has(x)), [], `${l}: überzählige Schlüssel`);
  }
});

test('i18n: jeder t()-Schlüssel im Code steht im deutschen Katalog', () => {
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'i18n' && e.name !== 'vendor') walk(p); } else if (p.endsWith('.js')) files.push(p); } };
  walk(path.join(ROOT, 'web'));
  walk(path.join(ROOT, 'src'));
  const de = new Set(keys(CATALOGS.de));
  const missing = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\bt(?:Raw)?\(\s*'([a-zA-Z0-9_.]+)'/g)) {
      const k = m[1];
      if (!de.has(k) && !keys(CATALOGS.de).some((x) => x.startsWith(`${k}.`))) missing.push(`${path.relative(ROOT, f)}: ${k}`);
    }
  }
  assert.deepEqual(missing, []);
});
