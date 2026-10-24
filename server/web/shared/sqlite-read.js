// Minimaler, nur lesender SQLite-Parser (ohne Abhängigkeiten) für die Datenbank der Mühle.
// Unterstützt Tabellen mit und ohne ROWID, Überlaufseiten und alle Spaltentypen.

export function openSqlite(buffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (new TextDecoder().decode(u8.subarray(0, 15)) !== 'SQLite format 3') throw new Error('Keine SQLite-Datei');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let pageSize = dv.getUint16(16);
  if (pageSize === 1) pageSize = 65536;
  const usable = pageSize - u8[20];
  const pageCount = Math.floor(u8.byteLength / pageSize);

  const varint = (p) => {
    let v = 0;
    for (let i = 0; i < 9; i++) {
      const b = u8[p + i];
      if (i === 8) return [v * 256 + b, 9];
      v = v * 128 + (b & 0x7f);
      if (!(b & 0x80)) return [v, i + 1];
    }
    return [v, 9];
  };

  function payload(p, len, isIndex) {
    const X = isIndex ? Math.floor((usable - 12) * 64 / 255) - 23 : usable - 35;
    if (len <= X) return u8.subarray(p, p + len);
    const M = Math.floor((usable - 12) * 32 / 255) - 23;
    const K = M + ((len - M) % (usable - 4));
    const local = K <= X ? K : M;
    const out = new Uint8Array(len);
    out.set(u8.subarray(p, p + local));
    let off = local;
    let ovf = dv.getUint32(p + local);
    let guard = 0;
    while (ovf && off < len && guard++ < pageCount) {
      const base = (ovf - 1) * pageSize;
      const n = Math.min(usable - 4, len - off);
      out.set(u8.subarray(base + 4, base + 4 + n), off);
      off += n;
      ovf = dv.getUint32(base);
    }
    return out;
  }

  function record(b) {
    const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const vint = (p) => {
      let v = 0;
      for (let i = 0; i < 9; i++) {
        const x = b[p + i];
        if (i === 8) return [v * 256 + x, 9];
        v = v * 128 + (x & 0x7f);
        if (!(x & 0x80)) return [v, i + 1];
      }
      return [v, 9];
    };
    const [hl, n] = vint(0);
    let p = n;
    const types = [];
    while (p < hl) {
      const [t, m] = vint(p);
      types.push(t);
      p += m;
    }
    let q = hl;
    const vals = [];
    for (const t of types) {
      let v = null;
      if (t >= 1 && t <= 6) {
        const L = [0, 1, 2, 3, 4, 6, 8][t];
        let x = 0n;
        for (let i = 0; i < L; i++) x = (x << 8n) | BigInt(b[q + i]);
        const bits = BigInt(L * 8);
        if (x >= 1n << (bits - 1n)) x -= 1n << bits;
        v = Number(x);
        q += L;
      } else if (t === 7) {
        v = d.getFloat64(q);
        q += 8;
      } else if (t === 8) v = 0;
      else if (t === 9) v = 1;
      else if (t >= 12 && t % 2 === 0) {
        const L = (t - 12) / 2;
        v = b.slice(q, q + L);
        q += L;
      } else if (t >= 13) {
        const L = (t - 13) / 2;
        v = new TextDecoder().decode(b.subarray(q, q + L));
        q += L;
      }
      vals.push(v);
    }
    return vals;
  }

  function walk(pg, cb, depth = 0) {
    if (pg < 1 || pg > pageCount || depth > 30) return;
    const base = (pg - 1) * pageSize;
    const h = pg === 1 ? 100 : 0;
    const type = u8[base + h];
    const nc = dv.getUint16(base + h + 3);
    const hs = type === 2 || type === 5 ? 12 : 8;
    for (let i = 0; i < nc; i++) {
      const p = base + dv.getUint16(base + h + hs + 2 * i);
      if (type === 13) {
        const [pl, a] = varint(p);
        const [rowid, b2] = varint(p + a);
        cb(rowid, record(payload(p + a + b2, pl, false)));
      } else if (type === 10) {
        const [pl, a] = varint(p);
        cb(null, record(payload(p + a, pl, true)));
      } else if (type === 5) {
        walk(dv.getUint32(p), cb, depth + 1);
      } else if (type === 2) {
        walk(dv.getUint32(p), cb, depth + 1);
        const [pl, a] = varint(p + 4);
        cb(null, record(payload(p + 4 + a, pl, true)));
      }
    }
    if (type === 5 || type === 2) walk(dv.getUint32(base + h + 8), cb, depth + 1);
  }

  const master = [];
  walk(1, (rowid, v) => master.push({ type: v[0], name: v[1], table: v[2], root: v[3], sql: v[4] }));

  function columns(sql) {
    const body = String(sql).slice(sql.indexOf('(') + 1, sql.lastIndexOf(')'));
    const cols = [];
    let depth = 0;
    let cur = '';
    for (const ch of body) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        cols.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    if (cur.trim()) cols.push(cur.trim());
    const withoutRowid = /\)\s*WITHOUT\s+ROWID\s*$/i.test(String(sql).trim());
    const tablePk = cols.find((c) => /^PRIMARY\s+KEY\s*\(/i.test(c));
    const pkCols = tablePk ? tablePk.slice(tablePk.indexOf('(') + 1, tablePk.lastIndexOf(')')).split(',').map((s) => s.trim().replace(/^["`[]|["`\]]$/g, '').split(/\s+/)[0].replace(/["`\]]/g, '')) : [];
    return cols
      .filter((c) => !/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)\b/i.test(c))
      .map((c) => {
        const name = c.match(/^["`[]?([^"`\]\s]+)/)[1];
        const isInteger = /^\S+\s+INTEGER\b/i.test(c);
        const ipk = !withoutRowid && isInteger && (/PRIMARY KEY/i.test(c) || (pkCols.length === 1 && pkCols[0] === name));
        return { name, ipk };
      });
  }

  return {
    tables: master.filter((m) => m.type === 'table').map((m) => m.name),
    rows(table) {
      const m = master.find((x) => x.type === 'table' && x.name === table);
      if (!m) return [];
      const cols = columns(m.sql);
      const out = [];
      walk(m.root, (rowid, vals) => {
        const row = {};
        cols.forEach((c, i) => {
          row[c.name] = c.ipk && vals[i] === null ? rowid : vals[i] ?? null;
        });
        out.push(row);
      });
      return out;
    },
  };
}
