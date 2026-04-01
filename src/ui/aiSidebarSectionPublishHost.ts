import type * as vscode from "vscode";
import type { GlobalMemoryStore } from "../memory/GlobalMemoryStore";
import type { MissionStore } from "../missions/MissionStore";
import type { ExtensionTraceLogger } from "../diagnostics/ExtensionTraceLogger";
import type { Mission } from "../types";
import type {
  ExtToUiMessage,
  SidebarAgentLiveItem,
  SidebarAgentStatus,
  SidebarApprovalBundleSummary,
  SidebarSnapshot
} from "./protocol";
import type { McpAuxiliaryWarmMaterializedSlice, McpAuxiliaryWarmRead } from "./aiSidebarMcpAuxiliaryTypes";

/** Mission-derived UI slices (from `AiSidebarProvider.computeMissionDerivedSlices`). */
export type MissionDerivedSlicesForSection = {
  pendingApprovals: SidebarSnapshot["pendingApprovals"];
  approvalBundles: SidebarApprovalBundleSummary[];
  timeline: SidebarSnapshot["timeline"];
  recentToolEvents: NonNullable<SidebarSnapshot["tools"]["recentToolEvents"]>;
};

/**
 * Host façade for sectional `snapshotSection` publishes: merges into `lastPostedSnapshot` and posts via
 * `postMessage` (which owns `lastPostedSnapshot` / stability baseline side effects).
 */
export type AiSidebarSectionPublishHost = {
  traceLogger: ExtensionTraceLogger;
  getWebviewView: () => vscode.WebviewView | undefined;
  getLastPostedSnapshot: () => SidebarSnapshot | undefined;

  missionStore: MissionStore;
  getIncludeArchivedMissions: () => boolean;
  resolveFocusedMission: (missions: Mission[]) => Mission | undefined;
  buildAgentStatus: (
    mission: Mission | undefined,
    defaultProvider: string,
    defaultModel: string
  ) => SidebarAgentStatus[];
  buildAgentLive: (mission: Mission | undefined) => SidebarAgentLiveItem[];
  computeMissionDerivedSlices: (
    missions: Mission[],
    allMissions: Mission[]
  ) => MissionDerivedSlicesForSection;

  getWorkspaceConfiguration: () => vscode.WorkspaceConfiguration;
  getTraceSessionId: () => string;

  bumpMissionsSectionSeq: () => number;
  bumpAuxiliarySectionSeq: () => number;
  bumpGlobalMemorySectionSeq: () => number;
  bumpProviderChromeSectionSeq: () => number;

  globalMemory: GlobalMemoryStore;
  globalMemoryHeadFingerprintFromStoreHead: () => string;

  readMcpAuxiliaryWarmCaches: (now: number) => McpAuxiliaryWarmRead | undefined;
  tryAuxiliaryFingerprintFromStableWarmPollCache: (
    warmProbe: McpAuxiliaryWarmRead | undefined
  ) => {
    fingerprint: string | undefined;
    sameTickWarmMaterializedSlice?: McpAuxiliaryWarmMaterializedSlice;
  };
  resolveMcpAuxiliarySlice: (
    resolveFor: "dashboard_section" | "build_snapshot",
    opts?: {
      reuseAuxiliaryWarmProbe: McpAuxiliaryWarmRead | undefined;
      reuseSameTickWarmSlice?: McpAuxiliaryWarmMaterializedSlice;
    }
  ) => Promise<{
    slice: McpAuxiliaryWarmMaterializedSlice;
    usedWarmCaches: boolean;
    sameTickWarmSliceReuse?: boolean;
  }>;

  resolveProviderSettingsChromeHostSlice: (
    resolveFor: "build_snapshot" | "provider_section"
  ) => Promise<{ slice: Partial<SidebarSnapshot>; usedWarmCredentialCache: boolean }>;

  postMessage: (message: ExtToUiMessage, traceOpts?: { interactionId?: string }) => void;
};
