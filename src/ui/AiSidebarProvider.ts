import * as vscode from "vscode";
import { ProviderRegistry } from "../providers/ProviderRegistry";
import { ContextCollector } from "../context/ContextCollector";
import { MissionStore } from "../missions/MissionStore";
import type { ProgramDirectory } from "../missions/ProgramDirectory";
import { MissionOrchestrator } from "../missions/MissionOrchestrator";
import { GlobalMemoryStore } from "../memory/GlobalMemoryStore";
import { ToolRegistry } from "../tools/ToolRegistry";
import { McpRegistry } from "../tools/McpRegistry";
import { SecretStore } from "../storage/SecretStore";
import { fetchProviderModelList } from "../providers/fetchProviderModelList";
import { rankFullAndShortlist } from "../providers/modelCatalogRank";
import { ProviderModelCatalogCache, isPersistedCatalogProvider } from "../storage/providerModelCatalogCache";
import { resolveModelForProvider, PROVIDER_MODEL_PRESETS, modelsConfigKeyForProvider } from "../providers/providerModelResolution";
import { providerNeedsApiKey, secretKeyForProvider } from "../providers/providerCredentialKeys";
import { formatProviderUserError } from "../providers/providerUiErrors";
import { EXTENSION_CHAT_WORKSPACE_RULES } from "../agents/extensionToolHardRules";
import { Mission, ApprovalRequest } from "../types";
import { buildApprovalBundlesFromMissions, buildAgentLiveFromMission, resolveFocusedMission, buildAgentStatusFromMission } from "./aiSidebarAgentPresentation";
import { computeMissionDerivedSlicesPure } from "./aiSidebarMissionDerived";
import { WorkspacePaths } from "../storage/WorkspacePaths";
import { analyzeMcpOnboarding, type McpOnboardingState } from "../tools/mcpStarterConfig";
import type {
  UiToExtMessage,
  ExtToUiMessage,
  SidebarAgentStatus,
  SidebarSnapshot,
  SidebarAgentLiveItem,
  SidebarApprovalBundleSummary,
  SidebarToolSummary,
  ProviderLiveModelEntry,
  ProviderCredentialStatus
} from "./protocol";
import { ExtensionTraceLogger } from "../diagnostics/ExtensionTraceLogger";
import type { DashboardRefreshSource } from "../diagnostics/dashboardRefreshSource";
import { UI_TO_EXT_KNOWN_TYPES } from "../diagnostics/uiToExtKnownTypes";
import { saveOperatorActionMissionEventIfChanged } from "../missions/missionActionOutcomeEventLogging";
import {
  OPERATOR_ACTION_BUNDLE_APPROVED_MESSAGE,
  OPERATOR_ACTION_BUNDLE_REJECTED_MESSAGE
} from "../missions/missionActionOutcomeEventPresentation";

import {
  clampDashboardPollIntervalMs,
  DASHBOARD_POLL_INTERVAL_MS_DEFAULT
} from "../config/myAiSettingBounds";
import {
  MCP_ONBOARDING_CACHE_TTL_MS,
  MCP_TOOLS_SESSIONS_TTL_MS,
  MISSION_HOST_TRUTH_COALESCE_MS,
  MISSION_LIST_INCLUDE_ARCHIVED_KEY,
  PROVIDER_CREDENTIAL_ENTRY_TTL_MS,
  SECTION_EVENT_COALESCE_MS
} from "./aiSidebarConstants";
import { presentBundleOperatorUiFeedback } from "./missionActionOutcomePresentation";
import { roughWebviewSnapshotPayloadBytes } from "./webviewPayloadRoughBytes";
import { SNAPSHOT_PAYLOAD_WARN_ROUGH_BYTES } from "./webviewStabilityConstants";
import * as fp from "./aiSidebarFingerprints";
import type { McpAuxiliaryWarmMaterializedSlice, McpAuxiliaryWarmRead } from "./aiSidebarMcpAuxiliaryTypes";
import { buildSidebarDashboardSnapshot, type AiSidebarBuildSnapshotHost, type SidebarChromeSlice } from "./aiSidebarBuildSnapshot";
import {
  enqueueSidebarRefreshDashboard,
  type SidebarRefreshOrchestrationHost
} from "./aiSidebarRefreshOrchestration";
import { runSidebarPollWarmExecution, type SidebarPollWarmExecutionHost } from "./aiSidebarPollWarmExecution";
import { missionAllAndVisibleForFingerprint } from "./aiSidebarSnapshotMisc";
import {
  configurationAffectsSidebarSnapshotSettings,
  readProviderBaseUrls,
  readProviderSavedModels,
  readSidebarWorkspaceSettings
} from "./aiSidebarSettingsRead";
import { buildAiSidebarWebviewHtml } from "./aiSidebarWebviewHtml";
import type { AiSidebarUiDispatchHost } from "./aiSidebarUiDispatchHost";
import { dispatchUiToExtMessage, type UiToExtDispatchMessage } from "./aiSidebarUiMessageDispatch";
import type { AiSidebarSectionPublishHost } from "./aiSidebarSectionPublishHost";
import { postAuxiliarySectionImmediateForHost, flushAuxiliarySectionFromEventIfNeededForHost } from "./aiSidebarSectionPublishAuxiliary";
import { postGlobalMemorySectionImmediateForHost, flushGlobalMemorySectionFromEventIfNeededForHost } from "./aiSidebarSectionPublishGlobalMemory";
import { postProviderSettingsChromeSectionImmediateForHost } from "./aiSidebarSectionPublishProviderChrome";
import {
  flushMissionSectionFromHostTruthEdgeIfNeededForHost,
  shouldSkipMissionSectionEventPublishForHost
} from "./aiSidebarSectionMissionEventFlush";
import { postMissionDashboardSnapshotImmediateForHost } from "./aiSidebarSectionMissionMerge";

export class AiSidebarProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private focusedMissionId?: string;
  private includeArchivedMissions = false;
  /** Coalesces concurrent `buildSnapshot` calls so a slow poll tick cannot overwrite a fresh post-mutation snapshot. */
  private dashboardRefreshSeq = 0;
  /** Serializes refresh work so two `buildSnapshot` runs never interleave (avoids subtle ordering bugs). */
  private refreshQueue: Promise<void> = Promise.resolve();
  /**
   * When true, a background refresh (`refreshDashboard()` without `interactionId`) is already chained on
   * `refreshQueue`; additional background requests coalesce (one build serves all). User / trace-correlated
   * refreshes always pass `interactionId` and bypass this flag.
   */
  private backgroundRefreshTailCoalesced = false;
  /**
   * Monotonic generation for background refresh *requests*. Each non-coalesced background enqueue bumps this;
   * a queued cycle carries a captured value and skips before `buildSnapshot` if a newer background request
   * arrived (avoids running stale full builds when polls stack behind a slow prior job).
   */
  private backgroundRefreshRequestGen = 0;
  /** Monotonic publish generation for mission-cluster `snapshotSection` posts. */
  private missionsSectionSeq = 0;
  /** Monotonic publish generation for MCP/onboarding `snapshotSection` posts. */
  private auxiliarySectionSeq = 0;
  /** Monotonic publish generation for provider/settings/credential chrome `snapshotSection` posts. */
  private providerChromeSectionSeq = 0;
  /** Monotonic publish generation for global memory head `snapshotSection` posts. */
  private globalMemorySectionSeq = 0;
  /** Coalesce rapid global-memory `add` calls before one sectional publish. */
  private globalMemoryEventCoalesceTimer?: ReturnType<typeof setTimeout>;
  /** Coalesce MCP cache invalidation bursts before one auxiliary sectional publish. */
  private auxiliaryEventCoalesceTimer?: ReturnType<typeof setTimeout>;
  /** Coalesce mission host-truth edges (runner stall recovery, palette approvals) before one missions section. */
  private missionHostTruthCoalesceTimer?: ReturnType<typeof setTimeout>;
  /**
   * Captured at each full/init snapshot post (and refreshed on mission / providerChrome / globalMemory `snapshotSection`) so poll can skip
   * full `buildSnapshot` when missions, global memory head, and provider chrome are unchanged — auxiliary-only, or memory-only sectional refresh.
   */
  private stabilityBaseline?: { missionFp: string; globalMemFp: string; providerChromeFp: string };
  /** Memo for mission-derived snapshot slices when visible mission rows are unchanged (poll steady-state). */
  private missionDerivedCache?: {
    fp: string;
    pendingApprovals: SidebarSnapshot["pendingApprovals"];
    approvalBundles: SidebarApprovalBundleSummary[];
    timeline: SidebarSnapshot["timeline"];
    recentToolEvents: NonNullable<SidebarSnapshot["tools"]["recentToolEvents"]>;
  };
  /**
   * Reuse `missionVisibleListFingerprint` across poll ticks when `MissionStore.getMissionMutationGeneration()` and
   * `includeArchivedMissions` are unchanged — skips `list()` / per-mission row string work. Any mission persist
   * bumps generation; archive filter toggle changes the cache key.
   */
  private missionPollFingerprintCache?: {
    storeGeneration: number;
    includeArchived: boolean;
    fingerprint: string;
  };
  /**
   * Reuse global-memory *head* fingerprint (`id:ts` for first 10) across poll ticks when
   * `GlobalMemoryStore.getMutationGeneration()` is unchanged — skips `list().slice(0,10)` scan.
   */
  private globalMemoryPollHeadFpCache?: { generation: number; headFp: string };
  /**
   * Poll noop fast path: when tools + onboarding RAM caches are TTL-warm and their `at` timestamps match the last
   * poll fingerprint compute, auxiliary fp is unchanged without re-filtering tools / re-stringifying — invalidated when
   * `readMcpAuxiliaryWarmCaches` fails or cache `at` changes (refresh or explicit invalidation).
   */
  private auxiliaryPollStableFpCache?: {
    toolsCacheAt: number;
    onboardingCacheAt: number;
    resolvedConfigPath: string;
    fp: string;
  };
  /** Increments on every init/snapshot post to the webview for stale-drop correlation. */
  private snapshotPublishSeq = 0;
  /** When a refresh is discarded (newer seq) or `buildSnapshot` throws, schedule one follow-up refresh so the UI is not left without any post (e.g. newer build failed after bumping seq). */
  private dashboardFlushTimer?: ReturnType<typeof setTimeout>;
  /** Last init/snapshot payload posted to the webview; used to apply “Show archived” immediately without waiting on a slow in-flight `buildSnapshot`. */
  private lastPostedSnapshot?: SidebarSnapshot;
  /** Material fingerprint of the last successfully posted **full** `snapshot` (not sectional); churn diagnostics. */
  private lastPublishedFullMaterialFp?: string;
  /** Last completed full-refresh cycle material fp + source (for redundant-cycle logging). */
  private lastFullRefreshCycleMeta?: { materialFp: string; source: DashboardRefreshSource };
  private chatStreamAbort?: AbortController;
  private chatHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
  private static readonly CHAT_HISTORY_MAX_TURNS = 20;
  private providerLiveModelCache: Record<string, ProviderLiveModelEntry> = {};
  private readonly modelCatalogCache: ProviderModelCatalogCache;
  private lastProviderTest?: { providerId: string; ok: boolean; message: string; at: number };
  private providerHealth: Record<string, import("./protocol").ProviderHealthEntry> = {};
  /** Avoid re-reading MCP config from disk on every poll tick (buildSnapshot runs frequently while the webview is open). */
  private mcpOnboardingCache?: { resolvedPath: string; at: number; state: McpOnboardingState };
  /** Short TTL for MCP tool/session list in `buildSnapshot` (poll-heavy); invalidated on explicit MCP UI actions. */
  private mcpToolsSessionsCache?: { tools: Awaited<ReturnType<McpRegistry["listTools"]>>; sessions: Awaited<ReturnType<McpRegistry["listSessionStates"]>>; at: number };
  /** Per-provider secret presence cache for full `buildSnapshot` (invalidated on credential save/clear). */
  private providerCredentialEntryCache = new Map<string, { entry: ProviderCredentialStatus; at: number }>();
  private credResolutionProfile = { hits: 0, misses: 0 };
  /**
   * Bumps when any synchronous input to `providerChromeFingerprintPayload` may change (workspace `myAi.*` config,
   * credential cache rows, live model catalog, connection test stamp). Poll combines this with a credential TTL
   * window to reuse the last computed live fingerprint without re-materializing chrome slice inputs each tick.
   */
  private providerChromeSyncGeneration = 0;
  /**
   * Poll-only: reuse last live provider-chrome fingerprint while `providerChromeSyncGeneration` matches and
   * `now < warmCredWindowEnd` (all api-key providers still inside the TTL window that bounded the last compute).
   */
  private providerPollChromeFpCache?: {
    syncGeneration: number;
    fingerprint: string;
    usedWarmCredentialPath: boolean;
    warmCredWindowEnd: number;
  };

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly paths: WorkspacePaths,
    private readonly providers: ProviderRegistry,
    private readonly collector: ContextCollector,
    private readonly missionStore: MissionStore,
    private readonly orchestrator: MissionOrchestrator,
    private readonly globalMemory: GlobalMemoryStore,
    private readonly tools: ToolRegistry,
    private readonly mcp: McpRegistry,
    private readonly secrets: SecretStore,
    private readonly traceLogger: ExtensionTraceLogger,
    private readonly workspaceState: vscode.Memento,
    private readonly programDirectory: ProgramDirectory,
    extensionContext: vscode.ExtensionContext
  ) {
    this.modelCatalogCache = new ProviderModelCatalogCache(extensionContext.globalStorageUri);
  }

  /** Load last persisted provider catalogs into RAM (restart-safe). */
  async hydrateModelCatalogFromDisk(): Promise<void> {
    const file = await this.modelCatalogCache.readAll();
    if (!file?.providers) return;
    const persisted: Array<"openai" | "gemini" | "anthropic" | "ollama"> = ["openai", "gemini", "anthropic", "ollama"];
    let any = false;
    for (const pid of persisted) {
      if (this.providerLiveModelCache[pid]?.source === "live") continue;
      const ent = file.providers[pid];
      if (!ent?.modelsAll?.length) continue;
      const display =
        ent.modelsDisplay?.length && ent.modelsDisplay.length <= ent.modelsAll.length
          ? ent.modelsDisplay
          : rankFullAndShortlist(pid, ent.modelsAll).displayShortlist;
      this.providerLiveModelCache[pid] = {
        models: ent.modelsAll,
        modelsDisplay: display,
        source: "cache",
        hint: ent.hint,
        at: ent.fetchedAt
      };
      any = true;
    }
    if (any) this.bumpProviderChromeSyncGeneration("model_catalog_disk_hydrate");
  }

  private sidebarRefreshOrchestrationHost(): SidebarRefreshOrchestrationHost {
    return {
      traceLogger: this.traceLogger,
      getBackgroundRefreshTailCoalesced: () => this.backgroundRefreshTailCoalesced,
      setBackgroundRefreshTailCoalesced: (v) => {
        this.backgroundRefreshTailCoalesced = v;
      },
      getBackgroundRefreshRequestGen: () => this.backgroundRefreshRequestGen,
      nextBackgroundRefreshRequestGen: () => {
        this.backgroundRefreshRequestGen += 1;
        return this.backgroundRefreshRequestGen;
      },
      getRefreshQueue: () => this.refreshQueue,
      setRefreshQueue: (p) => {
        this.refreshQueue = p;
      },
      getIncludeArchivedMissions: () => this.includeArchivedMissions,
      nextDashboardRefreshSeq: () => ++this.dashboardRefreshSeq,
      getDashboardRefreshSeq: () => this.dashboardRefreshSeq,
      buildSnapshot: () => this.buildSnapshot(),
      materialFingerprintFromSnapshot: (s) => this.materialFingerprintFromSnapshot(s),
      getLastPublishedFullMaterialFp: () => this.lastPublishedFullMaterialFp,
      setLastPublishedFullMaterialFp: (v) => {
        this.lastPublishedFullMaterialFp = v;
      },
      getLastFullRefreshCycleMeta: () => this.lastFullRefreshCycleMeta,
      setLastFullRefreshCycleMeta: (v) => {
        this.lastFullRefreshCycleMeta = v;
      },
      scheduleDashboardFlush: () => this.scheduleDashboardFlush(),
      sealSnapshotForPost: (s, seq) => this.sealSnapshotForPost(s, seq),
      postSnapshotForFullRefresh: (sealed, interactionId) =>
        this.postMessage({ type: "snapshot", snapshot: sealed }, { interactionId })
    };
  }

  private sidebarBuildSnapshotHost(): AiSidebarBuildSnapshotHost {
    return {
      traceLogger: this.traceLogger,
      resetCredResolutionProfile: () => {
        this.credResolutionProfile = { hits: 0, misses: 0 };
      },
      getCredResolutionHits: () => this.credResolutionProfile.hits,
      getCredResolutionMisses: () => this.credResolutionProfile.misses,
      resolveProviderSettingsChromeHostSlice: (resolveFor) => this.resolveProviderSettingsChromeHostSlice(resolveFor),
      resolveMcpAuxiliarySlice: (resolveFor, opts) => this.resolveMcpAuxiliarySlice(resolveFor, opts),
      globalMemory: this.globalMemory,
      missionStore: this.missionStore,
      programDirectory: this.programDirectory,
      getIncludeArchivedMissions: () => this.includeArchivedMissions,
      resolveFocusedMission: (missions) => this.resolveFocusedMission(missions),
      buildAgentStatus: (m, dp, dm) => this.buildAgentStatus(m, dp, dm),
      computeMissionDerivedSlices: (missions, allMissions) => this.computeMissionDerivedSlices(missions, allMissions),
      buildAgentLive: (m) => this.buildAgentLive(m)
    };
  }

  private sidebarSectionPublishHost(): AiSidebarSectionPublishHost {
    const p = this;
    return {
      traceLogger: p.traceLogger,
      getWebviewView: () => p.view,
      getLastPostedSnapshot: () => p.lastPostedSnapshot,
      missionStore: p.missionStore,
      programDirectory: p.programDirectory,
      getIncludeArchivedMissions: () => p.includeArchivedMissions,
      resolveFocusedMission: (missions) => p.resolveFocusedMission(missions),
      buildAgentStatus: (m, dp, dm) => p.buildAgentStatus(m, dp, dm),
      buildAgentLive: (m) => p.buildAgentLive(m),
      computeMissionDerivedSlices: (missions, allMissions) => p.computeMissionDerivedSlices(missions, allMissions),
      getWorkspaceConfiguration: () => vscode.workspace.getConfiguration(),
      getTraceSessionId: () => p.traceLogger.sessionId,
      bumpMissionsSectionSeq: () => {
        p.missionsSectionSeq += 1;
        return p.missionsSectionSeq;
      },
      bumpAuxiliarySectionSeq: () => {
        p.auxiliarySectionSeq += 1;
        return p.auxiliarySectionSeq;
      },
      bumpGlobalMemorySectionSeq: () => {
        p.globalMemorySectionSeq += 1;
        return p.globalMemorySectionSeq;
      },
      bumpProviderChromeSectionSeq: () => {
        p.providerChromeSectionSeq += 1;
        return p.providerChromeSectionSeq;
      },
      globalMemory: p.globalMemory,
      globalMemoryHeadFingerprintFromStoreHead: () => p.globalMemoryHeadFingerprintFromStoreHead(),
      readMcpAuxiliaryWarmCaches: (now) => p.readMcpAuxiliaryWarmCaches(now),
      tryAuxiliaryFingerprintFromStableWarmPollCache: (probe) => p.tryAuxiliaryFingerprintFromStableWarmPollCache(probe),
      resolveMcpAuxiliarySlice: (resolveFor, opts) => p.resolveMcpAuxiliarySlice(resolveFor, opts),
      resolveProviderSettingsChromeHostSlice: (resolveFor) => p.resolveProviderSettingsChromeHostSlice(resolveFor),
      postMessage: (m, o) => p.postMessage(m, o)
    };
  }

  private sidebarPollWarmHost(): SidebarPollWarmExecutionHost {
    return {
      traceLogger: this.traceLogger,
      computeMissionFingerprintForPollRoute: () => this.computeMissionFingerprintForPollRoute(),
      computeGlobalMemoryHeadFingerprintForPollRoute: () => this.computeGlobalMemoryHeadFingerprintForPollRoute(),
      computeProviderChromeFingerprintLive: () => this.computeProviderChromeFingerprintLive(),
      postAuxiliarySectionImmediate: () => this.postAuxiliarySectionImmediate(),
      postGlobalMemorySectionImmediate: () => this.postGlobalMemorySectionImmediate(),
      postMissionDashboardSnapshotImmediate: (id) => this.postMissionDashboardSnapshotImmediate(id),
      postProviderSettingsChromeSectionImmediate: (a, b, c) => this.postProviderSettingsChromeSectionImmediate(a, b, c),
      refreshDashboard: (id, o) => this.refreshDashboard(id, o)
    };
  }

  private uiDispatchHost(): AiSidebarUiDispatchHost {
    const p = this;
    return {
      extensionUri: p.extensionUri,
      paths: p.paths,
      providers: p.providers,
      missionStore: p.missionStore,
      orchestrator: p.orchestrator,
      globalMemory: p.globalMemory,
      tools: p.tools,
      mcp: p.mcp,
      secrets: p.secrets,
      traceLogger: p.traceLogger,
      workspaceState: p.workspaceState,
      getRefreshQueue: () => p.refreshQueue,
      setRefreshQueue: (q) => {
        p.refreshQueue = q;
      },
      buildSnapshot: () => p.buildSnapshot(),
      sealSnapshotForPost: (s, seq) => p.sealSnapshotForPost(s, seq),
      materialFingerprintFromSnapshot: (s) => p.materialFingerprintFromSnapshot(s),
      getLastPublishedFullMaterialFp: () => p.lastPublishedFullMaterialFp,
      setLastPublishedFullMaterialFp: (v) => {
        p.lastPublishedFullMaterialFp = v;
      },
      getLastFullRefreshCycleMeta: () => p.lastFullRefreshCycleMeta,
      setLastFullRefreshCycleMeta: (v) => {
        p.lastFullRefreshCycleMeta = v;
      },
      postMessage: (m, o) => p.postMessage(m, o),
      handleChat: (pr, pid, m) => p.handleChat(pr, pid, m),
      clearChatHistory: () => p.clearChatHistory(),
      scheduleBackgroundDashboardReconciliation: () => p.scheduleBackgroundDashboardReconciliation(),
      focusMission: (id, ix) => p.focusMission(id, ix),
      postMissionDashboardSnapshotImmediate: (ix) => p.postMissionDashboardSnapshotImmediate(ix),
      getIncludeArchivedMissions: () => p.includeArchivedMissions,
      setIncludeArchivedMissions: (v) => {
        p.includeArchivedMissions = v;
      },
      getFocusedMissionId: () => p.focusedMissionId,
      setFocusedMissionId: (v) => {
        p.focusedMissionId = v;
      },
      getLastPostedSnapshot: () => p.lastPostedSnapshot,
      saveQuickSettings: (m) => p.saveQuickSettings(m),
      postProviderSettingsChromeSectionImmediate: (a, b, c) => p.postProviderSettingsChromeSectionImmediate(a, b, c),
      invalidateMcpToolsSessionsCache: () => p.invalidateMcpToolsSessionsCache(),
      scheduleAuxiliarySectionAfterMcpMutation: () => p.scheduleAuxiliarySectionAfterMcpMutation(),
      setMcpOnboardingCache: (v) => {
        p.mcpOnboardingCache = v;
      },
      invalidateProviderCredentialCache: (id) => p.invalidateProviderCredentialCache(id),
      setLastProviderTest: (v) => {
        p.lastProviderTest = v;
        if (v) {
          p.providerHealth[v.providerId] = {
            providerId: v.providerId,
            ok: v.ok,
            message: v.message,
            latencyMs: v.latencyMs,
            checkedAt: v.at
          };
        }
      },
      bumpProviderChromeSyncGeneration: (r) => p.bumpProviderChromeSyncGeneration(r),
      refreshProviderModelCatalog: (id) => p.refreshProviderModelCatalog(id),
      resolveBundle: (a, b, c) => p.resolveBundle(a, b, c),
      reviewPendingDiff: (m, a) => p.reviewPendingDiff(m, a),
      reviewPendingHunks: (m, a) => p.reviewPendingHunks(m, a),
      refreshDashboard: (ix, o) => p.refreshDashboard(ix, o)
    };
  }

  /**
   * When the webview already exists, route through `maybePollDashboardRefresh("reveal")` (same as poll/visibility)
   * so steady-state opens often refresh MCP aux or global memory via sectional posts only — not an extra full
   * `buildSnapshot`. Do not revert to unconditional `refreshDashboard()` here without re-measuring churn.
   */
  reveal() {
    this.view?.show?.(true);
    if (this.view?.webview) {
      void this.maybePollDashboardRefresh("reveal");
    } else {
      void this.refreshDashboard(undefined, { source: "reveal_before_webview" });
    }
  }

  /**
   * Coalesced background `buildSnapshot` for eventual global reconciliation after mission-visible UI was
   * already satisfied by `postMissionDashboardSnapshotImmediate` (or equivalent). Omits `interactionId` so
   * refreshes tail-coalesce and do not compete as interaction-priority work.
   */
  private scheduleBackgroundDashboardReconciliation(): void {
    void this.refreshDashboard(undefined, { source: "background_reconcile" });
  }

  /**
   * Focus a mission for dashboard UI. Posts the missions `snapshotSection` immediately from store truth; then
   * schedules a single coalesced background full refresh (not interaction-priority) so provider/MCP/aux
   * slices eventually reconcile without doubling queue pressure. Call sites that use `postWithInteractionId`
   * must set `suppressTrailingDashboardRefresh` when handling the message so the generic trailing
   * `refreshDashboard(interactionId)` does not duplicate work.
   */
  focusMission(id: string, interactionId?: string) {
    this.focusedMissionId = id;
    this.postMissionDashboardSnapshotImmediate(interactionId);
    this.scheduleBackgroundDashboardReconciliation();
  }

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view;
    this.includeArchivedMissions = !!this.workspaceState.get<boolean>(MISSION_LIST_INCLUDE_ARCHIVED_KEY, false);
    const webview = view.webview;
    webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media", "chat")] };
    webview.html = buildAiSidebarWebviewHtml(this.extensionUri, webview);

    webview.onDidReceiveMessage(async (raw: unknown) => {
      if (!raw || typeof raw !== "object" || typeof (raw as { type?: unknown }).type !== "string") {
        this.traceLogger.log({
          level: "error",
          side: "host",
          category: "protocol",
          event: "ui_message_rejected",
          ok: false,
          data: { reason: "invalid_envelope" }
        });
        return;
      }
      const envelope = raw as { type: string; payload?: unknown };
      if (envelope.type === "traceEvent") {
        const ingest = this.traceLogger.ingestWebviewPayload(envelope.payload);
        if (!ingest.ok) {
          this.traceLogger.log({
            level: "error",
            side: "host",
            category: "protocol",
            event: "ui_message_rejected",
            messageType: "traceEvent",
            ok: false,
            data: { reason: ingest.reason }
          });
        }
        return;
      }
      if (!UI_TO_EXT_KNOWN_TYPES.has(envelope.type)) {
        this.traceLogger.log({
          level: "info",
          side: "host",
          category: "protocol",
          event: "ui_message_unknown",
          messageType: envelope.type
        });
        return;
      }
      const msg = raw as UiToExtMessage;
      const msgInteractionId =
        "interactionId" in msg && typeof (msg as { interactionId?: unknown }).interactionId === "string"
          ? (msg as { interactionId: string }).interactionId
          : undefined;
      this.traceLogger.log({
        level: "info",
        side: "host",
        category: "protocol",
        event: "ui_message_received",
        messageType: msg.type,
        data: msgInteractionId ? { interactionId: msgInteractionId } : undefined
      });
      /**
       * When false, the handler falls through to `refreshDashboard(..., { source: "handler_tail" })` — an
       * interaction-priority full `buildSnapshot`. Prefer `suppressTrailingDashboardRefresh = true` when the
       * handler already posted a sectional snapshot, called `focusMission` (which schedules background
       * reconcile), or made no dashboard-relevant host mutations; use `scheduleBackgroundDashboardReconciliation`
       * when missions/MCP need eventual full reconcile without queueing a second interaction-priority build.
       */
      let suppressTrailingDashboardRefresh = false;
      try {
        suppressTrailingDashboardRefresh = await dispatchUiToExtMessage(
          this.uiDispatchHost(),
          msg as UiToExtDispatchMessage,
          msgInteractionId
        );

        if (!suppressTrailingDashboardRefresh) {
          await this.refreshDashboard(msgInteractionId, { source: "handler_tail" });
        }
      } catch (err) {
        const msgText = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`Autonomous Factory: ${msgText}`);
        this.postMessage({ type: "error", message: msgText });
      }
    });

    const clampPoll = () => {
      const raw = vscode.workspace.getConfiguration().get<number>("myAi.ui.dashboardPollIntervalMs", DASHBOARD_POLL_INTERVAL_MS_DEFAULT);
      return clampDashboardPollIntervalMs(Number.isFinite(raw) ? raw : DASHBOARD_POLL_INTERVAL_MS_DEFAULT);
    };
    const pollTick = () => {
      if (!view.visible) return;
      void this.maybePollDashboardRefresh("interval");
    };
    let pollTimer = setInterval(pollTick, clampPoll());
    const cfgSub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("myAi.ui.dashboardPollIntervalMs")) {
        clearInterval(pollTimer);
        pollTimer = setInterval(pollTick, clampPoll());
      }
      if (e.affectsConfiguration("myAi")) {
        this.bumpProviderChromeSyncGeneration("workspace_configuration_myAi");
      }
      if (configurationAffectsSidebarSnapshotSettings(e) && view.visible) {
        void this.refreshDashboard(undefined, { source: "workspace_settings_sidebar_summary" });
      }
    });
    const visibilitySub = view.onDidChangeVisibility(() => {
      if (view.visible) void this.maybePollDashboardRefresh("visibility");
    });
    view.onDidDispose(() => {
      clearInterval(pollTimer);
      cfgSub.dispose();
      visibilitySub.dispose();
      if (this.dashboardFlushTimer !== undefined) {
        clearTimeout(this.dashboardFlushTimer);
        this.dashboardFlushTimer = undefined;
      }
      if (this.globalMemoryEventCoalesceTimer !== undefined) {
        clearTimeout(this.globalMemoryEventCoalesceTimer);
        this.globalMemoryEventCoalesceTimer = undefined;
      }
      if (this.auxiliaryEventCoalesceTimer !== undefined) {
        clearTimeout(this.auxiliaryEventCoalesceTimer);
        this.auxiliaryEventCoalesceTimer = undefined;
      }
      if (this.missionHostTruthCoalesceTimer !== undefined) {
        clearTimeout(this.missionHostTruthCoalesceTimer);
        this.missionHostTruthCoalesceTimer = undefined;
      }
    });
  }

  /**
   * Event-driven missions section: background runner stall recovery / auto-block, or command-palette
   * approvals that do not call `focusMission`. Coalesced; skips if visible mission fingerprint matches last post.
   */
  /** Forward a message to the webview (used for agent streaming from the orchestrator). */
  forwardToWebview(message: ExtToUiMessage): void {
    this.postMessage(message);
  }

  scheduleMissionSectionAfterHostTruthEdge(): void {
    if (this.missionHostTruthCoalesceTimer !== undefined) {
      clearTimeout(this.missionHostTruthCoalesceTimer);
    }
    this.missionHostTruthCoalesceTimer = setTimeout(() => {
      this.missionHostTruthCoalesceTimer = undefined;
      this.flushMissionSectionFromHostTruthEdgeIfNeeded();
    }, MISSION_HOST_TRUTH_COALESCE_MS);
  }

  private flushMissionSectionFromHostTruthEdgeIfNeeded(): void {
    flushMissionSectionFromHostTruthEdgeIfNeededForHost(this.sidebarSectionPublishHost());
  }

  /** True when live visible-mission fingerprint matches the last posted missions list (same archive/total meta). */
  private shouldSkipMissionSectionEventPublish(): boolean {
    return shouldSkipMissionSectionEventPublishForHost(this.sidebarSectionPublishHost());
  }

  /**
   * After `GlobalMemoryStore.add` persists (wired from `extension.ts`). Coalesced; skips publish if head fp unchanged.
   */
  scheduleGlobalMemorySectionAfterStoreMutation(): void {
    if (this.globalMemoryEventCoalesceTimer !== undefined) {
      clearTimeout(this.globalMemoryEventCoalesceTimer);
    }
    this.globalMemoryEventCoalesceTimer = setTimeout(() => {
      this.globalMemoryEventCoalesceTimer = undefined;
      this.flushGlobalMemorySectionFromEventIfNeeded();
    }, SECTION_EVENT_COALESCE_MS);
  }

  private flushGlobalMemorySectionFromEventIfNeeded(): void {
    flushGlobalMemorySectionFromEventIfNeededForHost(this.sidebarSectionPublishHost());
  }

  /**
   * After explicit MCP UI actions that invalidate tools/session/onboarding caches.
   */
  scheduleAuxiliarySectionAfterMcpMutation(): void {
    if (this.auxiliaryEventCoalesceTimer !== undefined) {
      clearTimeout(this.auxiliaryEventCoalesceTimer);
    }
    this.auxiliaryEventCoalesceTimer = setTimeout(() => {
      this.auxiliaryEventCoalesceTimer = undefined;
      void this.flushAuxiliarySectionFromEventIfNeeded();
    }, SECTION_EVENT_COALESCE_MS);
  }

  private async flushAuxiliarySectionFromEventIfNeeded(): Promise<void> {
    await flushAuxiliarySectionFromEventIfNeededForHost(this.sidebarSectionPublishHost());
  }

  async sendPromptFromCommand(prompt: string) {
    await this.handleChat(prompt);
    this.reveal();
  }

  private async handleChat(prompt: string, providerId?: string, model?: string) {
    this.chatStreamAbort?.abort();
    const ac = new AbortController();
    this.chatStreamAbort = ac;
    const cfg = vscode.workspace.getConfiguration();
    const pid = providerId || cfg.get<string>("myAi.defaultProvider", "ollama");
    const provider = this.providers.get(pid);
    const context = await this.collector.collect();
    const explicitModel = model?.trim() || undefined;
    const maxTurns = cfg.get<number>("myAi.chat.historyTurns", AiSidebarProvider.CHAT_HISTORY_MAX_TURNS);

    this.chatHistory.push({ role: "user", content: prompt });

    const historySlice = this.chatHistory.slice(-(maxTurns * 2));
    let assistantBuffer = "";
    try {
      for await (const chunk of provider.stream({
        prompt,
        model: explicitModel,
        context,
        system: ["You are a helpful coding assistant in VS Code.", EXTENSION_CHAT_WORKSPACE_RULES].join("\n\n"),
        history: historySlice.slice(0, -1),
        signal: ac.signal
      })) {
        assistantBuffer += chunk;
        this.postMessage({ type: "chatChunk", text: chunk });
      }
      this.chatHistory.push({ role: "assistant", content: assistantBuffer });
      while (this.chatHistory.length > maxTurns * 2) this.chatHistory.shift();
      this.postMessage({ type: "chatDone" });
    } catch (err) {
      if (assistantBuffer) {
        this.chatHistory.push({ role: "assistant", content: assistantBuffer });
      }
      if (ac.signal.aborted) {
        this.postMessage({ type: "info", message: "Chat stream cancelled." });
        return;
      }
      this.postMessage({ type: "error", message: formatProviderUserError(err, pid) });
      this.postMessage({ type: "chatDone" });
    } finally {
      if (this.chatStreamAbort === ac) this.chatStreamAbort = undefined;
    }
  }

  clearChatHistory(): void {
    this.chatHistory = [];
  }

  private async saveQuickSettings(msg: Extract<UiToExtMessage, { type: "saveQuickSettings" }>) {
    const target = vscode.ConfigurationTarget.Workspace;
    const cfg = vscode.workspace.getConfiguration();
    const modelKey = modelsConfigKeyForProvider(msg.defaultProvider);
    const extra = modelKey && msg.defaultModel?.trim() ? cfg.update(modelKey, msg.defaultModel.trim(), target) : Promise.resolve();
    await Promise.all([
      cfg.update("myAi.defaultProvider", msg.defaultProvider, target),
      cfg.update("myAi.defaultModel", msg.defaultModel, target),
      cfg.update("myAi.missions.heartbeatSeconds", msg.heartbeatSeconds, target),
      cfg.update("myAi.missions.maxStepsPerRun", msg.maxStepsPerRun, target),
      cfg.update("myAi.tools.allowTerminal", msg.allowTerminal, target),
      cfg.update("myAi.tools.requireApprovalForWrite", msg.requireWriteApproval, target),
      cfg.update("myAi.ui.autoRevealOnActivation", msg.autoRevealOnActivation, target),
      cfg.update("myAi.ui.defaultTab", msg.defaultTab, target),
      cfg.update("myAi.missions.autonomy.mode", msg.autonomyMode, target),
      cfg.update("myAi.missions.blueprintMode", msg.missionBlueprintModeEnum, target),
      cfg.update("myAi.missions.autonomy.blueprintPlanning", msg.autonomyBlueprintPlanning, target),
      cfg.update("myAi.missions.autonomy.autoContinuePasses", msg.autonomyAutoContinuePasses, target),
      cfg.update("myAi.missions.autonomy.maxAutonomousStepCapChains", msg.autonomyMaxAutonomousStepCapChains, target),
      cfg.update("myAi.missions.autonomy.autoApproveWorkspaceWrites", msg.autonomyAutoApproveWorkspaceWrites, target),
      cfg.update("myAi.missions.autonomy.autoApproveWorkspaceDeletes", msg.autonomyAutoApproveWorkspaceDeletes, target),
      cfg.update("myAi.missions.autonomy.autoApproveWorkspaceSafeCommands", msg.autonomyAutoApproveWorkspaceSafeCommands, target),
      cfg.update(
        "myAi.missions.autonomy.requireApprovalForProtectedPaths",
        msg.autonomyRequireApprovalForProtectedPaths,
        target
      ),
      extra
    ]);
    // Section-scoped writes: if an older extension is loaded, unknown keys would fail the whole batch — isolate them.
    try {
      await vscode.workspace.getConfiguration("myAi.missions").update("unlimitedStepsPerRun", msg.unlimitedStepsPerRun, target);
    } catch {
      void vscode.window.showWarningMessage(
        'Autonomous Factory: could not save "Unlimited steps per run" because myAi.missions.unlimitedStepsPerRun is not registered in the loaded extension. Reload the window after installing Autonomous Factory 2.0.33+ (or add the key manually in workspace settings JSON). Other quick settings were saved.'
      );
    }
    try {
      await vscode.workspace.getConfiguration("myAi.tools").update(
        "requireApprovalForNonImplementerMutations",
        msg.requireApprovalForNonImplementerMutations,
        target
      );
    } catch {
      void vscode.window.showWarningMessage(
        'Autonomous Factory: could not save "non-implementer mutation approval" because this setting is missing from the loaded extension. Install Autonomous Factory 2.0.27 or newer (or reload the window after updating), then try again. You can set myAi.tools.requireApprovalForNonImplementerMutations in workspace settings JSON once the extension registers it.'
      );
    }
    try {
      await vscode.workspace.getConfiguration("myAi.tools").update(
        "autoApproveAllToolRequests",
        msg.autoApproveAllToolRequests,
        target
      );
    } catch {
      void vscode.window.showWarningMessage(
        'Autonomous Factory: could not save "Auto-approve all tool requests" because myAi.tools.autoApproveAllToolRequests is not registered in the loaded extension. Install Autonomous Factory 2.0.36+ (or reload the window after installing the latest VSIX), or add `"myAi.tools.autoApproveAllToolRequests": true` to `.vscode/settings.json` / workspace settings JSON. Other quick settings were saved.'
      );
    }
  }

  private async refreshProviderModelCatalog(providerId: string): Promise<void> {
    this.postMessage({ type: "info", message: `Models (${providerId}): refresh started…` });
    const result = await fetchProviderModelList(this.secrets, providerId);
    const liveOk = result.source === "live" && result.models.length > 0;
    const networkLike =
      result.source === "unavailable" ||
      /HTTP \d{3}|fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|timeout|Failed to fetch/i.test(result.hint || "");

    let applied = result;
    let usedDisk = false;
    const diskFile = isPersistedCatalogProvider(providerId) ? await this.modelCatalogCache.readAll() : undefined;
    const diskEnt =
      diskFile && isPersistedCatalogProvider(providerId)
        ? this.modelCatalogCache.getProviderFromSnapshot(diskFile, providerId)
        : undefined;

    if (isPersistedCatalogProvider(providerId) && liveOk) {
      await this.modelCatalogCache.writeMergedProvider({
        providerId,
        fetchedAt: Date.now(),
        source: "live",
        modelsAll: result.models,
        modelsDisplay: result.displayShortlist,
        hint: result.hint
      });
    } else if (isPersistedCatalogProvider(providerId) && diskEnt?.modelsAll?.length && networkLike) {
      const display =
        diskEnt.modelsDisplay?.length && diskEnt.modelsDisplay.length <= diskEnt.modelsAll.length
          ? diskEnt.modelsDisplay
          : rankFullAndShortlist(providerId, diskEnt.modelsAll).displayShortlist;
      applied = {
        models: diskEnt.modelsAll,
        displayShortlist: display,
        source: "cache",
        hint: `Using saved catalog (${diskEnt.modelsAll.length} models, saved ${new Date(diskEnt.fetchedAt).toLocaleString()}). Live refresh failed: ${result.hint || result.source}.`
      };
      usedDisk = true;
    }

    this.providerLiveModelCache[providerId] = {
      models: applied.models,
      modelsDisplay: applied.displayShortlist,
      source: applied.source,
      hint: applied.hint,
      at: usedDisk && diskEnt ? diskEnt.fetchedAt : Date.now()
    };
    this.bumpProviderChromeSyncGeneration("model_catalog_updated");
    await this.postProviderSettingsChromeSectionImmediate(undefined, "refresh_dashboard_provider_chrome_section_post", {
      refreshedCatalog: providerId
    });

    const total = applied.models.length;
    const shown = applied.displayShortlist.length;
    const origin =
      usedDisk || applied.source === "cache"
        ? "persisted cache"
        : applied.source === "live"
          ? providerId === "ollama"
            ? "live Ollama API"
            : "live API"
          : applied.source;
    const tail = applied.hint ? ` ${applied.hint}` : "";
    this.postMessage({
      type: "info",
      message: `Models (${providerId}): ${applied.source === "live" ? "succeeded" : usedDisk ? "using saved catalog" : "done"} — ${origin}; ${total} in catalog, ${shown} in latest-first picker.${tail}`
    });
  }

  private async reviewPendingDiff(missionId: string, approvalId?: string) {
    const approval = this.findPendingApproval(missionId, approvalId);
    if (!approval?.diffPreview) throw new Error("No pending diff preview found.");
    await this.tools.showApprovalDiff(approval.id, approval.diffPreview);
  }

  private async reviewPendingHunks(missionId: string, approvalId?: string) {
    const approval = this.findPendingApproval(missionId, approvalId);
    if (!approval?.diffPreview) throw new Error("No pending hunk preview found.");
    await this.tools.showApprovalHunks(approval.id, approval.diffPreview);
  }

  private findPendingApproval(missionId: string, approvalId?: string): ApprovalRequest | undefined {
    const mission = this.missionStore.get(missionId);
    if (!mission) throw new Error(`Mission not found: ${missionId}`);
    if (approvalId) return mission.approvals.find((x) => x.id === approvalId);
    return mission.approvals.find((x) => x.status === "pending");
  }

  private async resolveBundle(bundleId: string, approved: boolean, interactionId?: string) {
    const bundle = this.buildApprovalBundles(this.missionStore.list()).find((x) => x.id === bundleId);
    if (!bundle) throw new Error(`Approval bundle not found: ${bundleId}`);
    let anyResolved = false;
    for (const approvalId of bundle.approvalIds) {
      const out = await this.orchestrator.resolveApproval(
        bundle.missionId,
        approvalId,
        approved,
        approved ? "Approved via sidebar bundle" : "Rejected via sidebar bundle"
      );
      if (out?.kind && out.kind !== "noop_unknown_approval") anyResolved = true;
    }
    if (anyResolved) {
      await saveOperatorActionMissionEventIfChanged({
        store: this.missionStore,
        missionId: bundle.missionId,
        message: approved ? OPERATOR_ACTION_BUNDLE_APPROVED_MESSAGE : OPERATOR_ACTION_BUNDLE_REJECTED_MESSAGE
      });
    }
    this.focusMission(bundle.missionId, interactionId);
    this.postMessage({
      type: "info",
      message: presentBundleOperatorUiFeedback({
        approved,
        itemCount: bundle.approvalIds.length,
        anyResolved
      })
    });
  }

  private scheduleDashboardFlush(): void {
    if (this.dashboardFlushTimer !== undefined) return;
    this.dashboardFlushTimer = setTimeout(() => {
      this.dashboardFlushTimer = undefined;
      void this.refreshDashboard(undefined, { source: "dashboard_flush_followup" });
    }, 0);
  }

  /** Attach publish metadata before any init/snapshot post. */
  private sealSnapshotForPost(snapshot: SidebarSnapshot, sourceRefreshSeq: number): SidebarSnapshot {
    const snapshotPublishSeq = ++this.snapshotPublishSeq;
    const sealed = { ...snapshot, snapshotPublishSeq, sourceRefreshSeq };
    if (sealed.focusedMission?.memory?.some((m) => m.embedding)) {
      sealed.focusedMission = {
        ...sealed.focusedMission,
        memory: sealed.focusedMission.memory.map((m) =>
          m.embedding ? { ...m, embedding: undefined } : m
        )
      };
    }
    return sealed;
  }

  /**
   * Queue refresh cycles strictly one-after-another so `buildSnapshot` never overlaps.
   * Background callers (`poll`, `reveal`, `visibility`, flush-after-supersede, `focusMission` tail reconcile)
   * omit `interactionId`; those requests coalesce to at most one trailing queued refresh so a burst does not
   * enqueue identical full builds.
   * Any refresh with `interactionId` (e.g. manual Refresh button, message-handler paths that intentionally
   * request interaction-correlated rebuilds) is never coalesced away.
   *
   * Background supersession: each successful background enqueue bumps `backgroundRefreshRequestGen`. When a
   * queued background cycle starts, if its captured generation is stale, the cycle returns immediately
   * (no `buildSnapshot`, no `dashboardRefreshSeq` bump) so only the latest background intent runs a full build.
   *
   * Pass `source` for churn attribution (`refresh_dashboard_*` trace `data.refreshSource`).
   */
  async refreshDashboard(
    interactionId?: string,
    options?: { source?: DashboardRefreshSource }
  ): Promise<void> {
    return enqueueSidebarRefreshDashboard(this.sidebarRefreshOrchestrationHost(), interactionId, options);
  }

  /** Concatenated stable fingerprints for major sidebar axes (missions / memory / provider / MCP aux). */
  private materialFingerprintFromSnapshot(snapshot: SidebarSnapshot): string {
    const allMissions = this.missionStore.list();
    const missionFp = fp.missionVisibleListFingerprint(
      snapshot.missions,
      allMissions,
      this.includeArchivedMissions
    );
    const memFp = fp.globalMemoryHeadFingerprint(snapshot.globalMemoryRecent);
    const providerFp = fp.providerChromeFpFromSnapshot(snapshot);
    const auxFp = fp.mcpAuxiliaryFingerprintFromSnapshot(snapshot);
    return fp.materialFingerprintCombined(missionFp, memFp, providerFp, auxFp);
  }

  private async cachedMcpOnboarding(): Promise<McpOnboardingState> {
    const resolvedPath = this.mcp.getResolvedConfigPath();
    const c = this.mcpOnboardingCache;
    const now = Date.now();
    if (c && c.resolvedPath === resolvedPath && now - c.at < MCP_ONBOARDING_CACHE_TTL_MS) {
      return c.state;
    }
    const state = await analyzeMcpOnboarding(this.extensionUri, this.paths, resolvedPath);
    this.mcpOnboardingCache = { resolvedPath, at: now, state };
    return state;
  }

  private invalidateMcpToolsSessionsCache(): void {
    this.mcpToolsSessionsCache = undefined;
    this.auxiliaryPollStableFpCache = undefined;
  }

  private async cachedMcpToolsAndSessions(): Promise<{
    tools: Awaited<ReturnType<McpRegistry["listTools"]>>;
    sessions: Awaited<ReturnType<McpRegistry["listSessionStates"]>>;
  }> {
    const now = Date.now();
    const c = this.mcpToolsSessionsCache;
    if (c && now - c.at < MCP_TOOLS_SESSIONS_TTL_MS) {
      this.traceLogger.log({
        level: "debug",
        side: "host",
        category: "dashboard",
        event: "build_snapshot_mcp_tools_sessions_cache_hit",
        data: { ageMs: now - c.at }
      });
      return { tools: c.tools, sessions: c.sessions };
    }
    this.traceLogger.log({
      level: "debug",
      side: "host",
      category: "dashboard",
      event: "build_snapshot_mcp_tools_sessions_cache_miss"
    });
    const [tools, sessions] = await Promise.all([this.mcp.listTools(), this.mcp.listSessionStates()]);
    this.mcpToolsSessionsCache = { tools, sessions, at: now };
    return { tools, sessions };
  }

  private invalidateProviderCredentialCache(providerId?: string): void {
    if (providerId) this.providerCredentialEntryCache.delete(providerId);
    else this.providerCredentialEntryCache.clear();
    this.bumpProviderChromeSyncGeneration(providerId ? "credential_invalidated_single" : "credential_invalidated_all");
  }

  /** Any host path that mutates provider-chrome fingerprint inputs must call this so poll cannot reuse a stale sync cache. */
  private bumpProviderChromeSyncGeneration(reason: string): void {
    this.providerChromeSyncGeneration += 1;
    this.traceLogger.log({
      level: "debug",
      side: "host",
      category: "dashboard",
      event: "provider_chrome_sync_generation_bump",
      data: { reason, generation: this.providerChromeSyncGeneration }
    });
  }

  /**
   * Latest time before which poll may treat credential cache rows as TTL-valid for every api-key provider.
   * Undefined if any required row is missing or already expired (caller must run eager credential resolution).
   */
  private computeProviderCredentialWarmWindowEnd(now: number): number | undefined {
    let minEnd = Number.POSITIVE_INFINITY;
    let anyApiKey = false;
    for (const id of this.providers.list()) {
      if (!providerNeedsApiKey(id)) continue;
      anyApiKey = true;
      const hit = this.providerCredentialEntryCache.get(id);
      if (!hit || now - hit.at >= PROVIDER_CREDENTIAL_ENTRY_TTL_MS) return undefined;
      minEnd = Math.min(minEnd, hit.at + PROVIDER_CREDENTIAL_ENTRY_TTL_MS);
    }
    return anyApiKey ? minEnd : Number.MAX_SAFE_INTEGER;
  }

  private async resolveProviderCredentialStatus(id: string): Promise<ProviderCredentialStatus> {
    if (!providerNeedsApiKey(id)) return { id, needsApiKey: false, configured: true };
    const now = Date.now();
    const hit = this.providerCredentialEntryCache.get(id);
    if (hit && now - hit.at < PROVIDER_CREDENTIAL_ENTRY_TTL_MS) {
      this.credResolutionProfile.hits += 1;
      return { ...hit.entry };
    }
    this.credResolutionProfile.misses += 1;
    const sk = secretKeyForProvider(id);
    const v = sk ? await this.secrets.get(sk) : undefined;
    const entry: ProviderCredentialStatus = { id, needsApiKey: true, configured: !!(v && v.trim()) };
    this.providerCredentialEntryCache.set(id, { entry: { ...entry }, at: now });
    this.bumpProviderChromeSyncGeneration("credential_entry_resolved");
    return entry;
  }

  /** Return shape shared by eager and warm provider chrome materialization. */
  private async buildProviderSettingsChromeHostSliceEager(): Promise<SidebarChromeSlice> {
    const settings = readSidebarWorkspaceSettings();
    const cfg = vscode.workspace.getConfiguration();
    const resolvedDefaultModel = resolveModelForProvider(settings.defaultProvider, undefined, (k, d) => cfg.get(k, d));
    const providerCredentialStatus = await Promise.all(this.providers.list().map((id) => this.resolveProviderCredentialStatus(id)));
    return {
      providers: this.providers.list(),
      defaultProvider: settings.defaultProvider,
      defaultModel: settings.defaultModel,
      resolvedDefaultModel,
      providerCredentialStatus,
      providerModelPresets: { ...PROVIDER_MODEL_PRESETS },
      providerLiveModelCatalog: { ...this.providerLiveModelCache },
      lastProviderTest: this.lastProviderTest,
      providerHealth: { ...this.providerHealth },
      providerBaseUrls: readProviderBaseUrls(this.providers),
      providerSavedModels: readProviderSavedModels(this.providers),
      settings
    };
  }

  /**
   * When every `providerNeedsApiKey` provider has a credential cache entry still within
   * `PROVIDER_CREDENTIAL_ENTRY_TTL_MS`, the chrome slice matches `buildProviderSettingsChromeHostSliceEager`
   * without `secrets.get` or async credential resolution. Explicit `invalidateProviderCredentialCache` removes
   * entries → undefined here → eager rebuild refreshes truth.
   */
  private tryMaterializeProviderSettingsChromeHostSliceFromWarmCredentialCache(now: number):
    | Awaited<ReturnType<AiSidebarProvider["buildProviderSettingsChromeHostSliceEager"]>>
    | undefined {
    const settings = readSidebarWorkspaceSettings();
    const cfg = vscode.workspace.getConfiguration();
    const resolvedDefaultModel = resolveModelForProvider(settings.defaultProvider, undefined, (k, d) => cfg.get(k, d));
    const ids = this.providers.list();
    const providerCredentialStatus: ProviderCredentialStatus[] = [];
    for (const id of ids) {
      if (!providerNeedsApiKey(id)) {
        providerCredentialStatus.push({ id, needsApiKey: false, configured: true });
        continue;
      }
      const hit = this.providerCredentialEntryCache.get(id);
      if (!hit || now - hit.at >= PROVIDER_CREDENTIAL_ENTRY_TTL_MS) return undefined;
      providerCredentialStatus.push({ ...hit.entry });
    }
    return {
      providers: ids,
      defaultProvider: settings.defaultProvider,
      defaultModel: settings.defaultModel,
      resolvedDefaultModel,
      providerCredentialStatus,
      providerModelPresets: { ...PROVIDER_MODEL_PRESETS },
      providerLiveModelCatalog: { ...this.providerLiveModelCache },
      lastProviderTest: this.lastProviderTest,
      providerHealth: { ...this.providerHealth },
      providerBaseUrls: readProviderBaseUrls(this.providers),
      providerSavedModels: readProviderSavedModels(this.providers),
      settings
    };
  }

  /** Trace-only: why provider chrome had to run the eager async credential path. */
  private inferProviderChromeEagerReason(now: number): string {
    for (const id of this.providers.list()) {
      if (!providerNeedsApiKey(id)) continue;
      const hit = this.providerCredentialEntryCache.get(id);
      if (!hit) return "credential_cache_missing";
      if (now - hit.at >= PROVIDER_CREDENTIAL_ENTRY_TTL_MS) return "credential_cache_expired";
    }
    return "unknown";
  }

  /**
   * Canonical provider chrome for host: synchronous RAM path when all credential TTL caches are valid (same
   * staleness bound as `resolveProviderCredentialStatus` hits); otherwise `buildProviderSettingsChromeHostSliceEager`.
   */
  private async resolveProviderSettingsChromeHostSlice(
    resolveFor: "build_snapshot" | "provider_section"
  ): Promise<{
    slice: Awaited<ReturnType<AiSidebarProvider["buildProviderSettingsChromeHostSliceEager"]>>;
    usedWarmCredentialCache: boolean;
  }> {
    const now = Date.now();
    const warm = this.tryMaterializeProviderSettingsChromeHostSliceFromWarmCredentialCache(now);
    if (warm) {
      this.traceLogger.log({
        level: "debug",
        side: "host",
        category: "dashboard",
        event: "provider_chrome_slice_async_skipped",
        data: {
          resolveFor,
          reason: "warm_credential_cache_all_within_ttl",
          providerCount: warm.providers.length,
          credentialRowCount: warm.providerCredentialStatus.length
        }
      });
      return { slice: warm, usedWarmCredentialCache: true };
    }
    const slice = await this.buildProviderSettingsChromeHostSliceEager();
    this.traceLogger.log({
      level: "debug",
      side: "host",
      category: "dashboard",
      event: "provider_chrome_slice_async_ran",
      data: { resolveFor, reason: this.inferProviderChromeEagerReason(now) }
    });
    return { slice, usedWarmCredentialCache: false };
  }

  /**
   * Poll router only: same string as `missionVisibleListFingerprint(missions, allMissions)` for current store state
   * (`missions` = visible subset of one `list()` pass). When `getMissionMutationGeneration()` and archive filter match
   * `missionPollFingerprintCache`, returns the cached fingerprint without re-scanning — safe because generation bumps
   * on every `MISSIONS_KEY` write. Same blind spots as the fingerprint itself (fields not in the row string are invisible to drift).
   */
  private computeMissionFingerprintForPollRoute(): {
    missionFp: string;
    usedPollMissionFingerprintCache: boolean;
    recomputeReason?: string;
  } {
    const gen = this.missionStore.getMissionMutationGeneration();
    const inc = this.includeArchivedMissions;
    const c = this.missionPollFingerprintCache;
    if (c && c.storeGeneration === gen && c.includeArchived === inc) {
      this.traceLogger.log({
        level: "debug",
        side: "host",
        category: "dashboard",
        event: "poll_mission_fp_shortcut",
        data: { reason: "store_generation_and_filter_unchanged", storeGeneration: gen }
      });
      return { missionFp: c.fingerprint, usedPollMissionFingerprintCache: true };
    }
    const reason = !c ? "no_cache" : c.storeGeneration !== gen ? "store_generation_bumped" : "include_archived_changed";
    const { allMissions, missions } = missionAllAndVisibleForFingerprint(this.missionStore, inc);
    const fingerprint = fp.missionVisibleListFingerprint(missions, allMissions, inc);
    this.missionPollFingerprintCache = { storeGeneration: gen, includeArchived: inc, fingerprint };
    this.traceLogger.log({
      level: "debug",
      side: "host",
      category: "dashboard",
      event: "poll_mission_fp_recomputed",
      data: { reason, storeGeneration: gen }
    });
    return { missionFp: fingerprint, usedPollMissionFingerprintCache: false, recomputeReason: reason };
  }

  /** Authoritative MCP tools/sessions + onboarding slice (async); used by full `buildSnapshot` and auxiliary section posts. */
  private async buildMcpAuxiliaryHostSlice(): Promise<{
    mcpOnboarding: McpOnboardingState;
    mcpToolCount: number;
    mcpSessionCount: number;
  }> {
    const [{ tools: mcpTools, sessions: mcpSessions }, mcpOnboarding] = await Promise.all([
      this.cachedMcpToolsAndSessions(),
      this.cachedMcpOnboarding()
    ]);
    return {
      mcpOnboarding,
      mcpToolCount: mcpTools.filter((x) => x.name !== "<unavailable>").length,
      mcpSessionCount: mcpSessions.length
    };
  }

  /**
   * When both in-memory MCP caches are still within the same TTL windows as `cachedMcpToolsAndSessions` /
   * `cachedMcpOnboarding`, the auxiliary slice is fully determined by that RAM — no await, same result as
   * `buildMcpAuxiliaryHostSlice`. If either cache is missing/expired/path-stale, returns undefined so callers
   * must run the async path (which may refresh from MCP / disk). Explicit invalidation clears caches → undefined here.
   */
  private readMcpAuxiliaryWarmCaches(now: number): McpAuxiliaryWarmRead | undefined {
    const tc = this.mcpToolsSessionsCache;
    const oc = this.mcpOnboardingCache;
    const resolvedPath = this.mcp.getResolvedConfigPath();
    if (!tc || now - tc.at >= MCP_TOOLS_SESSIONS_TTL_MS) return undefined;
    if (!oc || oc.resolvedPath !== resolvedPath || now - oc.at >= MCP_ONBOARDING_CACHE_TTL_MS) {
      return undefined;
    }
    return {
      tools: tc.tools,
      sessions: tc.sessions,
      onboarding: oc.state,
      toolsCacheAgeMs: now - tc.at,
      onboardingCacheAgeMs: now - oc.at
    };
  }

  private mcpAuxiliarySliceFromWarmCaches(warm: {
    tools: Awaited<ReturnType<McpRegistry["listTools"]>>;
    sessions: Awaited<ReturnType<McpRegistry["listSessionStates"]>>;
    onboarding: McpOnboardingState;
    toolsCacheAgeMs: number;
    onboardingCacheAgeMs: number;
  }): McpAuxiliaryWarmMaterializedSlice {
    return {
      mcpOnboarding: warm.onboarding,
      mcpToolCount: warm.tools.filter((x: { name: string }) => x.name !== "<unavailable>").length,
      mcpSessionCount: warm.sessions.length
    };
  }

  /**
   * When MCP warm caches are valid, returns auxiliary fingerprint; reuses cached string if tools/onboarding cache
   * `at` and config path unchanged since last compute (same slice as `mcpAuxiliarySliceFromWarmCaches`). Clears when
   * warm proof fails. Does not replace `resolveMcpAuxiliarySlice` when a publish may be needed.
   *
   * On stable-FP cache **miss** but warm RAM still valid, returns `sameTickWarmMaterializedSlice` so
   * `resolveMcpAuxiliarySlice` does not call `mcpAuxiliarySliceFromWarmCaches` again in the same tick (same data).
   *
   * @param warmProbe result of a single `readMcpAuxiliaryWarmCaches` for this tick — caller reuses it in
   * `resolveMcpAuxiliarySlice` so poll auxiliary path does not double-probe TTL caches.
   */
  private tryAuxiliaryFingerprintFromStableWarmPollCache(warmProbe: McpAuxiliaryWarmRead | undefined): {
    fingerprint: string | undefined;
    /** Set only when fp was rebuilt (not stable-string cache hit); safe to pass to `resolveMcpAuxiliarySlice` this tick only. */
    sameTickWarmMaterializedSlice?: McpAuxiliaryWarmMaterializedSlice;
  } {
    const warm = warmProbe;
    if (!warm) {
      this.auxiliaryPollStableFpCache = undefined;
      return { fingerprint: undefined };
    }
    const tc = this.mcpToolsSessionsCache!;
    const oc = this.mcpOnboardingCache!;
    const resolvedConfigPath = this.mcp.getResolvedConfigPath();
    const c = this.auxiliaryPollStableFpCache;
    if (
      c &&
      c.toolsCacheAt === tc.at &&
      c.onboardingCacheAt === oc.at &&
      c.resolvedConfigPath === resolvedConfigPath
    ) {
      this.traceLogger.log({
        level: "debug",
        side: "host",
        category: "dashboard",
        event: "auxiliary_poll_stable_fp_cache_hit",
        data: { toolsCacheAt: tc.at, onboardingCacheAt: oc.at }
      });
      return { fingerprint: c.fp };
    }
    const slice = this.mcpAuxiliarySliceFromWarmCaches(warm);
    const auxFp = fp.mcpAuxiliaryFingerprintFromSlice(slice);
    this.auxiliaryPollStableFpCache = {
      toolsCacheAt: tc.at,
      onboardingCacheAt: oc.at,
      resolvedConfigPath,
      fp: auxFp
    };
    return { fingerprint: auxFp, sameTickWarmMaterializedSlice: slice };
  }

  /** Trace-only: why `resolveMcpAuxiliarySlice` had to await `buildMcpAuxiliaryHostSlice`. */
  private inferMcpAuxiliaryAsyncBuildReason(now: number): string {
    const tc = this.mcpToolsSessionsCache;
    const oc = this.mcpOnboardingCache;
    const resolvedPath = this.mcp.getResolvedConfigPath();
    if (!tc) return "tools_cache_empty";
    if (now - tc.at >= MCP_TOOLS_SESSIONS_TTL_MS) return "tools_cache_expired";
    if (!oc) return "onboarding_cache_empty";
    if (oc.resolvedPath !== resolvedPath) return "onboarding_path_changed";
    if (now - oc.at >= MCP_ONBOARDING_CACHE_TTL_MS) return "onboarding_cache_expired";
    return "unknown";
  }

  /**
   * Canonical MCP auxiliary slice for host: same warm-cache proof as `readMcpAuxiliaryWarmCaches`, then either
   * synchronous materialization from RAM or `buildMcpAuxiliaryHostSlice()` (cached MCP + onboarding TTL path).
   * Used by sectional dashboard posts and full `buildSnapshot` so auxiliary fields cannot drift between paths.
   *
   * When `reuseAuxiliaryWarmProbe` is set, skips a second `readMcpAuxiliaryWarmCaches` — must be the same
   * synchronous probe `postAuxiliarySectionImmediate` already used for stable FP (same `now`/cache rows).
   *
   * When `reuseSameTickWarmSlice` is set (poll path only), uses the slice `tryAuxiliaryFingerprintFromStableWarmPollCache`
   * already built this tick — avoids duplicate `mcpAuxiliarySliceFromWarmCaches` when stable FP string cache missed.
   */
  private async resolveMcpAuxiliarySlice(
    resolveFor: "dashboard_section" | "build_snapshot",
    opts?: {
      reuseAuxiliaryWarmProbe: McpAuxiliaryWarmRead | undefined;
      reuseSameTickWarmSlice?: McpAuxiliaryWarmMaterializedSlice;
    }
  ): Promise<{
    slice: McpAuxiliaryWarmMaterializedSlice;
    /** True iff slice came from `readMcpAuxiliaryWarmCaches` (async `buildMcpAuxiliaryHostSlice` not used). */
    usedWarmCaches: boolean;
    /** Poll-only: slice object was reused from `tryAuxiliaryFingerprintFromStableWarmPollCache` this tick. */
    sameTickWarmSliceReuse?: boolean;
  }> {
    const now = Date.now();
    const warm = opts ? opts.reuseAuxiliaryWarmProbe : this.readMcpAuxiliaryWarmCaches(now);
    const pollWarmProbeDeduped = !!opts;
    if (opts?.reuseSameTickWarmSlice) {
      const slice = opts.reuseSameTickWarmSlice;
      const w = warm;
      this.traceLogger.log({
        level: "debug",
        side: "host",
        category: "dashboard",
        event: "auxiliary_slice_async_skipped",
        data: {
          resolveFor,
          reason: "same_tick_warm_slice_reuse_after_stable_fp_miss",
          toolsCacheAgeMs: w?.toolsCacheAgeMs,
          onboardingCacheAgeMs: w?.onboardingCacheAgeMs,
          mcpToolCount: slice.mcpToolCount,
          mcpSessionCount: slice.mcpSessionCount,
          pollWarmProbeDeduped,
          sameTickWarmSliceReuse: true
        }
      });
      return { slice, usedWarmCaches: true, sameTickWarmSliceReuse: true };
    }
    if (warm) {
      const slice = this.mcpAuxiliarySliceFromWarmCaches(warm);
      this.traceLogger.log({
        level: "debug",
        side: "host",
        category: "dashboard",
        event: "auxiliary_slice_async_skipped",
        data: {
          resolveFor,
          reason: "warm_caches_within_ttl",
          toolsCacheAgeMs: warm.toolsCacheAgeMs,
          onboardingCacheAgeMs: warm.onboardingCacheAgeMs,
          mcpToolCount: slice.mcpToolCount,
          mcpSessionCount: slice.mcpSessionCount,
          pollWarmProbeDeduped,
          sameTickWarmSliceReuse: false
        }
      });
      return { slice, usedWarmCaches: true };
    }
    const slice = await this.buildMcpAuxiliaryHostSlice();
    this.traceLogger.log({
      level: "debug",
      side: "host",
      category: "dashboard",
      event: "auxiliary_slice_async_ran",
      data: {
        resolveFor,
        reason: this.inferMcpAuxiliaryAsyncBuildReason(now),
        pollWarmProbeDeduped,
        sameTickWarmSliceReuse: false
      }
    });
    return { slice, usedWarmCaches: false };
  }

  private captureStabilityBaselineFromSnapshot(snapshot: SidebarSnapshot): void {
    const { allMissions, missions } = missionAllAndVisibleForFingerprint(this.missionStore, this.includeArchivedMissions);
    this.stabilityBaseline = {
      missionFp: fp.missionVisibleListFingerprint(missions, allMissions, this.includeArchivedMissions),
      globalMemFp: fp.globalMemoryHeadFingerprint(snapshot.globalMemoryRecent),
      providerChromeFp: fp.providerChromeFpFromSnapshot(snapshot)
    };
  }

  /**
   * Poll-only head fingerprint: same string as `globalMemoryHeadFingerprint(buildGlobalMemoryContextHostSlice()...)`
   * because the fingerprint uses only `id:ts` — avoids allocating `{ kind, text }` objects on recompute ticks.
   */
  private globalMemoryHeadFingerprintFromStoreHead(): string {
    return this.globalMemory
      .list()
      .slice(0, 10)
      .map((item) => `${item.id}:${item.ts}`)
      .join(",");
  }

  /**
   * Poll router only: same string as `globalMemoryHeadFingerprint(buildGlobalMemoryContextHostSlice().globalMemoryRecent)`.
   * Cached while `globalMemory.getMutationGeneration()` matches; bumps on `add` / `hydrateFromDisk`.
   */
  private computeGlobalMemoryHeadFingerprintForPollRoute(): {
    memFp: string;
    usedPollGlobalMemoryHeadCache: boolean;
  } {
    const gen = this.globalMemory.getMutationGeneration();
    const c = this.globalMemoryPollHeadFpCache;
    if (c && c.generation === gen) {
      this.traceLogger.log({
        level: "debug",
        side: "host",
        category: "dashboard",
        event: "poll_global_memory_fp_shortcut",
        data: { reason: "mutation_generation_unchanged", generation: gen }
      });
      return { memFp: c.headFp, usedPollGlobalMemoryHeadCache: true };
    }
    const headFp = this.globalMemoryHeadFingerprintFromStoreHead();
    this.globalMemoryPollHeadFpCache = { generation: gen, headFp };
    this.traceLogger.log({
      level: "debug",
      side: "host",
      category: "dashboard",
      event: "poll_global_memory_fp_recomputed",
      data: { reason: !c ? "no_cache" : "generation_bumped", generation: gen }
    });
    return { memFp: headFp, usedPollGlobalMemoryHeadCache: false };
  }

  /**
   * Live provider-chrome fingerprint for poll baselines: must match `providerChromeFpFromSnapshot` semantics.
   * When `tryMaterializeProviderSettingsChromeHostSliceFromWarmCredentialCache` succeeds, credential rows come
   * from the same TTL cache as `resolveProviderSettingsChromeHostSlice` — identical string to the eager path
   * that would have hit those caches, so drift detection is unchanged; only redundant `secrets.get` is skipped.
   *
   * Poll-only: when `providerChromeSyncGeneration` is unchanged and credential TTL window still valid, reuse the
   * last fingerprint — skips `readSettings` / `readProviderBaseUrls` / `readProviderSavedModels` / warm materialize /
   * `providerChromeFingerprintPayload` on steady ticks (generation bumps on config, catalog, test, credential changes).
   */
  private async computeProviderChromeFingerprintLive(): Promise<{
    fingerprint: string;
    usedWarmCredentialPath: boolean;
    providerSyncShortcut?: boolean;
  }> {
    const now = Date.now();
    const gen = this.providerChromeSyncGeneration;
    const syncHit = this.providerPollChromeFpCache;
    if (syncHit && syncHit.syncGeneration === gen && now < syncHit.warmCredWindowEnd) {
      this.traceLogger.log({
        level: "debug",
        side: "host",
        category: "dashboard",
        event: "poll_provider_chrome_fp_sync_shortcut",
        data: {
          reason: "sync_generation_and_cred_ttl_unchanged",
          generation: gen,
          warmCredWindowEnd: syncHit.warmCredWindowEnd,
          usedWarmCredentialPath: syncHit.usedWarmCredentialPath
        }
      });
      return {
        fingerprint: syncHit.fingerprint,
        usedWarmCredentialPath: syncHit.usedWarmCredentialPath,
        providerSyncShortcut: true
      };
    }

    const warmSlice = this.tryMaterializeProviderSettingsChromeHostSliceFromWarmCredentialCache(now);
    if (warmSlice) {
      const fingerprint = fp.providerChromeFingerprintPayload({
        defaultProvider: warmSlice.defaultProvider,
        defaultModel: warmSlice.defaultModel,
        resolvedDefaultModel: warmSlice.resolvedDefaultModel,
        providerCredentialStatus: warmSlice.providerCredentialStatus,
        providerBaseUrls: warmSlice.providerBaseUrls,
        providerSavedModels: warmSlice.providerSavedModels,
        providerLiveModelCatalog: warmSlice.providerLiveModelCatalog,
        lastProviderTest: warmSlice.lastProviderTest
      });
      const warmCredWindowEnd = this.computeProviderCredentialWarmWindowEnd(now) ?? 0;
      this.providerPollChromeFpCache = {
        syncGeneration: gen,
        fingerprint,
        usedWarmCredentialPath: true,
        warmCredWindowEnd
      };
      this.traceLogger.log({
        level: "debug",
        side: "host",
        category: "dashboard",
        event: "poll_provider_chrome_fp_warm_bypass",
        data: { reason: "credential_ttl_cache_same_as_chrome_resolver", warmCredWindowEnd }
      });
      return { fingerprint, usedWarmCredentialPath: true, providerSyncShortcut: false };
    }
    const settings = readSidebarWorkspaceSettings();
    const cfg = vscode.workspace.getConfiguration();
    const resolvedDefaultModel = resolveModelForProvider(settings.defaultProvider, undefined, (k, d) => cfg.get(k, d));
    const providerCredentialStatus = await Promise.all(this.providers.list().map((id) => this.resolveProviderCredentialStatus(id)));
    const fingerprint = fp.providerChromeFingerprintPayload({
      defaultProvider: settings.defaultProvider,
      defaultModel: settings.defaultModel,
      resolvedDefaultModel,
      providerCredentialStatus,
      providerBaseUrls: readProviderBaseUrls(this.providers),
      providerSavedModels: readProviderSavedModels(this.providers),
      providerLiveModelCatalog: { ...this.providerLiveModelCache },
      lastProviderTest: this.lastProviderTest,
      providerHealth: { ...this.providerHealth }
    });
    const warmCredWindowEnd = this.computeProviderCredentialWarmWindowEnd(Date.now()) ?? 0;
    this.providerPollChromeFpCache = {
      syncGeneration: this.providerChromeSyncGeneration,
      fingerprint,
      usedWarmCredentialPath: false,
      warmCredWindowEnd
    };
    this.traceLogger.log({
      level: "debug",
      side: "host",
      category: "dashboard",
      event: "poll_provider_chrome_fp_eager",
      data: { reason: this.inferProviderChromeEagerReason(now), warmCredWindowEnd }
    });
    return { fingerprint, usedWarmCredentialPath: false, providerSyncShortcut: false };
  }

  /**
   * Poll / visibility-visible: cheap sectional updates when baselines allow.
   * - All three axes match → auxiliary-only (MCP/onboarding tools counts).
   * - Mission+provider match but global memory head drifted → `globalMemory` section only.
   * - **Only** mission fingerprint drift (runner/events/queue) → `missions` section (same merge as
   *   `postMissionDashboardSnapshotImmediate`; avoids full `buildSnapshot`).
   * - **Only** provider/settings chrome drift (workspace + cred flags + catalog cache) → `providerChrome`
   *   section via `postProviderSettingsChromeSectionImmediate`.
   * - **Two-axis** drift when both axes have existing section publishers → two sequential sectional posts
   *   (same tick, `lastPostedSnapshot` updated between posts). **Three-axis** → provider chrome, then missions,
   *   then global memory (settings on `lastPostedSnapshot` before mission merge).
   * - Any combination **not** covered above → full `refreshDashboard` (`poll_fallback_full`).
   *
   * `pollKind` is trace-only (churn attribution); does not change routing logic.
   */
  private async maybePollDashboardRefresh(pollKind: "interval" | "visibility" | "reveal" = "interval"): Promise<void> {
    if (!this.view?.webview) return;
    if (!this.lastPostedSnapshot || !this.stabilityBaseline) {
      this.traceLogger.log({
        level: "info",
        side: "host",
        category: "dashboard",
        event: "poll_tick_route",
        data: { pollKind, outcome: "full_refresh", reason: "cold_no_snapshot_or_baseline", buildSnapshot: true }
      });
      await this.refreshDashboard(undefined, { source: "poll_fallback_full" });
      return;
    }
    await runSidebarPollWarmExecution(this.sidebarPollWarmHost(), pollKind, this.stabilityBaseline);
  }

  /**
   * Host-only auxiliary section: MCP list/session counts + onboarding state merged into `lastPostedSnapshot`.
   * Does not run provider credential I/O or mission aggregation.
   *
   * Resolves the slice via `resolveMcpAuxiliarySlice("dashboard_section")`: when tools + onboarding TTL caches
   * are both valid, the slice is materialized synchronously from RAM (no async `buildMcpAuxiliaryHostSlice`).
   * Otherwise the async cached path runs (explicit invalidation clears caches → async refresh).
   *
   * When the computed slice matches what was already posted (`mcpAuxiliaryFingerprintFromSnapshot`), skips
   * `postMessage` and `auxiliarySectionSeq` bump.
   *
   * @returns publish/warm-cache flags; `auxiliaryPollStableFpNoop` when noop without `resolveMcpAuxiliarySlice`;
   * `auxiliaryPollWarmProbeDeduped` when `resolveMcpAuxiliarySlice` reused the tick's single warm probe.
   */
  private async postAuxiliarySectionImmediate(): Promise<{
    published: boolean;
    usedWarmAuxiliaryCache: boolean;
    auxiliaryPollStableFpNoop?: boolean;
    auxiliaryPollWarmProbeDeduped?: boolean;
    auxiliarySameTickWarmSliceReuse?: boolean;
  }> {
    return postAuxiliarySectionImmediateForHost(this.sidebarSectionPublishHost());
  }

  /**
   * Global memory head only: merges `globalMemoryRecent` into `lastPostedSnapshot` (no missions/MCP/provider rebuild).
   */
  private postGlobalMemorySectionImmediate(): void {
    postGlobalMemorySectionImmediateForHost(this.sidebarSectionPublishHost());
  }

  /**
   * Reuses pending approvals, bundles, timeline, and tool-event rollups when the visible mission fingerprint
   * matches the last build (safe: same inputs as the materialized arrays).
   *
   * On recompute: one pending-approval filter per mission feeds both the flat approvals list and bundle grouping
   * (avoids duplicating `filter(pending)` + grouping work with `buildApprovalBundles`). Recent tool rows use a
   * backward scan per mission instead of `filter(tool:).slice(-6)` intermediate arrays.
   */
  private computeMissionDerivedSlices(missions: Mission[], allMissions: Mission[]) {
    type RT = NonNullable<SidebarToolSummary["recentToolEvents"]>;
    const missionListFp = `${fp.missionVisibleListFingerprint(missions, allMissions, this.includeArchivedMissions)}|gpend:${fp.globalPendingApprovalsFingerprint(allMissions)}`;
    const c = this.missionDerivedCache;
    if (c && c.fp === missionListFp) {
      return {
        pendingApprovals: c.pendingApprovals,
        approvalBundles: c.approvalBundles,
        timeline: c.timeline,
        recentToolEvents: c.recentToolEvents as RT,
        missionDerivedCacheHit: true
      };
    }
    const slices = computeMissionDerivedSlicesPure(missions, allMissions);
    this.missionDerivedCache = { fp: missionListFp, ...slices };
    this.traceLogger.log({
      level: "debug",
      side: "host",
      category: "dashboard",
      event: "mission_derived_slices_recompute",
      data: {
        missions: missions.length,
        singlePassPendingForBundles: true,
        toolTailReverseScan: true
      }
    });
    return {
      ...slices,
      missionDerivedCacheHit: false,
      missionDerivedRecomputeMeta: { singlePassPendingForBundles: true, toolTailReverseScan: true }
    };
  }

  private async buildSnapshot(): Promise<SidebarSnapshot> {
    return buildSidebarDashboardSnapshot(this.sidebarBuildSnapshotHost());
  }

  /**
   * Immediate mission-scoped snapshot (list, focus, approvals slice, timeline, agents for focused mission).
   * Skips slow `buildSnapshot` I/O so the UI updates without waiting on `refreshQueue`.
   */
  private postMissionDashboardSnapshotImmediate(interactionId?: string): void {
    postMissionDashboardSnapshotImmediateForHost(this.sidebarSectionPublishHost(), interactionId);
  }

  /**
   * Provider/settings/credential chrome only: merges the authoritative chrome slice into `lastPostedSnapshot`
   * and posts `snapshotSection` (no `snapshotPublishSeq` bump; guarded by `sectionBasePublishSeq` + `sectionSeq`).
   */
  private async postProviderSettingsChromeSectionImmediate(
    interactionId: string | undefined,
    traceEvent: string,
    extraTrace?: Record<string, unknown>
  ): Promise<void> {
    await postProviderSettingsChromeSectionImmediateForHost(
      this.sidebarSectionPublishHost(),
      interactionId,
      traceEvent,
      extraTrace
    );
  }

  private buildApprovalBundles(missions: Mission[]): SidebarApprovalBundleSummary[] {
    return buildApprovalBundlesFromMissions(missions);
  }

  private buildAgentLive(mission: Mission | undefined): SidebarAgentLiveItem[] {
    return buildAgentLiveFromMission(mission);
  }

  private resolveFocusedMission(missions: Mission[]): Mission | undefined {
    return resolveFocusedMission(missions, this.focusedMissionId);
  }

  private buildAgentStatus(mission: Mission | undefined, defaultProvider: string, defaultModel: string): SidebarAgentStatus[] {
    return buildAgentStatusFromMission(mission, defaultProvider, defaultModel);
  }

  private postMessage(message: ExtToUiMessage, traceOpts?: { interactionId?: string }) {
    const messageType = message.type;
    const dataSummary =
      message.type === "snapshot" || message.type === "init"
        ? {
            missions: message.snapshot.missions.length,
            includeArchived: message.snapshot.missionList?.includeArchived,
            totalCount: message.snapshot.missionList?.totalCount,
            snapshotPublishSeq: message.snapshot.snapshotPublishSeq,
            sourceRefreshSeq: message.snapshot.sourceRefreshSeq,
            archivedCount: message.snapshot.missionList?.archivedCount
          }
        : message.type === "snapshotSection"
          ? {
              section: message.section,
              missions: message.snapshot.missions.length,
              sectionSeq: message.sectionSeq,
              sectionBasePublishSeq: message.sectionBasePublishSeq
            }
          : { kind: message.type };
    this.traceLogger.log({
      level: "debug",
      side: "host",
      category: "protocol",
      event: "webview_post_message_start",
      messageType,
      interactionId: traceOpts?.interactionId,
      data: dataSummary
    });
    try {
      const enriched: ExtToUiMessage =
        message.type === "init" || message.type === "snapshot"
          ? {
              ...message,
              traceContext: {
                interactionId: traceOpts?.interactionId,
                snapshotPublishSeq: message.snapshot.snapshotPublishSeq,
                sourceRefreshSeq: message.snapshot.sourceRefreshSeq
              }
            }
          : message.type === "snapshotSection"
            ? {
                ...message,
                traceContext: {
                  interactionId: traceOpts?.interactionId,
                  snapshotPublishSeq: message.snapshot.snapshotPublishSeq,
                  sourceRefreshSeq: message.snapshot.sourceRefreshSeq,
                  section: message.section,
                  sectionSeq: message.sectionSeq,
                  sectionBasePublishSeq: message.sectionBasePublishSeq
                }
              }
            : message;
      if (
        enriched.type === "init" ||
        enriched.type === "snapshot" ||
        enriched.type === "snapshotSection"
      ) {
        const rough = roughWebviewSnapshotPayloadBytes(enriched.snapshot);
        const bucket =
          rough >= 3_000_000 ? "xl" : rough >= 1_000_000 ? "lg" : rough >= 400_000 ? "md" : "sm";
        if (rough >= SNAPSHOT_PAYLOAD_WARN_ROUGH_BYTES) {
          this.traceLogger.log({
            level: "info",
            side: "host",
            category: "protocol",
            event: "webview_snapshot_payload_pressure",
            data: {
              roughBytes: rough,
              bucket,
              messageType: enriched.type,
              section: enriched.type === "snapshotSection" ? enriched.section : undefined
            }
          });
        } else if (this.traceLogger.getConfiguredLevel() === "trace") {
          this.traceLogger.log({
            level: "debug",
            side: "host",
            category: "protocol",
            event: "webview_snapshot_payload_estimate",
            data: { roughBytes: rough, bucket, messageType: enriched.type }
          });
        }
      }
      void this.view?.webview.postMessage(enriched);
      if (message.type === "init" || message.type === "snapshot" || message.type === "snapshotSection") {
        this.lastPostedSnapshot = message.snapshot;
      }
      if (message.type === "init" || message.type === "snapshot") {
        this.captureStabilityBaselineFromSnapshot(message.snapshot);
      }
      if (
        message.type === "snapshotSection" &&
        (message.section === "missions" || message.section === "providerChrome" || message.section === "globalMemory")
      ) {
        this.captureStabilityBaselineFromSnapshot(message.snapshot);
      }
      this.traceLogger.log({
        level: "debug",
        side: "host",
        category: "protocol",
        event: "webview_post_message_done",
        messageType,
        interactionId: traceOpts?.interactionId,
        ok: true,
        data: {
          snapshotPublishSeq:
            message.type === "init" || message.type === "snapshot"
              ? message.snapshot.snapshotPublishSeq
              : message.type === "snapshotSection"
                ? message.sectionBasePublishSeq
                : undefined,
          sourceRefreshSeq:
            message.type === "init" || message.type === "snapshot" ? message.snapshot.sourceRefreshSeq : undefined,
          sectionSeq: message.type === "snapshotSection" ? message.sectionSeq : undefined
        }
      });
    } catch (err) {
      this.traceLogger.log({
        level: "error",
        side: "host",
        category: "protocol",
        event: "webview_post_message_error",
        messageType,
        interactionId: traceOpts?.interactionId,
        ok: false,
        data: {
          error: err instanceof Error ? err.message : String(err),
          snapshotPublishSeq:
            message.type === "init" || message.type === "snapshot" ? message.snapshot.snapshotPublishSeq : undefined
        }
      });
      console.error("[my-ai] webview postMessage failed", err);
    }
  }

}
