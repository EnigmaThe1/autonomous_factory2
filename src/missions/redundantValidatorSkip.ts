import { Mission, WorkItem } from "../types";

/** True when this validator todo should not run again — validation already satisfied by a completed validator. */
export function shouldSkipRedundantValidatorWork(mission: Mission, item: WorkItem): boolean {
  if (item.role !== "validator") return false;
  if (mission.validationState !== "passed") return false;
  return mission.queue.some((w) => w.role === "validator" && w.status === "done");
}
