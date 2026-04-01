import * as vscode from "vscode";
import type { ProviderRegistry } from "../providers/ProviderRegistry";
import { baseUrlSettingKey, defaultBaseUrl } from "../providers/providerCredentialKeys";
import { modelsConfigKeyForProvider, resolveModelForProvider } from "../providers/providerModelResolution";
import type { SidebarSnapshot } from "./protocol";

export function readSidebarWorkspaceSettings(): SidebarSnapshot["settings"] & {
  defaultProvider: string;
  defaultModel: string;
} {
  const cfg = vscode.workspace.getConfiguration();
  return {
    defaultProvider: cfg.get<string>("myAi.defaultProvider", "ollama"),
    defaultModel: cfg.get<string>("myAi.defaultModel", "llama3.1"),
    autoResumeOnStartup: cfg.get<boolean>("myAi.missions.autoResumeOnStartup", true),
    heartbeatSeconds: cfg.get<number>("myAi.missions.heartbeatSeconds", 8),
    allowTerminal: cfg.get<boolean>("myAi.tools.allowTerminal", false),
    requireWriteApproval: cfg.get<boolean>("myAi.tools.requireApprovalForWrite", true),
    useNativeChatParticipant: cfg.get<boolean>("myAi.useNativeChatParticipant", false),
    mcpConfigPath: cfg.get<string>("myAi.mcp.configPath", "examples/mcp.sample.json"),
    autoRevealOnActivation: cfg.get<boolean>("myAi.ui.autoRevealOnActivation", false),
    defaultTab: cfg.get<string>("myAi.ui.defaultTab", "chat")
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
