import { config } from "@kiln/config";
import { redact } from "./redaction.js";

/**
 * Structured logging. Every value passes through redaction on the way out —
 * making that the default rather than the caller's responsibility is the only
 * version of this that survives contact with a deadline.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogFields {
  readonly runId?: string;
  readonly ventureId?: string;
  readonly accountId?: string;
  readonly taskId?: string;
  readonly agentId?: string;
  readonly toolId?: string;
  readonly [key: string]: unknown;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Returns a logger that stamps `fields` onto every subsequent line. */
  child(fields: LogFields): Logger;
}

function emit(level: LogLevel, message: string, fields: LogFields): void {
  if (ORDER[level] < ORDER[config().LOG_LEVEL]) return;

  const line = {
    level,
    ts: new Date().toISOString(),
    msg: message,
    ...redact(fields),
  };

  const serialised = config().NODE_ENV === "development" ? prettyPrint(line) : JSON.stringify(line);
  if (level === "error") console.error(serialised);
  else if (level === "warn") console.warn(serialised);
  else console.log(serialised);
}

const LEVEL_TAG: Record<LogLevel, string> = { debug: "·", info: "→", warn: "!", error: "×" };

function prettyPrint(line: Record<string, unknown>): string {
  const { level, ts, msg, ...rest } = line as { level: LogLevel; ts: string; msg: string };
  const time = ts.slice(11, 19);
  const extras = Object.entries(rest)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");
  return `${time} ${LEVEL_TAG[level]} ${msg}${extras ? `  ${extras}` : ""}`;
}

export function createLogger(base: LogFields = {}): Logger {
  const make = (bound: LogFields): Logger => ({
    debug: (m, f) => emit("debug", m, { ...bound, ...f }),
    info: (m, f) => emit("info", m, { ...bound, ...f }),
    warn: (m, f) => emit("warn", m, { ...bound, ...f }),
    error: (m, f) => emit("error", m, { ...bound, ...f }),
    child: (f) => make({ ...bound, ...f }),
  });
  return make(base);
}

export const logger: Logger = createLogger();
