export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

/**
 * Create a per-invocation temp filename for atomic file writes.
 *
 * Why: `DiskMissionPersistence.writeJsonAtomic()` previously used a fixed `${final}.tmp`,
 * which can collide under concurrent writers for the same final path.
 */
export function atomicTempFsPath(finalFsPath: string): string {
  return `${finalFsPath}.${uid("atomic")}.tmp`;
}

export function trimText(input: string, max = 12000): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max)}\n\n...[truncated ${input.length - max} chars]`;
}

export function parseRole(input: string): import("./types").AgentRole {
  const map: Record<string, import("./types").AgentRole> = {
    planner: "planner",
    researcher: "researcher",
    implementer: "implementer",
    reviewer: "reviewer",
    validator: "validator",
    architect: "architect"
  };
  return map[input.toLowerCase()] || "implementer";
}

export function tokenise(text: string): string[] {
  return Array.from(new Set(text.toLowerCase().match(/[a-z0-9_]{3,}/g) || []));
}

/** True when an error or signal indicates the operator aborted an LLM/provider stream. */
export function isLikelyStreamAbort(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string };
  if (e.name === "AbortError") return true;
  const msg = typeof e.message === "string" ? e.message : "";
  return /abort(ed)?|cancel(l(ed|ation))?/i.test(msg);
}

/**
 * Share one in-flight promise among concurrent callers; clear the slot in `finally` so failures can retry.
 * `slot.current` must only be written by this helper.
 */
export function runSingleFlight<T>(slot: { current: Promise<T> | null }, task: () => Promise<T>): Promise<T> {
  const existing = slot.current;
  if (existing) return existing;
  const p = task().finally(() => {
    if (slot.current === p) slot.current = null;
  });
  slot.current = p;
  return p;
}
