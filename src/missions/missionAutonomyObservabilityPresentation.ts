/**
 * Host-derived mission inspector fields: autonomy context, last pass stop reason, recovery, approvals.
 */
import type { Mission } from "../types";
import { loadMissionAutonomyPolicy } from "../security/missionAutonomyPolicy";
import type { PolicyConfigGet } from "../security/missionAutonomyPolicyTypes";
import { normalizeBlueprintModeSetting } from "./missionBlueprintMode";
import { classifyImplementerHardStopDownstreamGate } from "./requiredImplementerHardStopGate";
import { isActiveWorkItemStatus, isRunnableWorkItemStatus } from "./workItemLifecycle";

export interface FocusedMissionAutonomyObservability {
  autonomyMode: string;
  blueprintMode: string;
  blueprintPlanning: string;
  lastRunPassStopReason?: string;
  missionStatus: string;
  blockReasonCode?: string;
  failureClass?: string;
  recoveryChainSummary?: string;
  pendingApprovalPreview?: string;
}

function summarizeRecoveryChains(mission: Mission): string | undefined {
  const active = new Map<string, number>();
  for (const w of mission.queue || []) {
    if (!w.recoveryChainId) continue;
    if (!isRunnableWorkItemStatus(w.status) && !isActiveWorkItemStatus(w.status)) continue;
    active.set(w.recoveryChainId, (active.get(w.recoveryChainId) || 0) + 1);
  }
  if (active.size === 0) return undefined;
  const parts = [...active.entries()].map(([id, n]) => `${id.slice(0, 10)}…×${n}`);
  return `${active.size} active recovery chain(s): ${parts.join("; ")}`;
}

function pendingApprovalOneLiner(mission: Mission): string | undefined {
  const p = mission.approvals?.find((a) => a.status === "pending");
  if (!p) return undefined;
  const t = (p.title || p.kind || "approval").slice(0, 120);
  return `${p.kind}: ${t}`;
}

/**
 * Build compact autonomy / runner observability for the focused mission (snapshot merge).
 */
export function focusedMissionAutonomyObservabilityForSnapshot(
  mission: Mission | undefined,
  get: PolicyConfigGet
): FocusedMissionAutonomyObservability | undefined {
  if (!mission) return undefined;
  const policy = loadMissionAutonomyPolicy(get);
  const rawBp = get("myAi.missions.blueprintMode", "off");
  const blueprintMode = normalizeBlueprintModeSetting(rawBp);
  const gate = classifyImplementerHardStopDownstreamGate(mission);

  return {
    autonomyMode: policy.mode,
    blueprintMode,
    blueprintPlanning: policy.blueprintPlanning,
    lastRunPassStopReason: mission.runtime?.lastRunPassStopReason,
    missionStatus: mission.status,
    blockReasonCode: mission.blockReasonCode,
    failureClass: gate.gate ? gate.failureClass : undefined,
    recoveryChainSummary: summarizeRecoveryChains(mission),
    pendingApprovalPreview: pendingApprovalOneLiner(mission)
  };
}
