import { env } from "@project/env/server";
import { Layer, Logger, LogLevel } from "effect";

// ADR-0017 — Logger replacement: Effect's built-in `Logger` instead of
// pino. Pretty-print in dev (human-readable), JSON in prod (parsable by
// log aggregators). LOG_LEVEL env override flows through Effect's
// minimum-log-level config.

const minimumLogLevel = (() => {
  switch (env.LOG_LEVEL) {
    case "trace":
      return LogLevel.Trace;
    case "debug":
      return LogLevel.Debug;
    case "info":
      return LogLevel.Info;
    case "warn":
      return LogLevel.Warning;
    case "error":
      return LogLevel.Error;
    case "fatal":
      return LogLevel.Fatal;
    default:
      return env.NODE_ENV === "production" ? LogLevel.Info : LogLevel.Debug;
  }
})();

const formatLayer =
  env.NODE_ENV === "production"
    ? Logger.replace(Logger.defaultLogger, Logger.jsonLogger)
    : Layer.empty;

export const LoggerLive = Layer.mergeAll(
  Logger.minimumLogLevel(minimumLogLevel),
  formatLayer,
);
