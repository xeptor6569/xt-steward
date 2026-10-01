import { pino, type Logger, type LoggerOptions } from "pino";

export type { Logger };

export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Pino redaction paths applied to every Steward logger so bearer secrets,
 * cookies, and passwords never reach log output even if an object carrying
 * them is logged by mistake.
 */
export const SENSITIVE_LOG_PATHS = [
  "token",
  "*.token",
  "credential",
  "*.credential",
  "password",
  "*.password",
  "tokenHash",
  "*.tokenHash",
  "credentialHash",
  "*.credentialHash",
  "authorization",
  "*.authorization",
  "cookie",
  "*.cookie",
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
];

export interface CreateLoggerOptions {
  service: string;
  level?: string;
  pretty?: boolean;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const loggerOptions: LoggerOptions = {
    level: options.level ?? "info",
    base: { service: options.service },
    redact: { paths: SENSITIVE_LOG_PATHS, censor: "[REDACTED]" },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  if (options.pretty) {
    loggerOptions.transport = { target: "pino-pretty", options: { colorize: true } };
  }
  return pino(loggerOptions);
}
