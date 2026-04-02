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
  allowTerminal: "myAi.tools.allowTerminal",
  requireWriteApproval: "myAi.tools.requireApprovalForWrite",
  useNativeChatParticipant: "myAi.useNativeChatParticipant",
  mcpConfigPath: "myAi.mcp.configPath",
  autoRevealOnActivation: "myAi.ui.autoRevealOnActivation",
  defaultTab: "myAi.ui.defaultTab",
  missionBlueprintMode: "myAi.missions.blueprintMode",
  missionPreBlueprintClarification: "myAi.missions.preBlueprintClarification",
  missionRequireBlueprintApproval: "myAi.missions.requireBlueprintApproval",
  traceAutoRefreshIntervalMs: "myAi.ui.traceAutoRefreshIntervalMs"
} as const;

/** Flat list for `ConfigurationChangeEvent.affectsConfiguration` checks. */
export const SIDEBAR_SNAPSHOT_SETTINGS_CONFIG_KEYS: readonly string[] = Object.values(MYAI_SIDEBAR_SNAPSHOT_SETTINGS_KEYS);

export function configurationAffectsSidebarSnapshotSettings(e: vscode.ConfigurationChangeEvent): boolean {
  if (!e.affectsConfiguration("myAi")) return false;
  return SIDEBAR_SNAPSHOT_SETTINGS_CONFIG_KEYS.some((k) => e.affectsConfiguration(k));
}

export function readSidebarWorkspaceSettings(): SidebarSnapshot["settings"] & {
  defaultProvider: string;
  defaultModel: string;
} {
  const cfg = vscode.workspace.getConfiguration();
  const K = MYAI_SIDEBAR_SNAPSHOT_SETTINGS_KEYS;
  return {
    defaultProvider: cfg.get<string>(K.defaultProvider, "ollama"),
    defaultModel: cfg.get<string>(K.defaultModel, "llama3.1"),
    autoResumeOnStartup: cfg.get<boolean>(K.autoResumeOnStartup, true),
    heartbeatSeconds: (() => {
      const raw = cfg.get<number>(K.heartbeatSeconds, MISSION_HEARTBEAT_SECONDS_DEFAULT);
      return clampMissionHeartbeatSeconds(Number.isFinite(raw) ? raw : MISSION_HEARTBEAT_SECONDS_DEFAULT);
    })(),
    allowTerminal: cfg.get<boolean>(K.allowTerminal, false),
    requireWriteApproval: cfg.get<boolean>(K.requireWriteApproval, true),
    useNativeChatParticipant: cfg.get<boolean>(K.useNativeChatParticipant, false),
    mcpConfigPath: cfg.get<string>(K.mcpConfigPath, "examples/mcp.sample.json"),
    autoRevealOnActivation: cfg.get<boolean>(K.autoRevealOnActivation, false),
    defaultTab: cfg.get<string>(K.defaultTab, "chat"),
    missionBlueprintMode: cfg.get<boolean>(K.missionBlueprintMode, false),
    missionPreBlueprintClarification: cfg.get<boolean>(K.missionPreBlueprintClarification, false),
    missionRequireBlueprintApproval: cfg.get<boolean>(K.missionRequireBlueprintApproval, true),
    traceAutoRefreshIntervalMs: (() => {
      const raw = cfg.get<number>(K.traceAutoRefreshIntervalMs, TRACE_AUTO_REFRESH_INTERVAL_MS_DEFAULT);
      return clampTraceAutoRefreshIntervalMs(Number.isFinite(raw) ? raw : TRACE_AUTO_REFRESH_INTERVAL_MS_DEFAULT);
    })()
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
