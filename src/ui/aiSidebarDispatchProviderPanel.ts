import * as vscode from "vscode";
import { testProviderConnection } from "../providers/testProviderConnection";
import { baseUrlSettingKey, secretKeyForProvider } from "../providers/providerCredentialKeys";
import { modelsConfigKeyForProvider } from "../providers/providerModelResolution";
import { readSidebarWorkspaceSettings } from "./aiSidebarSettingsRead";
import type { UiToExtMessage } from "./protocol";
import type { AiSidebarUiDispatchHost } from "./aiSidebarUiDispatchHost";

export async function dispatchUi_saveQuickSettings(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "saveQuickSettings" }>,
  msgInteractionId: string | undefined
): Promise<boolean> {
  const before = host.getLastPostedSnapshot();
  await host.saveQuickSettings(msg);
  await host.postProviderSettingsChromeSectionImmediate(msgInteractionId, "refresh_dashboard_settings_chrome_section_post", {
    defaultProvider: readSidebarWorkspaceSettings().defaultProvider
  });
  if (before && host.getLastPostedSnapshot()) {
    const after = host.getLastPostedSnapshot()!;
    if (
      after.defaultProvider !== before.defaultProvider ||
      after.defaultModel !== before.defaultModel ||
      after.resolvedDefaultModel !== before.resolvedDefaultModel
    ) {
      host.postMissionDashboardSnapshotImmediate(msgInteractionId);
    }
  }
  host.postMessage({ type: "info", message: "Quick settings saved." });
  host.postMessage({ type: "formCommitted", scope: "quickSettings" });
  return true;
}

export async function dispatchUi_saveProviderCredential(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "saveProviderCredential" }>,
  msgInteractionId: string | undefined
): Promise<boolean> {
  const key = secretKeyForProvider(msg.providerId);
  if (!key) throw new Error(`Provider "${msg.providerId}" does not use an API key.`);
  const v = msg.apiKey.trim();
  if (!v) throw new Error("API key is empty.");
  host.invalidateProviderCredentialCache(msg.providerId);
  await host.secrets.set(key, v);
  await host.postProviderSettingsChromeSectionImmediate(msgInteractionId, "refresh_dashboard_provider_cred_section_post", {
    providerId: msg.providerId
  });
  host.postMessage({ type: "providerKeyCleared", providerId: msg.providerId });
  host.postMessage({ type: "info", message: "API key saved securely." });
  return true;
}

export async function dispatchUi_clearProviderCredential(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "clearProviderCredential" }>,
  msgInteractionId: string | undefined
): Promise<boolean> {
  const ck = secretKeyForProvider(msg.providerId);
  if (!ck) throw new Error(`Provider "${msg.providerId}" has no stored API key to clear.`);
  host.invalidateProviderCredentialCache(msg.providerId);
  await host.secrets.delete(ck);
  await host.postProviderSettingsChromeSectionImmediate(msgInteractionId, "refresh_dashboard_provider_cred_section_post", {
    providerId: msg.providerId
  });
  host.postMessage({ type: "info", message: `Cleared API key for ${msg.providerId}.` });
  return true;
}

export async function dispatchUi_saveProviderBaseUrl(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "saveProviderBaseUrl" }>,
  msgInteractionId: string | undefined
): Promise<boolean> {
  const bk = baseUrlSettingKey(msg.providerId);
  if (!bk) throw new Error(`No base URL setting for provider "${msg.providerId}".`);
  await vscode.workspace.getConfiguration().update(bk, msg.baseUrl.trim(), vscode.ConfigurationTarget.Workspace);
  await host.postProviderSettingsChromeSectionImmediate(msgInteractionId, "refresh_dashboard_provider_chrome_section_post", {
    providerId: msg.providerId,
    field: "baseUrl"
  });
  host.postMessage({ type: "info", message: "Base URL saved." });
  host.postMessage({ type: "formCommitted", scope: "providersPanel" });
  return true;
}

export async function dispatchUi_saveProviderModelDefault(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "saveProviderModelDefault" }>,
  msgInteractionId: string | undefined
): Promise<boolean> {
  const mk = modelsConfigKeyForProvider(msg.providerId);
  if (!mk) throw new Error(`No per-provider model setting for "${msg.providerId}".`);
  await vscode.workspace.getConfiguration().update(mk, msg.model.trim(), vscode.ConfigurationTarget.Workspace);
  await host.postProviderSettingsChromeSectionImmediate(msgInteractionId, "refresh_dashboard_provider_chrome_section_post", {
    providerId: msg.providerId,
    field: "modelDefault"
  });
  host.postMessage({ type: "info", message: "Model default saved for provider." });
  host.postMessage({ type: "formCommitted", scope: "providersPanel" });
  return true;
}

export async function dispatchUi_applyDefaultProviderAndModel(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "applyDefaultProviderAndModel" }>,
  msgInteractionId: string | undefined
): Promise<boolean> {
  const target = vscode.ConfigurationTarget.Workspace;
  const cfg = vscode.workspace.getConfiguration();
  await cfg.update("myAi.defaultProvider", msg.defaultProvider, target);
  await cfg.update("myAi.defaultModel", msg.defaultModel, target);
  const pk = modelsConfigKeyForProvider(msg.defaultProvider);
  if (pk) await cfg.update(pk, msg.defaultModel, target);
  await host.postProviderSettingsChromeSectionImmediate(msgInteractionId, "refresh_dashboard_provider_chrome_section_post", {
    applyDefault: true
  });
  host.postMissionDashboardSnapshotImmediate(msgInteractionId);
  host.postMessage({ type: "info", message: "Default provider and model applied." });
  host.postMessage({ type: "formCommitted", scope: "providersPanel" });
  return true;
}

export async function dispatchUi_testProviderConnection(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "testProviderConnection" }>,
  msgInteractionId: string | undefined
): Promise<boolean> {
  const t0 = Date.now();
  const result = await testProviderConnection(host.secrets, host.providers, msg.providerId);
  const latencyMs = Date.now() - t0;
  host.setLastProviderTest({ providerId: msg.providerId, ok: result.ok, message: result.message, at: Date.now(), latencyMs });
  host.bumpProviderChromeSyncGeneration("provider_test_result");
  await host.postProviderSettingsChromeSectionImmediate(msgInteractionId, "refresh_dashboard_provider_chrome_section_post", {
    providerId: msg.providerId,
    test: true
  });
  host.postMessage({ type: "info", message: `${result.ok ? "OK" : "Failed"} (${msg.providerId}): ${result.message}` });
  return true;
}

export async function dispatchUi_refreshOllamaModels(host: AiSidebarUiDispatchHost): Promise<boolean> {
  await host.refreshProviderModelCatalog("ollama");
  return true;
}

export async function dispatchUi_refreshProviderModels(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "refreshProviderModels" }>
): Promise<boolean> {
  await host.refreshProviderModelCatalog(msg.providerId);
  return true;
}
