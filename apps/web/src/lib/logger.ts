type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function threshold(): number {
  const raw = process.env.LOG_LEVEL?.toLowerCase();
  if (raw === "debug") return ORDER.debug;
  if (raw === "warn") return ORDER.warn;
  if (raw === "error") return ORDER.error;
  return ORDER.info;
}

function emit(level: LogLevel, msg: string, fields: Record<string, unknown>) {
  if (ORDER[level] < threshold()) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  });
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (msg: string, fields: Record<string, unknown> = {}) =>
    emit("debug", msg, fields),
  info: (msg: string, fields: Record<string, unknown> = {}) =>
    emit("info", msg, fields),
  warn: (msg: string, fields: Record<string, unknown> = {}) =>
    emit("warn", msg, fields),
  error: (msg: string, fields: Record<string, unknown> = {}) =>
    emit("error", msg, fields),
};
