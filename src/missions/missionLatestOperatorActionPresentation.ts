import type { Mission } from "../types";

export function latestOperatorActionNoteForMission(mission: Mission): string | undefined {
  // Avoid overriding terminal meaning; completion/cancel already conveys final operator-relevant state.
  if (mission.status === "completed" || mission.status === "cancelled") return undefined;
  const ev = [...(mission.events || [])].reverse().find((e) => e.source === "operator-action" && typeof e.message === "string");
  if (!ev) return undefined;

  // Compact, operator-facing: reuse durable event wording, but strip redundant prefixes.
  let msg = ev.message.trim();
  msg = msg.replace(/^Mission start requested;\s*/i, "");
  msg = msg.replace(/^Resume requested;\s*/i, "");
  msg = msg.replace(/^Approval\s+/i, "Approval ");
  return `Latest operator action: ${msg}`;
}

export function focusedMissionLatestOperatorActionNoteForSnapshot(mission: Mission | undefined): string | undefined {
  if (!mission) return undefined;
  return latestOperatorActionNoteForMission(mission);
}

