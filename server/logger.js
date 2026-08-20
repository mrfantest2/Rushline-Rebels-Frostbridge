const SECRET_KEY = /token|secret|authorization/i;

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SECRET_KEY.test(key) ? '[REDACTED]' : redact(item),
  ]));
}

export function createLogger(sink = console) {
  const write = (level, message, context = {}) => {
    const record = { level, message, ...redact(context) };
    const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    sink[method]?.(JSON.stringify(record));
  };
  return {
    info: (message, context) => write('info', message, context),
    warn: (message, context) => write('warn', message, context),
    error: (message, context) => write('error', message, context),
  };
}

export const logger = createLogger();
