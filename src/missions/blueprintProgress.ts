import type { Mission } from "../types";

export interface BlueprintProgress {
  done: number;
  total: number;
  percent: number;
  blockedStepIds: string[];
  pendingStepIds: string[];
}

/**
 * Progress from blueprint step statuses (not queue mirrors), for UI and closure guards.
 */
export function computeBlueprintProgress(mission: Mission): BlueprintProgress | undefined {
  const bp = mission.blueprint;
  if (!bp || bp.status !== "approved") return undefined;

  const required = bp.steps.filter((s) => !s.optional);
  const total = required.length;
  if (!total) {
    return { done: 0, total: 0, percent: 100, blockedStepIds: [], pendingStepIds: [] };
  }

  let done = 0;
  const blockedStepIds: string[] = [];
  const pendingStepIds: string[] = [];
  for (const s of required) {
    if (s.status === "done" || s.status === "skipped") done++;
    else if (s.status === "blocked") blockedStepIds.push(s.id);
    else pendingStepIds.push(s.id);
  }

  const percent = Math.round((done / total) * 100);
  return { done, total, percent, blockedStepIds, pendingStepIds };
}

/** True when approved blueprint has required steps not finished. */
export function blueprintBlocksMissionCompletion(mission: Mission): boolean {
  const p = computeBlueprintProgress(mission);
  if (!p) return false;
  return p.pendingStepIds.length > 0 || p.blockedStepIds.length > 0;
}
