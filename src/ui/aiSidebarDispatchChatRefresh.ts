import * as vscode from "vscode";
import { resolveModelForProvider } from "../providers/providerModelResolution";
import type { UiToExtMessage } from "./protocol";
import type { AiSidebarUiDispatchHost } from "./aiSidebarUiDispatchHost";
import { presentResumeMissionOutcome, presentStartMissionOutcome } from "./missionActionOutcomePresentation";
import {
  presentResumeMissionOutcomeEvent,
  presentStartMissionOutcomeEvent
} from "../missions/missionActionOutcomeEventPresentation";
import { saveOperatorActionMissionEventIfChanged } from "../missions/missionActionOutcomeEventLogging";

function normalizeUiStartMissionInput(msg: Extract<UiToExtMessage, { type: "startMission" }>): {
  title: string;
  prompt: string;
} | { error: string } {
  const title = typeof msg.title === "string" && msg.title.trim() ? msg.title.trim() : "Autonomous Mission";
  const prompt = typeof msg.prompt === "string" ? msg.prompt.trim() : "";
  if (!prompt) return { error: "Mission start requires a prompt." };
  return { title, prompt };
}

export async function dispatchUi_ready(host: AiSidebarUiDispatchHost): Promise<boolean> {
  const job = host.getRefreshQueue().then(async () => {
    const buildStartedAt = Date.now();
    const rawInit = await host.buildSnapshot();
    const buildDurationMs = Date.now() - buildStartedAt;
    const sealedInit = host.sealSnapshotForPost(rawInit, 0);
    const materialFp = host.materialFingerprintFromSnapshot(rawInit);
    host.setLastPublishedFullMaterialFp(materialFp);
    host.setLastFullRefreshCycleMeta({ materialFp, source: "init_ready" });
    host.traceLogger.log({
      level: "info",
      side: "host",
      category: "dashboard",
      event: "init_snapshot_build_complete",
      data: {
        refreshSource: "init_ready" as const,
        buildDurationMs,
        materialFpLen: materialFp.length,
        missions: rawInit.missions.length,
        snapshotPublishSeq: sealedInit.snapshotPublishSeq
      }
    });
    host.postMessage({ type: "init", snapshot: sealedInit });
  });
  host.setRefreshQueue(job.catch(() => undefined));
  await job;
  return true;
}

export async function dispatchUi_sendChat(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "sendChat" }>
): Promise<boolean> {
  await host.handleChat(msg.prompt, msg.providerId, msg.model);
  host.scheduleBackgroundDashboardReconciliation();
  return true;
}

export async function dispatchUi_startMission(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "startMission" }>
): Promise<boolean> {
  const normalized = normalizeUiStartMissionInput(msg);
  host.traceLogger.log({
    level: "info",
    side: "host",
    category: "protocol",
    event: "ui_start_mission_dispatch_begin",
    interactionId: msg.interactionId,
    data:
      "error" in normalized
        ? { valid: false, reason: "empty_prompt" }
        : { valid: true, title: normalized.title, providerId: msg.providerId || "workspace_default" }
  });
  if ("error" in normalized) {
    host.postMessage({ type: "error", message: normalized.error }, { interactionId: msg.interactionId });
    host.traceLogger.log({
      level: "info",
      side: "host",
      category: "protocol",
      event: "ui_start_mission_dispatch_rejected",
      interactionId: msg.interactionId,
      data: { reason: "empty_prompt" }
    });
    return true;
  }
  const cfg = vscode.workspace.getConfiguration();
  const pid = msg.providerId || cfg.get<string>("myAi.defaultProvider", "ollama");
  const explicit = msg.model?.trim() || undefined;
  const resolvedModel = resolveModelForProvider(pid, explicit, (k, d) => cfg.get(k, d));
  const started = await host.orchestrator.startMission(normalized.title, normalized.prompt, pid, resolvedModel);
  const mission = started.mission;
  host.focusMission(mission.id, msg.interactionId);
  host.postMessage({ type: "info", message: presentStartMissionOutcome(started) }, { interactionId: msg.interactionId });
  host.traceLogger.log({
    level: "info",
    side: "host",
    category: "protocol",
    event: "ui_start_mission_dispatch_outcome",
    interactionId: msg.interactionId,
    data: { missionId: mission.id, passKind: started.pass.kind, missionStatus: mission.status }
  });
  await saveOperatorActionMissionEventIfChanged({
    store: host.missionStore,
    missionId: mission.id,
    message: presentStartMissionOutcomeEvent(started)
  });
  // Mission start is user-critical; always allow the handler-tail full refresh to run.
  return false;
}

export async function dispatchUi_resumeMission(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "resumeMission" }>
): Promise<boolean> {
  const out = await host.orchestrator.resumeMission(msg.missionId);
  host.focusMission(msg.missionId);
  host.postMessage({ type: "info", message: presentResumeMissionOutcome(out) });
  const evt = presentResumeMissionOutcomeEvent(out);
  if (evt) {
    await saveOperatorActionMissionEventIfChanged({ store: host.missionStore, missionId: msg.missionId, message: evt });
  }
  return true;
}

export async function dispatchUi_abortMissionLlm(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "abortMissionLlm" }>
): Promise<boolean> {
  host.orchestrator.abortMissionWork(msg.missionId, "operator");
  host.postMessage({ type: "info", message: "Abort requested for focused mission LLM stream." });
  host.postMissionDashboardSnapshotImmediate(undefined);
  host.scheduleBackgroundDashboardReconciliation();
  return true;
}

export async function dispatchUi_focusMission(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "focusMission" }>
): Promise<boolean> {
  host.focusMission(msg.missionId, msg.interactionId);
  return true;
}

export async function dispatchUi_refreshDashboard(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "refreshDashboard" }>
): Promise<boolean> {
  await host.refreshDashboard(msg.interactionId, { source: "manual_refresh" });
  return true;
}
