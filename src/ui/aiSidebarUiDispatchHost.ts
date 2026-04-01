import type * as vscode from "vscode";
import type { ExtensionTraceLogger } from "../diagnostics/ExtensionTraceLogger";
import type { DashboardRefreshSource } from "../diagnostics/dashboardRefreshSource";
import type { MissionOrchestrator } from "../missions/MissionOrchestrator";
import type { MissionStore } from "../missions/MissionStore";
import type { GlobalMemoryStore } from "../memory/GlobalMemoryStore";
import type { ToolRegistry } from "../tools/ToolRegistry";
import type { McpRegistry } from "../tools/McpRegistry";
import type { SecretStore } from "../storage/SecretStore";
import type { ProviderRegistry } from "../providers/ProviderRegistry";
import type { WorkspacePaths } from "../storage/WorkspacePaths";
import type { McpOnboardingState } from "../tools/mcpStarterConfig";
import type { ExtToUiMessage, SidebarSnapshot, UiToExtMessage } from "./protocol";

/**
 * Facade passed into Wave 3 UI message dispatch modules; state and effectful APIs stay on `AiSidebarProvider`.
 */
export type AiSidebarUiDispatchHost = {
  extensionUri: vscode.Uri;
  paths: WorkspacePaths;
  providers: ProviderRegistry;
  missionStore: MissionStore;
  orchestrator: MissionOrchestrator;
  globalMemory: GlobalMemoryStore;
  tools: ToolRegistry;
  mcp: McpRegistry;
  secrets: SecretStore;
  traceLogger: ExtensionTraceLogger;
  workspaceState: vscode.Memento;

  getRefreshQueue(): Promise<void>;
  setRefreshQueue(p: Promise<void>): void;

  buildSnapshot(): Promise<SidebarSnapshot>;
  sealSnapshotForPost(snapshot: SidebarSnapshot, sourceRefreshSeq: number): SidebarSnapshot;
  materialFingerprintFromSnapshot(snapshot: SidebarSnapshot): string;
  getLastPublishedFullMaterialFp(): string | undefined;
  setLastPublishedFullMaterialFp(v: string | undefined): void;
  getLastFullRefreshCycleMeta(): { materialFp: string; source: DashboardRefreshSource } | undefined;
  setLastFullRefreshCycleMeta(v: { materialFp: string; source: DashboardRefreshSource } | undefined): void;

  postMessage(message: ExtToUiMessage, opts?: { interactionId?: string }): void;

  handleChat(prompt: string, providerId?: string, model?: string): Promise<void>;
  clearChatHistory(): void;
  scheduleBackgroundDashboardReconciliation(): void;
  focusMission(id: string, interactionId?: string): void;
  postMissionDashboardSnapshotImmediate(interactionId?: string): void;

  getIncludeArchivedMissions(): boolean;
  setIncludeArchivedMissions(v: boolean): void;
  getFocusedMissionId(): string | undefined;
  setFocusedMissionId(v: string | undefined): void;

  getLastPostedSnapshot(): SidebarSnapshot | undefined;

  saveQuickSettings(msg: Extract<UiToExtMessage, { type: "saveQuickSettings" }>): Promise<void>;
  postProviderSettingsChromeSectionImmediate(
    interactionId: string | undefined,
    traceEvent: string,
    extraTrace?: Record<string, unknown>
  ): Promise<void>;

  invalidateMcpToolsSessionsCache(): void;
  scheduleAuxiliarySectionAfterMcpMutation(): void;
  setMcpOnboardingCache(v: { resolvedPath: string; at: number; state: McpOnboardingState } | undefined): void;

  invalidateProviderCredentialCache(providerId: string): void;
  setLastProviderTest(v: { providerId: string; ok: boolean; message: string; at: number; latencyMs?: number } | undefined): void;
  bumpProviderChromeSyncGeneration(reason: string): void;

  refreshProviderModelCatalog(providerId: string): Promise<void>;

  resolveBundle(bundleId: string, approved: boolean, interactionId?: string): Promise<void>;
  reviewPendingDiff(missionId: string, approvalId?: string): Promise<void>;
  reviewPendingHunks(missionId: string, approvalId?: string): Promise<void>;

  refreshDashboard(interactionId?: string, options?: { source?: DashboardRefreshSource }): Promise<void>;
};
