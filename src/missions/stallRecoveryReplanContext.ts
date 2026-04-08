import type { Mission } from "../types";
import { trimText } from "../util";

export interface StallRecoveryContextInput {
  stalledHeartbeats: number;
  threshold: number;
  /** 1-based attempt number after this injection */
  replanAttempt: number;
  maxAutoReplans: number;
}

/**
 * Builds the planner prompt for automatic stall recovery so the model sees why the runner
 * intervened and what tools/events preceded the stall.
 */
export function buildStallRecoveryReplanPrompt(mission: Mission, ctx: StallRecoveryContextInput): string {
  const events = mission.events || [];
  const toolEvents = events.filter((e) => e.source.startsWith("tool:")).slice(-16);
  const recentMixed = events.slice(-10);

  const lines: string[] = [];
  lines.push("## Stall recovery (automatic)");
  lines.push(
    `The background runner detected no mission run-loop progress for ${ctx.stalledHeartbeats} heartbeat(s) (threshold ${ctx.threshold}).`
  );
  lines.push(
    `This is automatic replan attempt ${ctx.replanAttempt} of ${ctx.maxAutoReplans}. Further stalls without progress may block the mission for operator review.`
  );
  lines.push("");
  lines.push("### Mission state");
  lines.push(`- Title: ${trimText(mission.title, 200)}`);
  lines.push(`- Mission status: ${mission.status}`);
  if (mission.blocker) lines.push(`- Blocker (if any): ${trimText(mission.blocker, 300)}`);
  lines.push(`- blockReasonCode: ${mission.blockReasonCode || "(none)"}`);
  lines.push(`- validationState: ${mission.validationState || "unknown"}`);
  lines.push(`- filesModified (count): ${(mission.filesModified || []).length}`);
  lines.push(`- pending approvals: ${(mission.approvals || []).filter((a) => a.status === "pending").length}`);
  lines.push("");
  lines.push("### Work queue (compact)");
  for (const w of mission.queue.slice(0, 24)) {
    const flags = [w.hardStopClass ? `hsc=${w.hardStopClass}` : "", w.deadLetter ? "deadLetter" : ""]
      .filter(Boolean)
      .join(", ");
    lines.push(`- [${w.status}] ${w.role}: ${trimText(w.title, 120)}${flags ? ` (${flags})` : ""}`);
  }
  if (mission.queue.length > 24) lines.push(`- … ${mission.queue.length - 24} more row(s)`);
  lines.push("");
  lines.push("### Recent tool outcomes (oldest → newest within window)");
  if (!toolEvents.length) lines.push("(No tool:* events in recent history.)");
  else {
    for (const e of toolEvents) {
      lines.push(`- [${e.level}] ${e.source}: ${trimText(e.message, 240)}`);
    }
  }
  lines.push("");
  lines.push("### Recent mission events (tail)");
  for (const e of recentMixed) {
    lines.push(`- [${e.level}] ${e.source}: ${trimText(e.message, 200)}`);
  }
  lines.push("");
  lines.push("## Your task");
  lines.push(
    "Re-plan from the current state: explain likely stall causes using the evidence above, propose the smallest next concrete tranche, and enqueue or adjust implementer / reviewer / validator work as needed. If a tool failed repeatedly, change strategy rather than repeating the same tool path."
  );

  return lines.join("\n");
}
