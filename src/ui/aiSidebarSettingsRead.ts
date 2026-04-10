import * as vscode from "vscode";
import {
  clampMissionHeartbeatSeconds,
  clampTraceAutoRefreshIntervalMs,
  MISSION_HEARTBEAT_SECONDS_DEFAULT,
  TRACE_AUTO_REFRESH_INTERVAL_MS_DEFAULT
} from "../config/myAiSettingBounds";
import type { ProviderRegistry } from "../providers/ProviderRegistry";
import { baseUrlSettingKey, defaultBaseUrl } from "../providers/providerCredentialKeys";
import { modelsConfigKeyForProvider, resolveModelForProvider } from "../providers/providerModelResolution";
import { blueprintStructuredFlowEnabled, normalizeBlueprintModeSetting } from "../missions/missionBlueprintMode";
import type { SidebarSnapshot } from "./protocol";

/**
 * VS Code configuration section string for each field in `SidebarSnapshot.settings`.
 * Single source of truth for `cfg.get(...)` in `readSidebarWorkspaceSettings` — add a property here and wire it in that function.
 */
export const MYAI_SIDEBAR_SNAPSHOT_SETTINGS_KEYS = {
  defaultProvider: "myAi.defaultProvider",
  defaultModel: "myAi.defaultModel",
  autoResumeOnStartup: "myAi.missions.autoResumeOnStartup",
  heartbeatSeconds: "myAi.missions.heartbeatSeconds",
  maxStepsPerRun: "myAi.missions.maxStepsPerRun",
  unlimitedStepsPerRun: "myAi.missions.unlimitedStepsPerRun",
  allowTerminal: "myAi.tools.allowTerminal",
  requireWriteApproval: "myAi.tools.requireApprovalForWrite",
  requireApprovalForNonImplementerMutations: "myAi.tools.requireApprovalForNonImplementerMutations",
  autoApproveAllToolRequests: "myAi.tools.autoApproveAllToolRequests",
  useNativeChatParticipant: "myAi.useNativeChatParticipant",
  mcpConfigPath: "myAi.mcp.configPath",
  autoRevealOnActivation: "myAi.ui.autoRevealOnActivation",
  defaultTab: "myAi.ui.defaultTab",
  missionBlueprintMode: "myAi.missions.blueprintMode",
  missionPreBlueprintClarification: "myAi.missions.preBlueprintClarification",
  missionRequireBlueprintApproval: "myAi.missions.requireBlueprintApproval",
  traceAutoRefreshIntervalMs: "myAi.ui.traceAutoRefreshIntervalMs",
  autonomyMode: "myAi.missions.autonomy.mode",
  autonomyBlueprintPlanning: "myAi.missions.autonomy.blueprintPlanning",
  autonomyAutoContinuePasses: "myAi.missions.autonomy.autoContinuePasses",
  autonomyMaxAutonomousStepCapChains: "myAi.missions.autonomy.maxAutonomousStepCapChains",
  autonomyAutoApproveWorkspaceWrites: "myAi.missions.autonomy.autoApproveWorkspaceWrites",
  autonomyAutoApproveWorkspaceDeletes: "myAi.missions.autonomy.autoApproveWorkspaceDeletes",
  autonomyAutoApproveWorkspaceSafeCommands: "myAi.missions.autonomy.autoApproveWorkspaceSafeCommands",
  autonomyRequireApprovalForProtectedPaths: "myAi.missions.autonomy.requireApprovalForProtectedPaths",
  autonomyProtectedPathGlobs: "myAi.missions.autonomy.protectedPathGlobs",
  autonomyBlockedPathGlobs: "myAi.missions.autonomy.blockedPathGlobs",
  autonomyExtensionCoreMutationPolicy: "myAi.missions.autonomy.extensionCoreMutationPolicy",
  toolRecoveryAutonomyPreset: "myAi.missions.toolRecoveryAutonomyPreset",
  retryBudgetMaxRunCommandRecovery: "myAi.missions.maxRunCommandRecoveryAttemptsPerWorkItem",
  retryBudgetMaxWriteFileRecovery: "myAi.missions.maxWriteFileRecoveryAttemptsPerWorkItem",
  retryBudgetMaxApplyPatchRecovery: "myAi.missions.maxApplyPatchRecoveryAttemptsPerWorkItem",
  retryBudgetMaxTransientMutating: "myAi.missions.maxTransientMutatingFailuresPerWorkItem",
  retryBudgetMaxToolFollowUpTurns: "myAi.missions.maxToolFollowUpTurns"
} as const;

/** Flat list for `ConfigurationChangeEvent.affectsConfiguration` checks. */
export const SIDEBAR_SNAPSHOT_SETTINGS_CONFIG_KEYS: readonly string[] = Object.values(MYAI_SIDEBAR_SNAPSHOT_SETTINGS_KEYS);

export function configurationAffectsSidebarSnapshotSettings(e: vscode.ConfigurationChangeEvent): boolean {
  if (!e.affectsConfiguration("myAi")) return false;
  return SIDEBAR_SNAPSHOT_SETTINGS_CONFIG_KEYS.some((k) => e.affectsConfiguration(k));
}

function readStringArraySetting(cfg: vscode.WorkspaceConfiguration, key: string, fallback: string[]): string[] {
  const raw = cfg.get<unknown>(key, fallback);
  if (!Array.isArray(raw)) return fallback;
  return raw.map((x) => String(x)).filter((s) => s.trim().length > 0);
}

export function readSidebarWorkspaceSettings(): SidebarSnapshot["settings"] & {
  defaultProvider: string;
  defaultModel: string;
} {
  const cfg = vscode.workspace.getConfiguration();
  const K = MYAI_SIDEBAR_SNAPSHOT_SETTINGS_KEYS;
  const blueprintEnum = normalizeBlueprintModeSetting(cfg.get(K.missionBlueprintMode, "off"));
  return {
    defaultProvider: cfg.get<string>(K.defaultProvider, "ollama"),
    defaultModel: cfg.get<string>(K.defaultModel, "llama3.1"),
    autoResumeOnStartup: cfg.get<boolean>(K.autoResumeOnStartup, true),
    heartbeatSeconds: (() => {
      const raw = cfg.get<number>(K.heartbeatSeconds, MISSION_HEARTBEAT_SECONDS_DEFAULT);
      return clampMissionHeartbeatSeconds(Number.isFinite(raw) ? raw : MISSION_HEARTBEAT_SECONDS_DEFAULT);
    })(),
    maxStepsPerRun: Math.max(1, Math.min(2000, Math.floor(cfg.get<number>(K.maxStepsPerRun, 128) || 128))),
    unlimitedStepsPerRun: cfg.get<boolean>(K.unlimitedStepsPerRun, false),
    allowTerminal: cfg.get<boolean>(K.allowTerminal, false),
    requireWriteApproval: cfg.get<boolean>(K.requireWriteApproval, true),
    requireApprovalForNonImplementerMutations: cfg.get<boolean>(K.requireApprovalForNonImplementerMutations, true),
    autoApproveAllToolRequests: cfg.get<boolean>(K.autoApproveAllToolRequests, false),
    useNativeChatParticipant: cfg.get<boolean>(K.useNativeChatParticipant, false),
    mcpConfigPath: cfg.get<string>(K.mcpConfigPath, "examples/mcp.sample.json"),
    autoRevealOnActivation: cfg.get<boolean>(K.autoRevealOnActivation, false),
    defaultTab: cfg.get<string>(K.defaultTab, "chat"),
    missionBlueprintModeEnum: blueprintEnum,
    missionBlueprintMode: blueprintStructuredFlowEnabled(blueprintEnum),
    missionPreBlueprintClarification: cfg.get<boolean>(K.missionPreBlueprintClarification, false),
    missionRequireBlueprintApproval: cfg.get<boolean>(K.missionRequireBlueprintApproval, true),
    traceAutoRefreshIntervalMs: (() => {
      const raw = cfg.get<number>(K.traceAutoRefreshIntervalMs, TRACE_AUTO_REFRESH_INTERVAL_MS_DEFAULT);
      return clampTraceAutoRefreshIntervalMs(Number.isFinite(raw) ? raw : TRACE_AUTO_REFRESH_INTERVAL_MS_DEFAULT);
    })(),
    autonomyMode: cfg.get<string>(K.autonomyMode, "workspace_autonomous"),
    autonomyBlueprintPlanning: cfg.get<string>(K.autonomyBlueprintPlanning, "off"),
    autonomyAutoContinuePasses: cfg.get<boolean>(K.autonomyAutoContinuePasses, true),
    autonomyMaxAutonomousStepCapChains: Math.max(
      1,
      Math.min(50_000, Math.floor(cfg.get<number>(K.autonomyMaxAutonomousStepCapChains, 2000) || 2000))
    ),
    autonomyAutoApproveWorkspaceWrites: cfg.get<boolean>(K.autonomyAutoApproveWorkspaceWrites, true),
    autonomyAutoApproveWorkspaceDeletes: cfg.get<boolean>(K.autonomyAutoApproveWorkspaceDeletes, true),
    autonomyAutoApproveWorkspaceSafeCommands: cfg.get<boolean>(K.autonomyAutoApproveWorkspaceSafeCommands, true),
    autonomyRequireApprovalForProtectedPaths: cfg.get<boolean>(K.autonomyRequireApprovalForProtectedPaths, true),
    autonomyProtectedPathGlobs: readStringArraySetting(cfg, K.autonomyProtectedPathGlobs, []),
    autonomyBlockedPathGlobs: readStringArraySetting(cfg, K.autonomyBlockedPathGlobs, []),
    autonomyExtensionCoreMutationPolicy: cfg.get<string>(K.autonomyExtensionCoreMutationPolicy, "require_approval"),
    toolRecoveryAutonomyPreset: cfg.get<string>(K.toolRecoveryAutonomyPreset, "standard"),
    retryBudgetMaxRunCommandRecovery: Math.max(
      0,
      Math.floor(cfg.get<number>(K.retryBudgetMaxRunCommandRecovery, 12) ?? 12)
    ),
    retryBudgetMaxWriteFileRecovery: Math.max(
      0,
      Math.floor(cfg.get<number>(K.retryBudgetMaxWriteFileRecovery, 12) ?? 12)
    ),
    retryBudgetMaxApplyPatchRecovery: Math.max(
      0,
      Math.floor(cfg.get<number>(K.retryBudgetMaxApplyPatchRecovery, 12) ?? 12)
    ),
    retryBudgetMaxTransientMutating: Math.max(
      0,
      Math.floor(cfg.get<number>(K.retryBudgetMaxTransientMutating, 4) ?? 4)
    ),
    retryBudgetMaxToolFollowUpTurns: Math.max(
      0,
      Math.floor(cfg.get<number>(K.retryBudgetMaxToolFollowUpTurns, 10) ?? 10)
    )
  };
}

export function readProviderBaseUrls(providers: ProviderRegistry): Record<string, string> {
  const cfg = vscode.workspace.getConfiguration();
  const out: Record<string, string> = {};
  for (const id of providers.list()) {
    const k = baseUrlSettingKey(id);
    if (k) out[id] = cfg.get<string>(k, defaultBaseUrl(id) || "");
  }
  return out;
}

export function readProviderSavedModels(providers: ProviderRegistry): Record<string, string> {
  const cfg = vscode.workspace.getConfiguration();
  const out: Record<string, string> = {};
  for (const id of providers.list()) {
    const k = modelsConfigKeyForProvider(id);
    out[id] = k
      ? resolveModelForProvider(id, cfg.get<string>(k, ""), (x, y) => cfg.get(x, y))
      : resolveModelForProvider(id, undefined, (x, y) => cfg.get(x, y));
  }
  return out;
}
