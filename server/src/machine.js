// Xenia im Server: gemeinsamer Geräte-Code (public/shared/machine-core.js) mit Bezugs-Historie als Datei.
import path from 'node:path';
import { Machine as MachineCore } from '../web/shared/machine-core.js';
import { JsonStore } from './store.js';

export * from '../web/shared/machine-core.js';

export class Machine extends MachineCore {
  constructor(cfg) {
    super(cfg, { history: new JsonStore(path.join(cfg.dataDir, 'shots.json'), { shots: [] }) });
  }
}
