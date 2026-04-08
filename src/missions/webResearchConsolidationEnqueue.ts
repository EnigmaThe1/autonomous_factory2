import type { MissionStore } from "./MissionStore";
import type { WorkItem } from "../types";
import { uid } from "../util";

/**
 * When web research hits a configured per-mission cap, queue a single researcher pass to
 * synthesize mission memory instead of burning more network calls in a tight loop.
 */
export async function enqueueWebResearchConsolidationIfAbsent(
  store: MissionStore,
  missionId: string,
  input: { limit: number; current: number; triggerTool: string; detail: string }
): Promise<boolean> {
  const m = store.get(missionId);
  if (!m) return false;
  const dup = m.queue.some(
    (w) =>
      w.workItemPurpose === "web_research_consolidate" && (w.status === "todo" || w.status === "running")
  );
  if (dup) return false;

  const work: WorkItem = {
    id: uid("work"),
    title: "Consolidate web research (call budget)",
    role: "researcher",
    status: "todo",
    workItemPurpose: "web_research_consolidate",
    prompt: [
      "The mission hit its configured webSearch/fetchWebPage call budget.",
      `Trigger: ${input.triggerTool}; count ${input.current}/${input.limit}.`,
      `Context: ${input.detail.slice(0, 800)}`,
      "",
      "Do not call webSearch or fetchWebPage unless you find a single unavoidable gap after reading mission memory.",
      "Synthesize existing `research_evidence` / tool_result findings, note conflicts, and state bounded conclusions with explicit unknowns."
    ].join("\n")
  };
  await store.enqueue(missionId, [work]);
  await store.saveEvent(missionId, {
    level: "info",
    source: "web-research",
    message: "Queued researcher work item to consolidate web evidence after call budget was reached."
  });
  return true;
}
