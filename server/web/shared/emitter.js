// Minimaler EventEmitter, läuft in Node und im Browser (für den gemeinsamen Geräte-Code).
export class Emitter {
  constructor() {
    this._handlers = new Map();
  }

  on(name, fn) {
    if (!this._handlers.has(name)) this._handlers.set(name, new Set());
    this._handlers.get(name).add(fn);
    return this;
  }

  off(name, fn) {
    this._handlers.get(name)?.delete(fn);
    return this;
  }

  emit(name, ...args) {
    for (const fn of [...(this._handlers.get(name) || [])]) {
      try { fn(...args); } catch (e) { console.error(e); }
    }
    return true;
  }
}

// Speicher im Arbeitsspeicher mit derselben Schnittstelle wie der JsonStore des Servers.
export class MemoryStore {
  constructor(initial) {
    this.data = structuredClone(initial);
  }

  save() {}
  flush() {}
}
