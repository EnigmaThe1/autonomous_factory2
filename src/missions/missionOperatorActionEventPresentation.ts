import type { Mission } from "../types";
import type { ResumeMissionOutcome, StartMissionResult } from "./missionActionResult";
import {
  OPERATOR_ACTION_BUNDLE_APPROVED_MESSAGE,
  OPERATOR_ACTION_BUNDLE_REJECTED_MESSAGE,
  presentResolveApprovalOutcomeEvent,
  presentResumeMissionOutcomeEvent,
  presentStartMissionOutcomeEvent
} from "./missionActionOutcomeEventPresentation";

/**
 * Compact scan line for Timeline (and similar) when `source === "operator-action"`.
 * Derived from the same durable strings as `present*OutcomeEvent`; unknown messages return undefined
 * so callers fall back to generic event formatting.
 */
export function operatorActionEventTimelineHeadline(message: string): string | undefined {
  const t = message.trim();
  const exact = buildExactOperatorActionHeadlineMap().get(t);
  if (exact) return exact;

  const terminal = t.match(/^Resume requested, but mission is already terminal \(([^)]+)\)\.$/);
  if (terminal) return `Resume: no-op (already ${terminal[1]})`;

  const passDone = t.match(/^Resume requested; a run pass finished with status: (.+)\.$/);
  if (passDone) return `Resume: pass ended (${passDone[1]})`;

  return undefined;
}

let exactMapCache: ReadonlyMap<string, string> | undefined;

function buildExactOperatorActionHeadlineMap(): ReadonlyMap<string, string> {
  if (exactMapCache) return exactMapCache;
  const dummyMission = { id: "m" } as Mission;
  const startScheduled: StartMissionResult = {
    mission: dummyMission,
    pass: { kind: "scheduled_pass", missionId: "m" }
  };
  const startBlocked: StartMissionResult = {
    mission: dummyMission,
    pass: {
      kind: "blocked_before_schedule",
      missionId: "m",
      statusAfter: "blocked",
      reason: "compiler_blocked",
      summary: "Compiler blocked start."
    }
  };
  const entries: Array<[string, string]> = [
    [presentStartMissionOutcomeEvent(startScheduled), "Start: execution scheduled"],
    [presentStartMissionOutcomeEvent(startBlocked), "Start: compiler blocked"]
  ];

  const resumeStatic: Array<{ out: ResumeMissionOutcome; headline: string }> = [
    { out: { kind: "joined_in_flight_pass", missionId: "m" }, headline: "Resume: joined active pass" },
    {
      out: { kind: "gated_awaiting_input", missionId: "m" },
      headline: "Resume: gated — waiting for input"
    },
    {
      out: { kind: "gated_pending_approval", missionId: "m" },
      headline: "Resume: gated — waiting for approval"
    }
  ];
  for (const { out, headline } of resumeStatic) {
    const msg = presentResumeMissionOutcomeEvent(out);
    if (msg) entries.push([msg, headline]);
  }

  const appr = presentResolveApprovalOutcomeEvent({ kind: "approved_continuation_scheduled", missionId: "m" });
  const rej = presentResolveApprovalOutcomeEvent({
    kind: "rejected_mission_blocked",
    missionId: "m",
    statusAfter: "blocked"
  });
  if (appr) entries.push([appr, "Approval: continuation scheduled"]);
  if (rej) entries.push([rej, "Approval: rejected — mission blocked"]);

  entries.push([OPERATOR_ACTION_BUNDLE_APPROVED_MESSAGE, "Bundle: continuation scheduled"]);
  entries.push([OPERATOR_ACTION_BUNDLE_REJECTED_MESSAGE, "Bundle: rejected — mission blocked"]);

  exactMapCache = new Map(entries);
  return exactMapCache;
}

/** Non-empty trimmed string; avoids `Record` keys that collide or fail webview lookup. */
function isUsableMissionEventIdForHeadlineKey(id: unknown): id is string {
  return typeof id === "string" && id.trim().length > 0;
}

/**
 * For focused-mission UI (inspector, console): map `MissionEvent.id` → headline when the event is a known
 * durable `operator-action` message. Reuses {@link operatorActionEventTimelineHeadline}.
 * Events without a usable `id` are skipped (no fabricated keys).
 */
export function operatorActionHeadlinesByEventIdForMission(mission: Mission | undefined): Record<string, string> | undefined {
  if (!mission?.events?.length) return undefined;
  const out: Record<string, string> = {};
  for (const ev of mission.events) {
    if (ev.source !== "operator-action" || typeof ev.message !== "string") continue;
    if (!isUsableMissionEventIdForHeadlineKey(ev.id)) continue;
    const h = operatorActionEventTimelineHeadline(ev.message);
    if (h) out[ev.id] = h;
  }
  return Object.keys(out).length ? out : undefined;
}

/** List cards: skip stale operator-action headlines (reduces noise on idle missions). */
export const MISSION_CARD_OPERATOR_ACTION_HEADLINE_MAX_AGE_MS = 72 * 60 * 60 * 1000;

/**
 * Latest **mappable** `operator-action` headline for a mission list card (non-focused UI uses this only).
 * - Terminal `completed` / `cancelled`: no line (no false “still active” cues).
 * - Uses the **most recent** `operator-action` event only; if its message is unknown, returns undefined (no scan to older events).
 * - Drops events older than {@link MISSION_CARD_OPERATOR_ACTION_HEADLINE_MAX_AGE_MS} relative to `nowMs`.
 */
export function missionCardLatestOperatorActionHeadline(mission: Mission, nowMs: number = Date.now()): string | undefined {
  if (mission.status === "completed" || mission.status === "cancelled") return undefined;
  const events = mission.events || [];
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.source !== "operator-action" || typeof ev.message !== "string") continue;
    if (nowMs - ev.ts > MISSION_CARD_OPERATOR_ACTION_HEADLINE_MAX_AGE_MS) return undefined;
    return operatorActionEventTimelineHeadline(ev.message);
  }
  return undefined;
}

export function missionListLatestOperatorActionHeadlinesForMissions(
  missions: Mission[],
  nowMs: number = Date.now()
): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const m of missions) {
    const h = missionCardLatestOperatorActionHeadline(m, nowMs);
    if (h) out[m.id] = h;
  }
  return Object.keys(out).length ? out : undefined;
}
