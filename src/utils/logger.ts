type Level = "debug" | "info" | "warn" | "error";

const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|cookie|api[-_]?key|card|cvc|signature/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || value === undefined) {
    return value;
  }

  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry, depth + 1));
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(entry, depth + 1);
    }
    return output;
  }

  return value;
}

function write(level: Level, message: string, meta?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "test" && level !== "error") {
    return;
  }

  const entry = {
    time: new Date().toISOString(),
    level,
    message,
    ...(meta ? (redact(meta) as Record<string, unknown>) : {}),
  };

  const line = JSON.stringify(entry);

  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => {
    if (process.env.NODE_ENV === "development") write("debug", message, meta);
  },
  info: (message: string, meta?: Record<string, unknown>) => write("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write("error", message, meta),
};
