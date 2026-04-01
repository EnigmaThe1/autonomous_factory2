import * as vscode from "vscode";
import type { AgentRole, Mission } from "../types";
import type { SidebarAgentLiveItem, SidebarAgentStatus, SidebarApprovalBundleSummary } from "./protocol";
import { resolveModelForProvider } from "../providers/providerModelResolution";
import { approvalBundleSummariesForMissionPending } from "./aiSidebarMissionDerivedPure";

export function buildApprovalBundlesFromMissions(missions: Mission[]): SidebarApprovalBundleSummary[] {
  const parts: SidebarApprovalBundleSummary[] = [];
  for (const mission of missions) {
    const pending = (mission.approvals || []).filter((x) => x.status === "pending");
    parts.push(...approvalBundleSummariesForMissionPending(mission, pending));
  }
  return parts.sort((a, b) => b.createdAt - a.createdAt);
}

export function buildAgentLiveFromMission(mission: Mission | undefined): SidebarAgentLiveItem[] {
  const roles: AgentRole[] = ["planner", "researcher", "implementer", "reviewer", "validator"];
  if (!mission) {
    return roles.map((role) => ({ role, status: "idle", recentEvents: [] }));
  }
  return roles.map((role) => {
    const running = mission.queue.find((work) => work.role === role && work.status === "running");
    const nextTodo = mission.queue.find((work) => work.role === role && work.status === "todo");
    const recentEvents = (mission.events || [])
      .filter((event) => event.source === role || event.source.startsWith(`${role}:`) || event.message.toLowerCase().includes(role))
      .slice(-3)
      .reverse()
      .map((event) => ({ ts: event.ts, message: event.message, level: event.level, source: event.source }));
    const recentToolEvents = (mission.events || [])
      .filter((event) => event.source.startsWith("tool:"))
      .slice(-3)
      .reverse()
      .map((event) => ({ ts: event.ts, message: event.message, level: event.level, source: event.source }));
    return {
      role,
      currentWork: running?.title || nextTodo?.title,
      status: running ? "running" : nextTodo ? "queued" : "idle",
      recentEvents,
      recentToolEvents
    };
  });
}

export function resolveFocusedMission(missions: Mission[], focusedMissionId?: string): Mission | undefined {
  if (focusedMissionId) {
    const found = missions.find((mission) => mission.id === focusedMissionId);
    if (found) return found;
  }
  return missions[0];
}

export function buildAgentStatusFromMission(
  mission: Mission | undefined,
  defaultProvider: string,
  defaultModel: string
): SidebarAgentStatus[] {
  const cfg = vscode.workspace.getConfiguration();
  const roles = ["planner", "researcher", "implementer", "reviewer", "validator"] as const;
  if (!mission) {
    return roles.map((role) => ({ role, todo: 0, running: 0, done: 0, skipped: 0, blocked: 0, provider: defaultProvider, model: defaultModel }));
  }
  return roles.map((role) => {
    const items = mission.queue.filter((work) => work.role === role);
    const effProvider = mission.routing?.providerPerRole?.[role]?.trim() || mission.activeProviderId || defaultProvider;
    const roleModelRaw = mission.routing?.modelPerRole?.[role]?.trim();
    const resolvedModel = resolveModelForProvider(effProvider, roleModelRaw || undefined, (k, d) => cfg.get(k, d));
    return {
      role,
      todo: items.filter((work) => work.status === "todo").length,
      running: items.filter((work) => work.status === "running").length,
      done: items.filter((work) => work.status === "done").length,
      skipped: items.filter((work) => work.status === "skipped").length,
      blocked: items.filter((work) => work.status === "blocked" || work.status === "failed").length,
      provider: effProvider,
      model: resolvedModel
    };
  });
}
