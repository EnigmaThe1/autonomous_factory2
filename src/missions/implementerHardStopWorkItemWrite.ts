import type { WorkItem } from "../types";
import type { MissionStore } from "./MissionStore";
import { isKnownImplementerHardStopClassValue } from "./implementerHardStopClassInvariant";

export function isRequiredImplementerWorkItem(item: WorkItem): boolean {
  return item.role === "implementer" && item.requiredForCompletion !== false;
}

function effectiveStatus(item: WorkItem, patch: Partial<WorkItem>): WorkItem["status"] {
  return patch.status !== undefined ? patch.status : item.status;
}

function effectiveHardStopClass(item: WorkItem, patch: Partial<WorkItem>): unknown {
  return patch.hardStopClass !== undefined ? patch.hardStopClass : item.hardStopClass;
}

/**
 * Persists a work item patch and enforces: required implementer rows written as `blocked` or `failed`
 * must carry a known `hardStopClass` (in the patch or already on the item). Fails fast so malformed
 * rows are hard to create; read-time malformed detection remains a safety net.
 */
export async function updateWorkItemWithImplementerHardStopInvariant(
  store: MissionStore,
  missionId: string,
  itemBeforePatch: WorkItem,
  patch: Partial<WorkItem>
): Promise<void> {
  const nextStatus = effectiveStatus(itemBeforePatch, patch);
  if (
    isRequiredImplementerWorkItem(itemBeforePatch) &&
    (nextStatus === "blocked" ||
      nextStatus === "failed" ||
      nextStatus === "awaiting_approval" ||
      nextStatus === "dead_letter")
  ) {
    const hc = effectiveHardStopClass(itemBeforePatch, patch);
    if (!isKnownImplementerHardStopClassValue(hc)) {
      throw new Error(
        `Orchestrator invariant: required implementer work ${itemBeforePatch.id} cannot be persisted as ${nextStatus} without a known hardStopClass (got ${JSON.stringify(hc)}).`
      );
    }
  }
  await store.updateWorkItem(missionId, itemBeforePatch.id, patch);
}
