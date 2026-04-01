import type { UiToExtMessage } from "./protocol";
import type { AiSidebarUiDispatchHost } from "./aiSidebarUiDispatchHost";
import { presentResolveApprovalOutcome } from "./missionActionOutcomePresentation";
import { presentResolveApprovalOutcomeEvent } from "../missions/missionActionOutcomeEventPresentation";
import { saveOperatorActionMissionEventIfChanged } from "../missions/missionActionOutcomeEventLogging";

export async function dispatchUi_approve(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "approve" }>
): Promise<boolean> {
  const out = await host.orchestrator.resolveApproval(msg.missionId, msg.approvalId, true);
  const safe = out ?? { kind: "noop_unknown_approval", missionId: msg.missionId, approvalId: msg.approvalId };
  host.postMessage({ type: "info", message: presentResolveApprovalOutcome(safe) });
  const evt = presentResolveApprovalOutcomeEvent(safe);
  if (evt) {
    await saveOperatorActionMissionEventIfChanged({ store: host.missionStore, missionId: msg.missionId, message: evt });
  }
  host.postMissionDashboardSnapshotImmediate(msg.interactionId);
  host.scheduleBackgroundDashboardReconciliation();
  return true;
}

export async function dispatchUi_reject(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "reject" }>
): Promise<boolean> {
  const out = await host.orchestrator.resolveApproval(msg.missionId, msg.approvalId, false);
  const safe = out ?? { kind: "noop_unknown_approval", missionId: msg.missionId, approvalId: msg.approvalId };
  host.postMessage({ type: "info", message: presentResolveApprovalOutcome(safe) });
  const evt = presentResolveApprovalOutcomeEvent(safe);
  if (evt) {
    await saveOperatorActionMissionEventIfChanged({ store: host.missionStore, missionId: msg.missionId, message: evt });
  }
  host.postMissionDashboardSnapshotImmediate(msg.interactionId);
  host.scheduleBackgroundDashboardReconciliation();
  return true;
}

export async function dispatchUi_approveBundle(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "approveBundle" }>
): Promise<boolean> {
  await host.resolveBundle(msg.bundleId, true, msg.interactionId);
  return true;
}

export async function dispatchUi_rejectBundle(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "rejectBundle" }>
): Promise<boolean> {
  await host.resolveBundle(msg.bundleId, false, msg.interactionId);
  return true;
}

export async function dispatchUi_reviewPendingDiff(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "reviewPendingDiff" }>
): Promise<boolean> {
  await host.reviewPendingDiff(msg.missionId, msg.approvalId);
  return true;
}

export async function dispatchUi_reviewPendingHunks(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "reviewPendingHunks" }>
): Promise<boolean> {
  await host.reviewPendingHunks(msg.missionId, msg.approvalId);
  return true;
}
