// Lightweight structured logger for the Copilot Insights server.
// Prefixes messages with level and ISO timestamp. Zero dependencies.

function formatMessage(level, args) {
  const ts = new Date().toISOString();
  const prefix = `[${level}] [${ts}]`;
  return [prefix, ...args];
}

export const log = {
  info(...args)  { console.log(...formatMessage("INFO", args)); },
  warn(...args)  { console.warn(...formatMessage("WARN", args)); },
  error(...args) { console.error(...formatMessage("ERROR", args)); },
};
