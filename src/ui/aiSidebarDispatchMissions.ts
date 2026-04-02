import * as vscode from "vscode";
import { AgentRole } from "../types";
import {
  editAgentRoutingForMission,
  editMissionDagForMission,
  editMissionPolicyForMission,
  openApprovalBundleSummaryForMission
} from "../commands/registerCommands";
import {
  copyMissionBlueprintMarkdownToClipboard,
  exportMissionBlueprintToWorkspaceFile
} from "../missions/missionBlueprintExportActions";
import { generateMissionReport } from "../missions/missionReport";
import { MISSION_LIST_INCLUDE_ARCHIVED_KEY } from "./aiSidebarConstants";
import type { UiToExtMessage } from "./protocol";
import type { AiSidebarUiDispatchHost } from "./aiSidebarUiDispatchHost";

export async function dispatchUi_setMissionListIncludeArchived(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "setMissionListIncludeArchived" }>
): Promise<boolean> {
  const next = !!msg.includeArchived;
  host.traceLogger.log({
    level: "info",
    side: "host",
    category: "missions",
    event: "set_include_archived",
    interactionId: msg.interactionId,
    data: { includeArchived: next }
  });
  host.setIncludeArchivedMissions(next);
  host.traceLogger.log({
    level: "debug",
    side: "host",
    category: "missions",
    event: "workspace_state_update_start",
    interactionId: msg.interactionId,
    messageType: "workspaceState",
    data: { key: MISSION_LIST_INCLUDE_ARCHIVED_KEY }
  });
  await host.workspaceState.update(MISSION_LIST_INCLUDE_ARCHIVED_KEY, next);
  host.traceLogger.log({
    level: "debug",
    side: "host",
    category: "missions",
    event: "workspace_state_update_done",
    interactionId: msg.interactionId,
    messageType: "workspaceState",
    ok: true,
    data: { key: MISSION_LIST_INCLUDE_ARCHIVED_KEY }
  });
  host.postMissionDashboardSnapshotImmediate(msg.interactionId);
  host.scheduleBackgroundDashboardReconciliation();
  return true;
}

export async function dispatchUi_archiveMission(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "archiveMission" }>
): Promise<boolean> {
  const before = host.missionStore.list().find((m) => m.id === msg.missionId);
  const pick = await vscode.window.showWarningMessage(
    "Archive this mission? It will be hidden from the default mission list until you enable “Show archived”.",
    { modal: true },
    "Archive"
  );
  if (pick !== "Archive") return false;
  await host.missionStore.archiveMission(msg.missionId);
  const after = host.missionStore.list().find((m) => m.id === msg.missionId);
  host.traceLogger.log({
    level: "debug",
    side: "host",
    category: "missions",
    event: "archive_mutation",
    data: {
      missionId: msg.missionId,
      beforeArchived: !!before?.archivedAt,
      afterArchived: !!after?.archivedAt
    }
  });
  if (host.getFocusedMissionId() === msg.missionId && !host.getIncludeArchivedMissions()) host.setFocusedMissionId(undefined);
  void vscode.window.showInformationMessage("My AI: Mission archived.");
  host.postMissionDashboardSnapshotImmediate(msg.interactionId);
  host.scheduleBackgroundDashboardReconciliation();
  return true;
}

export async function dispatchUi_unarchiveMission(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "unarchiveMission" }>
): Promise<boolean> {
  await host.missionStore.unarchiveMission(msg.missionId);
  host.traceLogger.log({
    level: "debug",
    side: "host",
    category: "missions",
    event: "unarchive_mutation",
    data: {
      missionId: msg.missionId,
      archivedAfter: !!host.missionStore.list().find((m) => m.id === msg.missionId)?.archivedAt
    }
  });
  void vscode.window.showInformationMessage("My AI: Mission restored from archive.");
  host.postMissionDashboardSnapshotImmediate(msg.interactionId);
  host.scheduleBackgroundDashboardReconciliation();
  return true;
}

export async function dispatchUi_deleteMission(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "deleteMission" }>
): Promise<boolean> {
  const beforeCount = host.missionStore.list().length;
  const pick = await vscode.window.showWarningMessage(
    "Delete this mission permanently from extension mission storage (global state + mission JSON)? Workspace source files are not removed.",
    { modal: true },
    "Delete"
  );
  if (pick !== "Delete") return false;
  await host.missionStore.deleteMission(msg.missionId);
  const afterCount = host.missionStore.list().length;
  host.traceLogger.log({
    level: "debug",
    side: "host",
    category: "missions",
    event: "delete_mutation",
    data: {
      missionId: msg.missionId,
      beforeCount,
      afterCount,
      removed: !host.missionStore.list().some((m) => m.id === msg.missionId)
    }
  });
  if (host.getFocusedMissionId() === msg.missionId) host.setFocusedMissionId(undefined);
  void vscode.window.showInformationMessage("My AI: Mission deleted.");
  host.postMissionDashboardSnapshotImmediate(msg.interactionId);
  host.scheduleBackgroundDashboardReconciliation();
  return true;
}

export async function dispatchUi_bulkArchiveCompletedMissions(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "bulkArchiveCompletedMissions" }>
): Promise<boolean> {
  const pick = await vscode.window.showWarningMessage(
    "Archive all completed missions that are not already archived?",
    { modal: true },
    "Archive completed"
  );
  if (pick !== "Archive completed") return false;
  const n = await host.missionStore.bulkArchiveCompletedMissions();
  host.traceLogger.log({
    level: "debug",
    side: "host",
    category: "missions",
    event: "bulk_archive_completed_mutation",
    data: { archivedCount: n }
  });
  void vscode.window.showInformationMessage(
    n ? `My AI: Archived ${n} completed mission(s).` : "My AI: No completed missions to archive."
  );
  host.postMissionDashboardSnapshotImmediate(msg.interactionId);
  host.scheduleBackgroundDashboardReconciliation();
  return true;
}

export async function dispatchUi_bulkDeleteFailedTestMissions(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "bulkDeleteFailedTestMissions" }>
): Promise<boolean> {
  const pick = await vscode.window.showWarningMessage(
    "Delete failed missions that match the test/debug heuristic (see docs: word “test”, test7, testing, etc.)?",
    { modal: true },
    "Delete failed tests"
  );
  if (pick !== "Delete failed tests") return false;
  const { deleted, skipped } = await host.missionStore.bulkDeleteFailedTestMissions();
  host.traceLogger.log({
    level: "debug",
    side: "host",
    category: "missions",
    event: "bulk_delete_failed_test_mutation",
    data: { deleted, skipped }
  });
  void vscode.window.showInformationMessage(
    deleted || skipped
      ? `My AI: Deleted ${deleted} failed test mission(s)${skipped ? `; ${skipped} skipped (still active or error)` : ""}.`
      : "My AI: No matching failed test missions to delete."
  );
  host.postMissionDashboardSnapshotImmediate(msg.interactionId);
  host.scheduleBackgroundDashboardReconciliation();
  return true;
}

export async function dispatchUi_bulkDeleteBlockedTestMissions(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "bulkDeleteBlockedTestMissions" }>
): Promise<boolean> {
  const pick = await vscode.window.showWarningMessage(
    "Delete blocked missions that match the test/debug heuristic (see docs: word “test”, test7, testing, etc.)?",
    { modal: true },
    "Delete blocked tests"
  );
  if (pick !== "Delete blocked tests") return false;
  const { deleted, skipped } = await host.missionStore.bulkDeleteBlockedTestMissions();
  host.traceLogger.log({
    level: "debug",
    side: "host",
    category: "missions",
    event: "bulk_delete_blocked_test_mutation",
    data: { deleted, skipped }
  });
  void vscode.window.showInformationMessage(
    deleted || skipped
      ? `My AI: Deleted ${deleted} blocked test mission(s)${skipped ? `; ${skipped} skipped (still active or error)` : ""}.`
      : "My AI: No matching blocked test missions to delete."
  );
  host.postMissionDashboardSnapshotImmediate(msg.interactionId);
  host.scheduleBackgroundDashboardReconciliation();
  return true;
}

function normalizeWebviewMissionIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.length > 0);
}

export async function dispatchUi_bulkArchiveVisibleCompletedMissions(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "bulkArchiveVisibleCompletedMissions" }>
): Promise<boolean> {
  const ids = normalizeWebviewMissionIds(msg.missionIds);
  if (!ids.length) return true;

  const pick = await vscode.window.showWarningMessage(
    `Archive ${ids.length} completed mission(s) from the missions currently shown in your filtered list? Only missions that are still completed and not already archived will be archived.`,
    { modal: true },
    "Archive visible completed"
  );
  if (pick !== "Archive visible completed") return false;

  let archived = 0;
  const succeeded: string[] = [];
  for (const id of ids) {
    const m = host.missionStore.list().find((x) => x.id === id);
    if (!m || m.status !== "completed" || m.archivedAt) continue;
    try {
      await host.missionStore.archiveMission(id);
      archived++;
      succeeded.push(id);
    } catch {
      /* skip rows that cannot be archived */
    }
  }

  const focus = host.getFocusedMissionId();
  if (focus && succeeded.includes(focus) && !host.getIncludeArchivedMissions()) {
    host.setFocusedMissionId(undefined);
  }

  host.traceLogger.log({
    level: "debug",
    side: "host",
    category: "missions",
    event: "bulk_archive_visible_completed_mutation",
    data: { requested: ids.length, archived, succeededCount: succeeded.length }
  });
  void vscode.window.showInformationMessage(
    archived
      ? `My AI: Archived ${archived} visible completed mission(s).`
      : "My AI: No matching completed missions to archive (list may have changed)."
  );
  host.postMissionDashboardSnapshotImmediate(msg.interactionId);
  host.scheduleBackgroundDashboardReconciliation();
  return true;
}

export async function dispatchUi_bulkDeleteVisibleFailedOrCancelledMissions(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "bulkDeleteVisibleFailedOrCancelledMissions" }>
): Promise<boolean> {
  const ids = normalizeWebviewMissionIds(msg.missionIds);
  if (!ids.length) return true;

  const pick = await vscode.window.showWarningMessage(
    `Permanently delete ${ids.length} failed or cancelled mission(s) from the missions currently shown in your filtered list? Workspace source files are not removed.`,
    { modal: true },
    "Delete visible failed/cancelled"
  );
  if (pick !== "Delete visible failed/cancelled") return false;

  let deleted = 0;
  let skipped = 0;
  const succeeded: string[] = [];
  for (const id of ids) {
    const m = host.missionStore.list().find((x) => x.id === id);
    if (!m || (m.status !== "failed" && m.status !== "cancelled")) continue;
    try {
      await host.missionStore.deleteMission(id);
      deleted++;
      succeeded.push(id);
    } catch {
      skipped++;
    }
  }

  const focus = host.getFocusedMissionId();
  if (focus && succeeded.includes(focus)) host.setFocusedMissionId(undefined);

  host.traceLogger.log({
    level: "debug",
    side: "host",
    category: "missions",
    event: "bulk_delete_visible_failed_cancelled_mutation",
    data: { requested: ids.length, deleted, skipped }
  });
  void vscode.window.showInformationMessage(
    deleted || skipped
      ? `My AI: Deleted ${deleted} visible failed/cancelled mission(s)${skipped ? `; ${skipped} skipped` : ""}.`
      : "My AI: No matching failed/cancelled missions to delete (list may have changed)."
  );
  host.postMissionDashboardSnapshotImmediate(msg.interactionId);
  host.scheduleBackgroundDashboardReconciliation();
  return true;
}

export async function dispatchUi_bulkDeleteVisibleBlockedMissions(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "bulkDeleteVisibleBlockedMissions" }>
): Promise<boolean> {
  const ids = normalizeWebviewMissionIds(msg.missionIds);
  if (!ids.length) return true;

  const pick = await vscode.window.showWarningMessage(
    `Permanently delete ${ids.length} blocked mission(s) from the missions currently shown in your filtered list? Workspace source files are not removed.`,
    { modal: true },
    "Delete visible blocked"
  );
  if (pick !== "Delete visible blocked") return false;

  let deleted = 0;
  let skipped = 0;
  const succeeded: string[] = [];
  for (const id of ids) {
    const m = host.missionStore.list().find((x) => x.id === id);
    if (!m || m.status !== "blocked") continue;
    try {
      await host.missionStore.deleteMission(id);
      deleted++;
      succeeded.push(id);
    } catch {
      skipped++;
    }
  }

  const focus = host.getFocusedMissionId();
  if (focus && succeeded.includes(focus)) host.setFocusedMissionId(undefined);

  host.traceLogger.log({
    level: "debug",
    side: "host",
    category: "missions",
    event: "bulk_delete_visible_blocked_mutation",
    data: { requested: ids.length, deleted, skipped }
  });
  void vscode.window.showInformationMessage(
    deleted || skipped
      ? `My AI: Deleted ${deleted} visible blocked mission(s)${skipped ? `; ${skipped} skipped` : ""}.`
      : "My AI: No matching blocked missions to delete (list may have changed)."
  );
  host.postMissionDashboardSnapshotImmediate(msg.interactionId);
  host.scheduleBackgroundDashboardReconciliation();
  return true;
}

export async function dispatchUi_editMissionPolicy(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "editMissionPolicy" }>
): Promise<boolean> {
  await editMissionPolicyForMission(host.missionStore, msg.missionId);
  host.focusMission(msg.missionId);
  return true;
}

export async function dispatchUi_editAgentRouting(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "editAgentRouting" }>
): Promise<boolean> {
  await editAgentRoutingForMission(host.missionStore, msg.missionId);
  host.focusMission(msg.missionId);
  return true;
}

export async function dispatchUi_editMissionDag(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "editMissionDag" }>
): Promise<boolean> {
  await editMissionDagForMission(host.missionStore, msg.missionId);
  host.focusMission(msg.missionId);
  return true;
}

export async function dispatchUi_reviewBundleSummary(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "reviewBundleSummary" }>
): Promise<boolean> {
  await openApprovalBundleSummaryForMission(host.missionStore, msg.missionId);
  host.focusMission(msg.missionId);
  return true;
}

export async function dispatchUi_saveMissionRouting(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "saveMissionRouting" }>
): Promise<boolean> {
  const providerPerRole: Partial<Record<AgentRole, string>> = {};
  const modelPerRole: Partial<Record<AgentRole, string>> = {};
  for (const row of msg.roles) {
    if (row.providerId?.trim()) providerPerRole[row.role] = row.providerId.trim();
    if (row.model?.trim()) modelPerRole[row.role] = row.model.trim();
  }
  await host.missionStore.updateMission(msg.missionId, {
    activeProviderId: msg.activeProviderId.trim(),
    activeModel: msg.activeModel.trim() || undefined,
    routing: { preset: msg.preset, providerPerRole, modelPerRole }
  });
  host.postMessage({ type: "info", message: "Mission routing saved. Per-role overrides are stored on this mission." });
  host.postMessage({ type: "formCommitted", scope: "routingPanel" });
  host.postMissionDashboardSnapshotImmediate(undefined);
  host.scheduleBackgroundDashboardReconciliation();
  return true;
}

export async function dispatchUi_generateMissionReport(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "generateMissionReport" }>
): Promise<boolean> {
  const mission = host.missionStore.get(msg.missionId);
  if (!mission) {
    host.postMessage({ type: "error", message: "Mission not found." });
    return true;
  }
  const report = generateMissionReport(mission);
  host.postMessage({ type: "missionReportReady", missionId: msg.missionId, markdown: report.markdown });
  return true;
}

export async function dispatchUi_approveMissionBlueprint(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "approveMissionBlueprint" }>
): Promise<boolean> {
  const out = await host.orchestrator.approveMissionBlueprint(msg.missionId);
  void vscode.window.showInformationMessage(out.message);
  host.postMissionDashboardSnapshotImmediate();
  host.scheduleBackgroundDashboardReconciliation();
  return true;
}

export async function dispatchUi_rejectMissionBlueprint(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "rejectMissionBlueprint" }>
): Promise<boolean> {
  const out = await host.orchestrator.rejectMissionBlueprint(msg.missionId);
  void vscode.window.showInformationMessage(out.message);
  host.postMissionDashboardSnapshotImmediate();
  host.scheduleBackgroundDashboardReconciliation();
  return true;
}

export async function dispatchUi_requestMissionBlueprintRevision(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "requestMissionBlueprintRevision" }>
): Promise<boolean> {
  const out = await host.orchestrator.requestMissionBlueprintRevision(msg.missionId, msg.note);
  void vscode.window.showInformationMessage(out.message);
  host.postMissionDashboardSnapshotImmediate();
  host.scheduleBackgroundDashboardReconciliation();
  return true;
}

export async function dispatchUi_submitPreBlueprintAnswers(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "submitPreBlueprintAnswers" }>
): Promise<boolean> {
  const out = await host.orchestrator.submitPreBlueprintClarificationAnswers(msg.missionId, msg.answers);
  void vscode.window.showInformationMessage(out.message);
  host.postMissionDashboardSnapshotImmediate();
  host.scheduleBackgroundDashboardReconciliation();
  return true;
}

export async function dispatchUi_exportMissionBlueprint(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "exportMissionBlueprint" }>
): Promise<boolean> {
  const mission = host.missionStore.get(msg.missionId);
  if (!mission) {
    host.postMessage({ type: "error", message: "Mission not found." });
    return true;
  }
  const out = await exportMissionBlueprintToWorkspaceFile(mission);
  if (out.ok) {
    void vscode.window.showInformationMessage(out.message);
    void vscode.window.showTextDocument(out.exportedUri);
  } else if (out.message !== "Export cancelled.") {
    void vscode.window.showWarningMessage(out.message);
  }
  return true;
}

export async function dispatchUi_copyMissionBlueprint(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "copyMissionBlueprint" }>
): Promise<boolean> {
  const mission = host.missionStore.get(msg.missionId);
  if (!mission) {
    host.postMessage({ type: "error", message: "Mission not found." });
    return true;
  }
  const out = await copyMissionBlueprintMarkdownToClipboard(mission);
  if (out.ok) {
    void vscode.window.showInformationMessage("Blueprint markdown copied to clipboard.");
  } else {
    void vscode.window.showWarningMessage(out.message);
  }
  return true;
}
