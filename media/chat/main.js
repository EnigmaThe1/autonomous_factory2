import { escapeHtml, mdToHtml, relTime, htmlSig, newInteractionId } from "./webviewFormat.js";
import { createPanelSigCache } from "./webviewSigCache.js";
import { createTraceAndPersist } from "./webviewTraceAndPersist.js";
import { mergeModelLists, fillProviderModelCatalogList } from "./webviewModelLists.js";
import { createMissionRenderer } from "./webviewRenderMissions.js";
import { createPanelRenderers } from "./webviewPanelBundle.js";
import { createTabController } from "./webviewTabController.js";
import { createSnapshotApply } from "./webviewSnapshotApply.js";
import { createMessageHandler } from "./webviewMessageHandler.js";
import { wireChatDomEvents } from "./webviewDomWire.js";
import { createChatHistory } from "./webviewChatBuffer.js";

const vscode = acquireVsCodeApi();

const state = {
  snapshot: null,
  traceSessionId: null,
  memorySearchResults: [],
  activeTab: "chat",
  selectedApproval: null,
  selectedBundle: null,
  selectedHunkIndex: 0,
  timelineFilterText: "",
  timelineFilterLevel: "all",
  timelineFocusedOnly: false,
  /** Webview-only mission list quick filter (All / Active / …). */
  missionQuickFilter: "all",
  /** Last rendered visible-list bulk targets (ids only); updated each missions list paint. */
  visibleBulkCandidates: {
    archiveCompletedIds: [],
    deleteFailedOrCancelledIds: [],
    deleteBlockedIds: [],
    counts: { archiveCompleted: 0, deleteFailedOrCancelled: 0, deleteBlocked: 0 }
  },
  chatBuffer: "",
  chatHistory: createChatHistory(),
  agentStream: null,
  dirty: { quickSettings: false, providersForm: false, chatRow: false, routingPanel: false },
  routingDraft: null,
  traceAutoRefreshTimer: null,
  lastSnapshotPublishSeq: null,
  lastIncludeArchivedApplied: null,
  lastMissionCountApplied: null,
  lastAppliedMissionsSectionSeq: 0,
  lastAppliedAuxiliarySectionSeq: 0,
  lastAppliedProviderChromeSectionSeq: 0,
  lastAppliedGlobalMemorySectionSeq: 0,
  /** Fingerprint for skipping redundant trace panel DOM updates (auto-refresh). */
  lastTraceLogRenderFp: null,
  /** Last markdown report from host (`missionReportReady`), keyed to `missionId` for inspector preview. */
  missionReportCache: null
};

const sigCache = createPanelSigCache();

const els = {
  tabs: document.getElementById("tabs"),
  chatPrompt: document.getElementById("chatPrompt"),
  sendChat: document.getElementById("sendChat"),
  chatOutput: document.getElementById("chatOutput"),
  missionTitle: document.getElementById("missionTitle"),
  missionPrompt: document.getElementById("missionPrompt"),
  startMission: document.getElementById("startMission"),
  refreshDashboard: document.getElementById("refreshDashboard"),
  approvalQueue: document.getElementById("approvalQueue"),
  approvalBundles: document.getElementById("approvalBundles"),
  approvalQueueCount: document.getElementById("approvalQueueCount"),
  approvalInspector: document.getElementById("approvalInspector"),
  inspectSelectedDiff: document.getElementById("inspectSelectedDiff"),
  inspectSelectedHunks: document.getElementById("inspectSelectedHunks"),
  timeline: document.getElementById("timeline"),
  timelineFilterText: document.getElementById("timelineFilterText"),
  timelineFilterLevel: document.getElementById("timelineFilterLevel"),
  timelineFilterFocusedOnly: document.getElementById("timelineFilterFocusedOnly"),
  clearTimelineFilters: document.getElementById("clearTimelineFilters"),
  agents: document.getElementById("agents"),
  agentLive: document.getElementById("agentLive"),
  toolSummary: document.getElementById("toolSummary"),
  globalMemory: document.getElementById("globalMemory"),
  missionMemory: document.getElementById("missionMemory"),
  memoryQuery: document.getElementById("memoryQuery"),
  memorySearchResults: document.getElementById("memorySearchResults"),
  consoleOutput: document.getElementById("consoleOutput"),
  settingsPanel: document.getElementById("settingsPanel"),
  summaryProvider: document.getElementById("summaryProvider"),
  summaryModel: document.getElementById("summaryModel"),
  summaryMissions: document.getElementById("summaryMissions"),
  summaryApprovals: document.getElementById("summaryApprovals"),
  resumeFocusedMission: document.getElementById("resumeFocusedMission"),
  abortFocusedMissionLlm: document.getElementById("abortFocusedMissionLlm"),
  inspectFocusedPolicy: document.getElementById("inspectFocusedPolicy"),
  inspectFocusedRouting: document.getElementById("inspectFocusedRouting"),
  inspectFocusedDag: document.getElementById("inspectFocusedDag"),
  openTerminal: document.getElementById("openTerminal"),
  listMcpTools: document.getElementById("listMcpTools"),
  openMcpConfig: document.getElementById("openMcpConfig"),
  listMcpSessions: document.getElementById("listMcpSessions"),
  reviewFocusedDiff: document.getElementById("reviewFocusedDiff"),
  reviewFocusedHunks: document.getElementById("reviewFocusedHunks"),
  reviewFocusedBundle: document.getElementById("reviewFocusedBundle"),
  openBundlesTab: document.getElementById("openBundlesTab"),
  openSettings: document.getElementById("openSettings"),
  focusChatInput: document.getElementById("focusChatInput"),
  approveFocusedBundle: document.getElementById("approveFocusedBundle"),
  rejectFocusedBundle: document.getElementById("rejectFocusedBundle"),
  chatProviderSelect: document.getElementById("chatProviderSelect"),
  chatModelInput: document.getElementById("chatModelInput"),
  openProvidersFromChat: document.getElementById("openProvidersFromChat"),
  panelProviderSelect: document.getElementById("panelProviderSelect"),
  panelModelInput: document.getElementById("panelModelInput"),
  btnPanelModelCatalog: document.getElementById("btnPanelModelCatalog"),
  panelModelCatalogPopover: document.getElementById("panelModelCatalogPopover"),
  panelModelCatalogUl: document.getElementById("panelModelCatalogUl"),
  panelModelCatalogEmpty: document.getElementById("panelModelCatalogEmpty"),
  panelBaseUrl: document.getElementById("panelBaseUrl"),
  panelApiKey: document.getElementById("panelApiKey"),
  providerCredentialSummary: document.getElementById("providerCredentialSummary"),
  panelConnectionResult: document.getElementById("panelConnectionResult")
};

const getState = () => state;

const { emitHostTrace, trace, persistWebviewUiState, stopTraceAutoRefresh, startTraceAutoRefresh, renderTraceLogSnapshot } =
  createTraceAndPersist(vscode, getState);

function post(type, extra = {}, interactionId) {
  const iid = interactionId !== undefined ? interactionId : extra.interactionId;
  emitHostTrace({
    level: "debug",
    event: "ui_post_message",
    messageType: type,
    interactionId: iid,
    data: { payloadKeys: Object.keys(extra || {}) }
  });
  vscode.postMessage({ type, ...extra });
}

function postWithInteractionId(type, payload = {}) {
  const interactionId = newInteractionId();
  post(type, { ...payload, interactionId }, interactionId);
}

const { renderMissions } = createMissionRenderer({
  state,
  sigCache,
  emitHostTrace,
  trace,
  escapeHtml,
  relTime,
  mdToHtml,
  htmlSig
});

const panels = createPanelRenderers({
  state,
  els,
  sigCache,
  escapeHtml,
  relTime,
  mdToHtml,
  post,
  mergeModelLists,
  fillProviderModelCatalogList
});

const tabCtl = createTabController({
  vscode,
  state,
  trace,
  persistWebviewUiState,
  stopTraceAutoRefresh,
  startTraceAutoRefresh,
  renderProvidersPanel: panels.renderProvidersPanel,
  renderSettings: panels.renderSettings,
  renderMemory: panels.renderMemory,
  renderTools: panels.renderTools,
  renderRouting: panels.renderRouting,
  renderMissions,
  renderChat: panels.renderChat
});

const snapshotApi = createSnapshotApply({
  state,
  els,
  sigCache,
  emitHostTrace,
  trace,
  escapeHtml,
  setActiveTab: tabCtl.setActiveTab,
  renderMissions,
  syncChatProviderRow: panels.syncChatProviderRow,
  renderRouting: panels.renderRouting,
  renderApprovals: panels.renderApprovals,
  renderBundles: panels.renderBundles,
  renderTimeline: panels.renderTimeline,
  renderAgents: panels.renderAgents,
  renderTools: panels.renderTools,
  renderMemory: panels.renderMemory,
  renderConsole: panels.renderConsole,
  renderChat: panels.renderChat,
  renderProvidersPanel: panels.renderProvidersPanel,
  renderSettings: panels.renderSettings
});

const onWindowMessage = createMessageHandler({
  state,
  els,
  emitHostTrace,
  renderTraceLogSnapshot,
  applyMissionSectionSnapshot: snapshotApi.applyMissionSectionSnapshot,
  applyAuxiliarySectionSnapshot: snapshotApi.applyAuxiliarySectionSnapshot,
  applyProviderChromeSectionSnapshot: snapshotApi.applyProviderChromeSectionSnapshot,
  applyGlobalMemorySectionSnapshot: snapshotApi.applyGlobalMemorySectionSnapshot,
  renderSnapshot: snapshotApi.renderSnapshot,
  renderChat: panels.renderChat,
  renderMemory: panels.renderMemory,
  renderMissions,
  updateQuickDirtyBadge: panels.updateQuickDirtyBadge,
  updateProvidersDirtyBadge: panels.updateProvidersDirtyBadge,
  setActiveTab: tabCtl.setActiveTab
});

window.addEventListener("message", onWindowMessage);

wireChatDomEvents({
  vscode,
  state,
  els,
  post,
  postWithInteractionId,
  setActiveTab: tabCtl.setActiveTab,
  emitHostTrace,
  renderChat: panels.renderChat,
  renderApprovals: panels.renderApprovals,
  renderBundles: panels.renderBundles,
  renderTimeline: panels.renderTimeline,
  renderMemory: panels.renderMemory,
  renderProvidersPanel: panels.renderProvidersPanel,
  renderSettings: panels.renderSettings,
  syncChatProviderRow: panels.syncChatProviderRow,
  renderRouting: panels.renderRouting,
  renderMissions,
  updateQuickDirtyBadge: panels.updateQuickDirtyBadge,
  updateProvidersDirtyBadge: panels.updateProvidersDirtyBadge,
  stopTraceAutoRefresh,
  startTraceAutoRefresh
});

trace("ui_boot_ready", {}, "info");
vscode.postMessage({ type: "ready" });
