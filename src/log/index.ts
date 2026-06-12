const LEVELS = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof LEVELS)[number];

type LogContext = Record<string, unknown>;

type LogRecord = {
  level: LogLevel;
  ts: string;
  msg: string;
} & LogContext;

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function isLogLevel(value: string): value is LogLevel {
  return (LEVELS as readonly string[]).includes(value);
}

function resolveLevel(): LogLevel {
  const raw = process.env.DENNOH_LOG_LEVEL;
  if (raw && isLogLevel(raw)) return raw;
  return "info";
}

function write(level: LogLevel, msg: string, ctx?: LogContext): void {
  const threshold = resolveLevel();
  if (LEVEL_RANK[level] < LEVEL_RANK[threshold]) return;

  const record: LogRecord = {
    level,
    ts: new Date().toISOString(),
    msg,
    ...(ctx ?? {}),
  };

  process.stderr.write(`${JSON.stringify(record)}\n`);
}

export const log = {
  debug: (msg: string, ctx?: LogContext): void => write("debug", msg, ctx),
  info: (msg: string, ctx?: LogContext): void => write("info", msg, ctx),
  warn: (msg: string, ctx?: LogContext): void => write("warn", msg, ctx),
  error: (msg: string, ctx?: LogContext): void => write("error", msg, ctx),
};
