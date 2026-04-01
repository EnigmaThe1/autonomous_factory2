import type { TraceLevel } from "./traceTypes";

/** Higher value = more verbose events included when selected as the configured maximum. */
const VERBOSITY: Record<TraceLevel, number> = {
  error: 0,
  info: 1,
  debug: 2,
  trace: 3
};

export function traceLevelPassesFilter(configLevel: TraceLevel, messageLevel: TraceLevel): boolean {
  return VERBOSITY[messageLevel] <= VERBOSITY[configLevel];
}

export function parseTraceLevel(raw: string | undefined): TraceLevel | undefined {
  if (raw === "error" || raw === "info" || raw === "debug" || raw === "trace") return raw;
  return undefined;
}
