import type { WorkItem } from "../types";

/** Values the orchestrator may persist on `WorkItem.hardStopClass` for implementer hard-stops. */
export const KNOWN_IMPLEMENTER_HARD_STOP_CLASSES = [
  "approval_pending",
  "approval_rejected",
  "policy_blocked",
  "tool_failure",
  "operator_abort",
  "timeout_or_system_abort",
  "unknown_hard_stop"
] as const satisfies readonly NonNullable<WorkItem["hardStopClass"]>[];

export type KnownImplementerHardStopClass = (typeof KNOWN_IMPLEMENTER_HARD_STOP_CLASSES)[number];

const KNOWN_SET = new Set<string>(KNOWN_IMPLEMENTER_HARD_STOP_CLASSES);

/** True when `v` is a non-null structured implementer hard-stop class (not malformed by type). */
export function isKnownImplementerHardStopClassValue(v: unknown): v is KnownImplementerHardStopClass {
  return typeof v === "string" && KNOWN_SET.has(v);
}
