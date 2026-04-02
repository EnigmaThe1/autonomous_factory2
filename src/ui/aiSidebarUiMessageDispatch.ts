import type { UiToExtMessage } from "./protocol";
import type { AiSidebarUiDispatchHost } from "./aiSidebarUiDispatchHost";

/** Webview → host messages routed here (`traceEvent` is ingested before dispatch). */
export type UiToExtDispatchMessage = Exclude<UiToExtMessage, { type: "traceEvent" }>;
import {
  dispatchUi_abortMissionLlm,
  dispatchUi_focusMission,
  dispatchUi_ready,
  dispatchUi_refreshDashboard,
  dispatchUi_resumeMission,
  dispatchUi_sendChat,
  dispatchUi_startMission
} from "./aiSidebarDispatchChatRefresh";
import {
  dispatchUi_archiveMission,
  dispatchUi_bulkArchiveCompletedMissions,
  dispatchUi_bulkArchiveVisibleCompletedMissions,
  dispatchUi_bulkDeleteBlockedTestMissions,
  dispatchUi_bulkDeleteFailedTestMissions,
  dispatchUi_bulkDeleteVisibleBlockedMissions,
  dispatchUi_bulkDeleteVisibleFailedOrCancelledMissions,
  dispatchUi_deleteMission,
  dispatchUi_editAgentRouting,
  dispatchUi_editMissionDag,
  dispatchUi_editMissionPolicy,
  dispatchUi_reviewBundleSummary,
  dispatchUi_generateMissionReport,
  dispatchUi_saveMissionRouting,
  dispatchUi_setMissionListIncludeArchived,
  dispatchUi_unarchiveMission,
  dispatchUi_approveMissionBlueprint,
  dispatchUi_rejectMissionBlueprint,
  dispatchUi_requestMissionBlueprintRevision,
  dispatchUi_submitPreBlueprintAnswers,
  dispatchUi_exportMissionBlueprint
} from "./aiSidebarDispatchMissions";
import {
  dispatchUi_approve,
  dispatchUi_approveBundle,
  dispatchUi_reject,
  dispatchUi_rejectBundle,
  dispatchUi_reviewPendingDiff,
  dispatchUi_reviewPendingHunks
} from "./aiSidebarDispatchApprovalsReview";
import {
  dispatchUi_applyLazyDiscoveryPreset,
  dispatchUi_openAgentCapabilitiesDoc,
  dispatchUi_openMissionAutonomyBlueprint,
  dispatchUi_revertLazyDiscoveryPreset
} from "./aiSidebarDispatchHelp";
import {
  dispatchUi_createStarterMcpConfig,
  dispatchUi_listMcpSessions,
  dispatchUi_listMcpTools,
  dispatchUi_openMcpConfig,
  dispatchUi_openSettings,
  dispatchUi_openTerminal
} from "./aiSidebarDispatchMcpShell";
import {
  dispatchUi_applyDefaultProviderAndModel,
  dispatchUi_clearProviderCredential,
  dispatchUi_refreshOllamaModels,
  dispatchUi_refreshProviderModels,
  dispatchUi_saveProviderBaseUrl,
  dispatchUi_saveProviderCredential,
  dispatchUi_saveProviderModelDefault,
  dispatchUi_saveQuickSettings,
  dispatchUi_testProviderConnection
} from "./aiSidebarDispatchProviderPanel";
import {
  dispatchUi_clearTraceLogFromUi,
  dispatchUi_exportTraceLogFromUi,
  dispatchUi_openTraceOutputChannel,
  dispatchUi_requestTraceLog,
  dispatchUi_searchGlobalMemory,
  dispatchUi_setTraceLevelFromUi
} from "./aiSidebarDispatchMemoryTrace";

/**
 * Routes validated `UiToExtMessage` (excluding `traceEvent`) to domain dispatch helpers.
 * @returns `suppressTrailingDashboardRefresh` — when true, skip `handler_tail` full refresh.
 */
export async function dispatchUiToExtMessage(
  host: AiSidebarUiDispatchHost,
  msg: UiToExtDispatchMessage,
  msgInteractionId: string | undefined
): Promise<boolean> {
  switch (msg.type) {
    case "ready":
      return await dispatchUi_ready(host);
    case "sendChat":
      return await dispatchUi_sendChat(host, msg);
    case "clearChatHistory":
      host.clearChatHistory();
      return false;
    case "startMission":
      return await dispatchUi_startMission(host, msg);
    case "resumeMission":
      return await dispatchUi_resumeMission(host, msg);
    case "abortMissionLlm":
      return await dispatchUi_abortMissionLlm(host, msg);
    case "focusMission":
      return await dispatchUi_focusMission(host, msg);
    case "setMissionListIncludeArchived":
      return await dispatchUi_setMissionListIncludeArchived(host, msg);
    case "archiveMission":
      return await dispatchUi_archiveMission(host, msg);
    case "unarchiveMission":
      return await dispatchUi_unarchiveMission(host, msg);
    case "deleteMission":
      return await dispatchUi_deleteMission(host, msg);
    case "bulkArchiveCompletedMissions":
      return await dispatchUi_bulkArchiveCompletedMissions(host, msg);
    case "bulkDeleteFailedTestMissions":
      return await dispatchUi_bulkDeleteFailedTestMissions(host, msg);
    case "bulkDeleteBlockedTestMissions":
      return await dispatchUi_bulkDeleteBlockedTestMissions(host, msg);
    case "bulkArchiveVisibleCompletedMissions":
      return await dispatchUi_bulkArchiveVisibleCompletedMissions(host, msg);
    case "bulkDeleteVisibleFailedOrCancelledMissions":
      return await dispatchUi_bulkDeleteVisibleFailedOrCancelledMissions(host, msg);
    case "bulkDeleteVisibleBlockedMissions":
      return await dispatchUi_bulkDeleteVisibleBlockedMissions(host, msg);
    case "refreshDashboard":
      return await dispatchUi_refreshDashboard(host, msg);
    case "editMissionPolicy":
      return await dispatchUi_editMissionPolicy(host, msg);
    case "editAgentRouting":
      return await dispatchUi_editAgentRouting(host, msg);
    case "editMissionDag":
      return await dispatchUi_editMissionDag(host, msg);
    case "reviewBundleSummary":
      return await dispatchUi_reviewBundleSummary(host, msg);
    case "approve":
      return await dispatchUi_approve(host, msg);
    case "reject":
      return await dispatchUi_reject(host, msg);
    case "approveBundle":
      return await dispatchUi_approveBundle(host, msg);
    case "rejectBundle":
      return await dispatchUi_rejectBundle(host, msg);
    case "reviewPendingDiff":
      return await dispatchUi_reviewPendingDiff(host, msg);
    case "reviewPendingHunks":
      return await dispatchUi_reviewPendingHunks(host, msg);
    case "openTerminal":
      return await dispatchUi_openTerminal(host);
    case "openSettings":
      return await dispatchUi_openSettings();
    case "listMcpTools":
      return await dispatchUi_listMcpTools(host);
    case "listMcpSessions":
      return await dispatchUi_listMcpSessions(host);
    case "openMcpConfig":
      return await dispatchUi_openMcpConfig(host);
    case "openAgentCapabilitiesDoc":
      return await dispatchUi_openAgentCapabilitiesDoc(host);
    case "openMissionAutonomyBlueprint":
      return await dispatchUi_openMissionAutonomyBlueprint(host);
    case "approveMissionBlueprint":
      return await dispatchUi_approveMissionBlueprint(host, msg);
    case "rejectMissionBlueprint":
      return await dispatchUi_rejectMissionBlueprint(host, msg);
    case "requestMissionBlueprintRevision":
      return await dispatchUi_requestMissionBlueprintRevision(host, msg);
    case "submitPreBlueprintAnswers":
      return await dispatchUi_submitPreBlueprintAnswers(host, msg);
    case "exportMissionBlueprint":
      return await dispatchUi_exportMissionBlueprint(host, msg);
    case "applyLazyDiscoveryPreset":
      return await dispatchUi_applyLazyDiscoveryPreset(host);
    case "revertLazyDiscoveryPreset":
      return await dispatchUi_revertLazyDiscoveryPreset(host);
    case "createStarterMcpConfig":
      return await dispatchUi_createStarterMcpConfig(host);
    case "saveMissionRouting":
      return await dispatchUi_saveMissionRouting(host, msg);
    case "searchGlobalMemory":
      return await dispatchUi_searchGlobalMemory(host, msg);
    case "generateMissionReport":
      return await dispatchUi_generateMissionReport(host, msg);
    case "saveQuickSettings":
      return await dispatchUi_saveQuickSettings(host, msg, msgInteractionId);
    case "saveProviderCredential":
      return await dispatchUi_saveProviderCredential(host, msg, msgInteractionId);
    case "clearProviderCredential":
      return await dispatchUi_clearProviderCredential(host, msg, msgInteractionId);
    case "saveProviderBaseUrl":
      return await dispatchUi_saveProviderBaseUrl(host, msg, msgInteractionId);
    case "saveProviderModelDefault":
      return await dispatchUi_saveProviderModelDefault(host, msg, msgInteractionId);
    case "applyDefaultProviderAndModel":
      return await dispatchUi_applyDefaultProviderAndModel(host, msg, msgInteractionId);
    case "testProviderConnection":
      return await dispatchUi_testProviderConnection(host, msg, msgInteractionId);
    case "refreshOllamaModels":
      return await dispatchUi_refreshOllamaModels(host);
    case "refreshProviderModels":
      return await dispatchUi_refreshProviderModels(host, msg);
    case "requestTraceLog":
      return await dispatchUi_requestTraceLog(host);
    case "clearTraceLogFromUi":
      return await dispatchUi_clearTraceLogFromUi(host);
    case "exportTraceLogFromUi":
      return await dispatchUi_exportTraceLogFromUi(host);
    case "setTraceLevelFromUi":
      return await dispatchUi_setTraceLevelFromUi(host, msg);
    case "openTraceOutputChannel":
      return await dispatchUi_openTraceOutputChannel(host);
    default: {
      const _exhaustive: never = msg;
      return _exhaustive;
    }
  }
}
