// Kleiner JSON-Dateispeicher mit atomarem Schreiben (tmp + rename) und Entprellung.
import fs from 'node:fs';
import path from 'node:path';

export class JsonStore {
  constructor(file, initial) {
    this.file = file;
    this.timer = null;
    try {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      this.data = typeof initial === 'function' ? initial() : structuredClone(initial);
    }
  }

  save(delayMs = 500) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), delayMs);
    this.timer.unref?.();
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}
