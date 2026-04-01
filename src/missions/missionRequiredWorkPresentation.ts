import type { Mission } from "../types";
import { hasRequiredBlockingOrFailedWork, hasRequiredUnresolvedWork } from "./requiredWork";

function requiredImplementerBlockedOrFailed(mission: Mission): boolean {
  return mission.queue.some(
    (w) =>
      w.role === "implementer" &&
      (w.status === "blocked" || w.status === "failed") &&
      w.requiredForCompletion !== false
  );
}

/**
 * One-line operator copy for Mission Inspector / focused mission card. Derived only from queue +
 * validationState; does not replace mission status or timeline honesty events.
 * Precedence: blocked/failed (even if other required work is still open) → open → settled.
 */
export function missionRequiredWorkOperatorHint(mission: Mission): string {
  if (hasRequiredBlockingOrFailedWork(mission)) {
    let s =
      "Required work: blocked or failed. Downstream steps may have run for context; do not treat as shipped until this is resolved.";
    if (mission.validationState === "passed" && requiredImplementerBlockedOrFailed(mission)) {
      s += " Validation passed does not clear blocked or failed required implementer work.";
    }
    return s;
  }
  if (hasRequiredUnresolvedWork(mission)) {
    return "Required work: still open (todo or in progress).";
  }
  return "Required work: settled (all required items done or skipped). Mission completion still depends on validation and policy — not implied here.";
}

/** Snapshot field: omit when terminal completed/cancelled needs no extra queue hint. */
export function focusedMissionRequiredWorkHintForSnapshot(mission: Mission | undefined): string | undefined {
  if (!mission) return undefined;
  if (mission.status === "completed" || mission.status === "cancelled") return undefined;
  return missionRequiredWorkOperatorHint(mission);
}
