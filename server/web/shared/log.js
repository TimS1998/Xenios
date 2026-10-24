// Minimales Logging mit Zeitstempel. Passwörter/Tokens werden nie geloggt.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
let current = LEVELS.info;

export function setLogLevel(name) {
  current = LEVELS[name] ?? LEVELS.info;
}

function out(level, scope, msg, extra) {
  if (LEVELS[level] < current) return;
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `${ts} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (extra !== undefined) fn(line, extra);
  else fn(line);
}

export function logger(scope) {
  return {
    debug: (m, e) => out('debug', scope, m, e),
    info: (m, e) => out('info', scope, m, e),
    warn: (m, e) => out('warn', scope, m, e),
    error: (m, e) => out('error', scope, m, e),
  };
}
