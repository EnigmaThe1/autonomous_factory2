import * as vscode from "vscode";
import { resolveProviderIdForWorkItem } from "./missionRouting";
import type { Mission, WorkItem } from "../types";

/**
 * Provider ids (e.g. `ollama`) that mean “LLM runs on this machine — no token bill from us.”
 * Used to relax **extension-side** web research throttles (call caps, search cooldown), not your electricity bill.
 *
 * Resolution order for “which provider is this step using?”:
 * `workItem.providerId` → `mission.routing.providerPerRole[workItem.role]` → `mission.activeProviderId`.
 * So mixed routing (e.g. planner=anthropic, implementer=ollama) is respected when the tool call is attributed (`__workItemId`).
 */
export function parseLocalLlmProviderIds(cfg: vscode.WorkspaceConfiguration): Set<string> {
  const raw = String(cfg.get<string>("myAi.webResearch.localLlmProviderIds", "ollama") || "ollama");
  const parts = raw
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return new Set(parts.length ? parts : ["ollama"]);
}

/** True when the resolved provider for this work item (or mission default) is treated as local LLM economy. */
export function missionUsesLocalLlmEconomy(
  mission: Mission | undefined,
  cfg: vscode.WorkspaceConfiguration,
  workItem?: WorkItem
): boolean {
  if (!mission) return false;
  if (!cfg.get<boolean>("myAi.webResearch.unlimitedBudgetForLocalLlm", true)) return false;
  const pid = resolveProviderIdForWorkItem(mission, workItem);
  if (!pid) return false;
  return parseLocalLlmProviderIds(cfg).has(pid);
}

/** @deprecated Use {@link missionUsesLocalLlmEconomy} — same behavior, clearer name. */
export function missionUsesLocalLlmForWebBudget(
  mission: Mission | undefined,
  cfg: vscode.WorkspaceConfiguration,
  workItem?: WorkItem
): boolean {
  return missionUsesLocalLlmEconomy(mission, cfg, workItem);
}

/**
 * Effective max successful webSearch/fetchWebPage calls per mission (0 = unlimited).
 */
export function effectiveWebResearchMaxCallsPerMission(
  mission: Mission | undefined,
  cfg: vscode.WorkspaceConfiguration,
  workItem?: WorkItem
): number {
  const configured = Math.max(0, cfg.get<number>("myAi.webResearch.maxCallsPerMission", 0));
  if (configured === 0) return 0;
  if (missionUsesLocalLlmEconomy(mission, cfg, workItem)) return 0;
  return configured;
}

/**
 * `myAi.webSearch.minIntervalMs` is for fair use / shared APIs. Local-LLM economy for this work item skips it.
 */
export function effectiveWebSearchMinIntervalMs(
  mission: Mission | undefined,
  cfg: vscode.WorkspaceConfiguration,
  workItem?: WorkItem
): number {
  const raw = Math.max(0, cfg.get<number>("myAi.webSearch.minIntervalMs", 0));
  if (missionUsesLocalLlmEconomy(mission, cfg, workItem)) return 0;
  return raw;
}
