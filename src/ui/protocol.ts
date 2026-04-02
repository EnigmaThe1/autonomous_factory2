import { AgentRole, Mission } from "../types";
import type { TraceLevel, TraceRecord } from "../diagnostics/traceTypes";
import type { BlueprintProgress } from "../missions/blueprintProgress";

export interface MissionProgressStats {
  total: number;
  done: number;
  running: number;
  todo: number;
  blocked: number;
  failed: number;
  skipped: number;
  completionPercent: number;
  roundsCompleted: number;
  maxAutoRounds: number;
  elapsedMs: number;
  /** Average milliseconds per completed work item. */
  avgStepMs: number;
  /** Estimated time remaining based on average step time. */
  estimatedRemainingMs: number;
  dryRun: boolean;
}

export interface SidebarSettingsSummary {
  defaultProvider: string;
  defaultModel: string;
  autoResumeOnStartup: boolean;
  heartbeatSeconds: number;
  allowTerminal: boolean;
  requireWriteApproval: boolean;
  useNativeChatParticipant: boolean;
  mcpConfigPath: string;
  autoRevealOnActivation: boolean;
  defaultTab: string;
  /** Workspace `myAi.missions.blueprintMode` — shown on Chat “Start mission” card. */
  missionBlueprintMode: boolean;
  /** Workspace `myAi.missions.preBlueprintClarification`. */
  missionPreBlueprintClarification: boolean;
  /** Workspace `myAi.missions.requireBlueprintApproval`. */
  missionRequireBlueprintApproval: boolean;
}

export interface SidebarToolSummary {
  builtinTools: string[];
  mcpToolCount: number;
  mcpSessionCount: number;
  recentToolEvents?: Array<{ missionId: string; missionTitle: string; ts: number; source: string; message: string; level: string }>;
}

export interface McpOnboardingSnapshot {
  status: "no_workspace" | "file_missing" | "invalid_json" | "no_servers" | "ready" | "bundled_sample_missing";
  configuredPath: string;
  resolvedAbsolutePath: string | null;
  canCreateStarter: boolean;
  hint: string;
  starterDestinationRelative: string | null;
}

export interface SidebarAgentStatus {
  role: string;
  todo: number;
  running: number;
  done: number;
  /** Obsolete / demoted items not counted as done. */
  skipped: number;
  blocked: number;
  provider?: string;
  model?: string;
}

export interface SidebarDiffHunkSummary {
  header: string;
  beforeStart: number;
  beforeEnd: number;
  afterStart: number;
  afterEnd: number;
  beforeLines: string[];
  afterLines: string[];
}

export interface SidebarApprovalSummary {
  missionId: string;
  missionTitle: string;
  approvalId: string;
  title: string;
  kind: string;
  createdAt: number;
  details: string;
  targetPath?: string;
  beforeText?: string;
  afterText?: string;
  hunkCount?: number;
  hunks?: SidebarDiffHunkSummary[];
}

export interface SidebarApprovalBundleSummary {
  id: string;
  missionId: string;
  missionTitle: string;
  title: string;
  status: string;
  approvalCount: number;
  kinds: string[];
  targetPaths: string[];
  createdAt: number;
  approvalIds: string[];
}

export interface SidebarAgentLiveItem {
  role: string;
  currentWork?: string;
  status: string;
  recentEvents: Array<{ ts: number; message: string; level: string; source?: string }>;
  recentToolEvents?: Array<{ ts: number; message: string; level: string; source: string }>;
}

export interface SidebarTimelineEntry {
  missionId: string;
  missionTitle: string;
  id: string;
  ts: number;
  level: string;
  source: string;
  message: string;
  /** When set (operator-action events with known durable wording), compact scan label for Timeline UI. */
  operatorActionHeadline?: string;
}

export interface ProviderCredentialStatus {
  id: string;
  needsApiKey: boolean;
  configured: boolean;
}

export interface ProviderHealthEntry {
  providerId: string;
  ok: boolean;
  message: string;
  latencyMs?: number;
  checkedAt: number;
}

/** Last successful model list fetch per provider (not re-fetched every 2s tick). */
export interface ProviderLiveModelEntry {
  /** Full normalized catalog (persisted + ranked order, newest/relevant-first). */
  models: string[];
  /** Bounded shortlist for the picker; subset of `models`, latest-first. */
  modelsDisplay: string[];
  source: "live" | "fallback" | "environment" | "unavailable" | "cache";
  hint?: string;
  at: number;
}

export interface SidebarSnapshot {
  providers: string[];
  defaultProvider: string;
  defaultModel: string;
  /** Effective model for `defaultProvider` after per-provider resolution. */
  resolvedDefaultModel: string;
  providerCredentialStatus: ProviderCredentialStatus[];
  providerModelPresets: Record<string, string[]>;
  /** Cached model ids from last Refresh models / Ollama refresh per provider. */
  providerLiveModelCatalog: Record<string, ProviderLiveModelEntry>;
  lastProviderTest?: { providerId: string; ok: boolean; message: string; at: number };
  /** Per-provider health status from last connection test or background check. */
  providerHealth: Record<string, ProviderHealthEntry>;
  /** Current workspace values for editable provider roots (non-secret). */
  providerBaseUrls: Record<string, string>;
  /** Resolved per-provider model defaults from settings (for Providers panel). */
  providerSavedModels: Record<string, string>;
  missions: Mission[];
  focusedMissionId?: string;
  focusedMission?: Mission;
  /** Inspector/focused-card hint: required-work settlement vs open vs blocked (host-derived). */
  focusedMissionRequiredWorkHint?: string;
  /** Inspector/focused-card hint: downstream reviewer/validator gating after implementer hard-stop. */
  focusedMissionDownstreamGatingHint?: string;
  /** Inspector/focused-card: implementer hardStopClass contract violation (malformed current data). */
  focusedMissionHardStopDataQualityHint?: string;
  /** Inspector/focused-card note: latest durable operator action outcome for focused mission. */
  focusedMissionLatestOperatorActionNote?: string;
  /** Inspector/focused-card: one-line lifecycle summary (focused mission only; host-derived). */
  focusedMissionLifecycleSummary?: string;
  /** Focused mission: event id → compact operator-action headline (inspector/console; host-derived). */
  focusedMissionOperatorActionHeadlines?: Record<string, string>;
  /** Mission-card hint: per-mission downstream-gating hard-stop summary for list rendering. */
  missionDownstreamGatingCardHints?: Record<string, string>;
  /** Visible list: mission id → compact latest mappable operator-action headline (non-focused cards; host-derived). */
  missionListLatestOperatorActionHeadlines?: Record<string, string>;
  /** Focused mission: compact report summary (files changed, error count, completion %). */
  focusedMissionReportSummary?: {
    filesModifiedCount: number;
    errorPatternCount: number;
    completionPercent: number;
    retriedItems: number;
  };
  /** Per-mission progress stats for dashboard rendering. */
  missionProgressStats?: Record<string, MissionProgressStats>;
  /** Focused mission: approved blueprint step progress (required steps only). */
  focusedMissionBlueprintProgress?: BlueprintProgress;
  globalMemoryRecent: Array<{ id: string; ts: number; kind: string; text: string }>;
  consoleLines: string[];
  agents: SidebarAgentStatus[];
  tools: SidebarToolSummary;
  settings: SidebarSettingsSummary;
  pendingApprovals: SidebarApprovalSummary[];
  approvalBundles: SidebarApprovalBundleSummary[];
  agentLive: SidebarAgentLiveItem[];
  timeline: SidebarTimelineEntry[];
  mcpOnboarding: McpOnboardingSnapshot;
  missionList: {
    includeArchived: boolean;
    totalCount: number;
    archivedCount: number;
  };
  /** Correlates host + webview trace rows for this sidebar session. */
  traceSessionId: string;
  /** Monotonic publish id; webview ignores lower values to avoid stale UI. Set only when posting init/snapshot. */
  snapshotPublishSeq?: number;
  /** Host `dashboardRefreshSeq` for the cycle that produced this snapshot (0 on init-only posts). */
  sourceRefreshSeq?: number;
  /**
   * When `"mission"`, webview may skip re-rendering chat/providers/settings panels while those tabs are inactive
   * (still reconciled on the next full snapshot). Omitted after full `buildSnapshot` or settings/provider chrome posts.
   */
  fastRefreshKind?: "mission";
  /** Built-in routing presets → default per-role maps (for sidebar Routing tab). */
  routingPresetTemplates: Record<string, { providerPerRole: Record<string, string>; modelPerRole: Record<string, string> }>;
}

export type UiToExtMessage =
  | { type: "ready" }
  | { type: "sendChat"; prompt: string; providerId?: string; model?: string }
  | { type: "clearChatHistory" }
  | { type: "startMission"; title: string; prompt: string; providerId?: string; model?: string }
  | { type: "resumeMission"; missionId: string }
  | { type: "abortMissionLlm"; missionId: string }
  | { type: "refreshDashboard"; interactionId?: string }
  | { type: "focusMission"; missionId: string; interactionId?: string }
  | { type: "setMissionListIncludeArchived"; includeArchived: boolean; interactionId?: string }
  | { type: "traceEvent"; payload: unknown }
  | { type: "requestTraceLog" }
  | { type: "clearTraceLogFromUi" }
  | { type: "exportTraceLogFromUi" }
  | { type: "setTraceLevelFromUi"; level: TraceLevel }
  | { type: "openTraceOutputChannel" }
  | { type: "archiveMission"; missionId: string; interactionId?: string }
  | { type: "unarchiveMission"; missionId: string; interactionId?: string }
  | { type: "deleteMission"; missionId: string; interactionId?: string }
  | { type: "bulkArchiveCompletedMissions"; interactionId?: string }
  | { type: "bulkDeleteFailedTestMissions"; interactionId?: string }
  | { type: "bulkDeleteBlockedTestMissions"; interactionId?: string }
  /** Webview sends ids from the current filtered visible list; host re-validates each row. */
  | { type: "bulkArchiveVisibleCompletedMissions"; missionIds: string[]; interactionId?: string }
  | { type: "bulkDeleteVisibleFailedOrCancelledMissions"; missionIds: string[]; interactionId?: string }
  | { type: "bulkDeleteVisibleBlockedMissions"; missionIds: string[]; interactionId?: string }
  | { type: "approve"; missionId: string; approvalId: string; interactionId?: string }
  | { type: "reject"; missionId: string; approvalId: string; interactionId?: string }
  | { type: "editMissionPolicy"; missionId: string }
  | { type: "editAgentRouting"; missionId: string }
  | { type: "editMissionDag"; missionId: string }
  | { type: "reviewBundleSummary"; missionId: string }
  | { type: "approveBundle"; bundleId: string; interactionId?: string }
  | { type: "rejectBundle"; bundleId: string; interactionId?: string }
  | { type: "reviewPendingDiff"; missionId: string; approvalId?: string }
  | { type: "reviewPendingHunks"; missionId: string; approvalId?: string }
  | { type: "openTerminal" }
  | { type: "openSettings" }
  | { type: "listMcpTools" }
  | { type: "listMcpSessions" }
  | { type: "openMcpConfig" }
  | { type: "openAgentCapabilitiesDoc" }
  | { type: "openMissionAutonomyBlueprint" }
  | { type: "approveMissionBlueprint"; missionId: string }
  | { type: "rejectMissionBlueprint"; missionId: string }
  | { type: "requestMissionBlueprintRevision"; missionId: string; note: string }
  | { type: "submitPreBlueprintAnswers"; missionId: string; answers: string }
  | { type: "exportMissionBlueprint"; missionId: string }
  | { type: "copyMissionBlueprint"; missionId: string }
  | { type: "applyLazyDiscoveryPreset" }
  | { type: "revertLazyDiscoveryPreset" }
  | { type: "searchGlobalMemory"; query: string }
  | { type: "generateMissionReport"; missionId: string }
  | { type: "saveQuickSettings"; defaultProvider: string; defaultModel: string; heartbeatSeconds: number; allowTerminal: boolean; requireWriteApproval: boolean; autoRevealOnActivation: boolean; defaultTab: string }
  | { type: "saveProviderCredential"; providerId: string; apiKey: string }
  | { type: "clearProviderCredential"; providerId: string }
  | { type: "saveProviderBaseUrl"; providerId: string; baseUrl: string }
  | { type: "saveProviderModelDefault"; providerId: string; model: string }
  | { type: "applyDefaultProviderAndModel"; defaultProvider: string; defaultModel: string }
  | { type: "testProviderConnection"; providerId: string }
  | { type: "refreshOllamaModels" }
  | { type: "refreshProviderModels"; providerId: string }
  | { type: "createStarterMcpConfig" }
  | {
      type: "saveMissionRouting";
      missionId: string;
      activeProviderId: string;
      activeModel: string;
      preset: "default" | "research_heavy" | "local_first" | "review_strict" | "custom";
      roles: Array<{ role: AgentRole; providerId: string; model: string }>;
    }

export type SnapshotSectionId = "missions" | "auxiliary" | "providerChrome" | "globalMemory";

export type TraceMessageContext = {
  interactionId?: string;
  snapshotPublishSeq?: number;
  sourceRefreshSeq?: number;
  /** `snapshotSection`: monotonic per-section generation on host. */
  sectionSeq?: number;
  /** `snapshotPublishSeq` of the full snapshot this section was merged from (stale if UI has newer full publish). */
  sectionBasePublishSeq?: number;
  /** Which `snapshotSection` the trace row refers to. */
  section?: SnapshotSectionId;
};

export type ExtToUiMessage =
  | { type: "init"; snapshot: SidebarSnapshot; traceContext?: TraceMessageContext }
  | { type: "snapshot"; snapshot: SidebarSnapshot; traceContext?: TraceMessageContext }
  | {
      type: "snapshotSection";
      section: SnapshotSectionId;
      snapshot: SidebarSnapshot;
      sectionSeq: number;
      sectionBasePublishSeq: number;
      traceContext?: TraceMessageContext;
    }
  | { type: "chatChunk"; text: string }
  | { type: "chatDone" }
  | { type: "agentStreamChunk"; missionId: string; workItemId: string; role: string; text: string }
  | { type: "agentStreamDone"; missionId: string; workItemId: string }
  | { type: "memorySearchResults"; query: string; results: Array<{ id: string; ts: number; kind: string; text: string }> }
  | { type: "info"; message: string }
  | { type: "error"; message: string }
  | { type: "providerKeyCleared"; providerId: string }
  | { type: "formCommitted"; scope: "quickSettings" | "providersPanel" | "routingPanel" }
  | {
      type: "traceLogSnapshot";
      entries: TraceRecord[];
      traceLevel: TraceLevel;
      totalBuffered: number;
      /** Max rows the UI may request for display; host may send fewer in `entries`. */
      traceUiTailMax?: number;
      /** True when `entries` is a tail slice of the host buffer. */
      traceUiTruncated?: boolean;
    }
  | { type: "traceExportResult"; path: string }
  | { type: "missionReportReady"; missionId: string; markdown: string };
