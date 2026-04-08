import * as vscode from "vscode";
import { AgentRole, MissionAgentRouting, type Mission, type WorkItem } from "../types";

export const ROUTING_ROLE_ORDER: AgentRole[] = [
  "planner",
  "researcher",
  "implementer",
  "reviewer",
  "validator",
  "architect"
];

/** Built-in mission-level preset maps (no workspace merge). */
const PRESET_FRAGMENTS: Record<string, Pick<MissionAgentRouting, "providerPerRole" | "modelPerRole">> = {
  default: { providerPerRole: {}, modelPerRole: {} },
  research_heavy: {
    providerPerRole: { researcher: "openai", planner: "openai", implementer: "ollama", reviewer: "openai", validator: "openai" },
    modelPerRole: {}
  },
  local_first: {
    providerPerRole: { planner: "ollama", researcher: "ollama", implementer: "ollama", reviewer: "ollama", validator: "ollama" },
    modelPerRole: {}
  },
  review_strict: {
    providerPerRole: { reviewer: "openai", validator: "openai" },
    modelPerRole: {}
  },
  custom: { providerPerRole: {}, modelPerRole: {} }
};

export function parseRoleMapString(raw: string): Partial<Record<AgentRole, string>> {
  const out: Partial<Record<AgentRole, string>> = {};
  for (const pair of raw.split(",").map((p) => p.trim()).filter(Boolean)) {
    const [lhs, rhs] = pair.split(":").map((x) => x.trim());
    if (!lhs || !rhs) continue;
    if (ROUTING_ROLE_ORDER.includes(lhs as AgentRole)) out[lhs as AgentRole] = rhs;
  }
  return out;
}

/** Preset + built-in per-role maps only (for GUI templates and documentation). */
export function presetRoutingFragment(preset: MissionAgentRouting["preset"] | undefined): MissionAgentRouting {
  const p = (preset || "default") as string;
  const frag = PRESET_FRAGMENTS[p] || PRESET_FRAGMENTS.default;
  return {
    preset: (preset || "default") as MissionAgentRouting["preset"],
    providerPerRole: { ...(frag.providerPerRole || {}) },
    modelPerRole: { ...(frag.modelPerRole || {}) }
  };
}

/**
 * One-time template for **new** missions: workspace routing preset + optional role maps from settings.
 * Becomes part of the mission JSON and is not re-read from workspace afterward.
 */
export function snapshotRoutingFromWorkspace(cfg: vscode.WorkspaceConfiguration): MissionAgentRouting {
  const preset = cfg.get<string>("myAi.agents.routingPreset", "default") as MissionAgentRouting["preset"];
  const fromPreset = presetRoutingFragment(preset);
  const providerFromSettings = parseRoleMapString(cfg.get<string>("myAi.agents.providerMap", ""));
  const modelFromSettings = parseRoleMapString(cfg.get<string>("myAi.agents.modelMap", ""));
  return {
    preset,
    providerPerRole: { ...fromPreset.providerPerRole, ...providerFromSettings },
    modelPerRole: { ...fromPreset.modelPerRole, ...modelFromSettings }
  };
}

/** Normalize persisted mission routing without merging live workspace settings. */
export function canonicalizeStoredRouting(r: MissionAgentRouting | undefined | null): MissionAgentRouting {
  if (!r) return { preset: "default", providerPerRole: {}, modelPerRole: {} };
  return {
    preset: r.preset || "default",
    providerPerRole: { ...(r.providerPerRole || {}) },
    modelPerRole: { ...(r.modelPerRole || {}) }
  };
}

/**
 * Provider id used to run a specific work item: work-item override, then `routing.providerPerRole[role]`,
 * then mission `activeProviderId`. Used for per-role cloud vs local (e.g. planner=anthropic, implementer=ollama).
 */
export function resolveProviderIdForWorkItem(mission: Mission, item: WorkItem | undefined): string {
  const fromItem = item?.providerId?.trim();
  if (fromItem) return fromItem.toLowerCase();
  const role = item?.role;
  if (role) {
    const fromRoute = mission.routing?.providerPerRole?.[role]?.trim();
    if (fromRoute) return fromRoute.toLowerCase();
  }
  return (mission.activeProviderId || "").trim().toLowerCase();
}

/** For webview: serializable preset → default maps (defaults only; no workspace). */
export function routingPresetTemplatesForUi(): Record<string, { providerPerRole: Record<string, string>; modelPerRole: Record<string, string> }> {
  const keys = ["default", "research_heavy", "local_first", "review_strict", "custom"] as const;
  const out: Record<string, { providerPerRole: Record<string, string>; modelPerRole: Record<string, string> }> = {};
  for (const k of keys) {
    const f = presetRoutingFragment(k);
    out[k] = {
      providerPerRole: { ...(f.providerPerRole as Record<string, string>) },
      modelPerRole: { ...(f.modelPerRole as Record<string, string>) }
    };
  }
  return out;
}
