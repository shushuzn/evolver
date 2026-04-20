// Structured JSON logger for evolver
// Replace console.log/warn/error with this for machine-parseable output

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function shouldLog(level) {
  return LEVELS[level] <= LEVELS[LOG_LEVEL];
}

function format(level, msg, meta = {}) {
  return JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...meta,
  });
}

module.exports = {
  error(msg, meta) { if (shouldLog('error')) console.error(format('error', msg, meta)); },
  warn(msg, meta) { if (shouldLog('warn')) console.warn(format('warn', msg, meta)); },
  info(msg, meta) { if (shouldLog('info')) console.log(format('info', msg, meta)); },
  debug(msg, meta) { if (shouldLog('debug')) console.log(format('debug', msg, meta)); },
};
