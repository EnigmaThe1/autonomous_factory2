import * as vscode from "vscode";
import type { WorkItem } from "../../types";
import { uid } from "../../util";
import type { GlobalMemoryStore } from "../../memory/GlobalMemoryStore";
import type { MissionFileTracker } from "../MissionFileTracker";
import type { MissionStore } from "../MissionStore";
import { synthesizeWorkItemsFromBlueprint } from "../blueprintSynthesis";
import { computePlanFidelityDrift } from "../blueprintPlanFidelity";
import { validateBlueprintReadinessForApproval } from "../blueprintReadinessGate";
import { readinessMessageText } from "./orchestratorLeafHelpers";

export interface BlueprintFlowHost {
  store: MissionStore;
  globalMemory: GlobalMemoryStore;
  fileTracker?: MissionFileTracker;
  scheduleRunMission(missionId: string): void;
}

export class MissionOrchestratorBlueprintFlow {
  constructor(private readonly host: BlueprintFlowHost) {}

  /**
   * When `myAi.missions.blueprintFidelityCheck` is on and blueprint is approved, flush file tracker,
   * compare `filesModified` to blueprint-derived keywords, and enqueue an optional reviewer if drift.
   */
  async maybeEnqueuePlanFidelityReview(missionId: string, implementerItem: WorkItem): Promise<void> {
    try {
      if (!vscode.workspace.getConfiguration().get<boolean>("myAi.missions.blueprintFidelityCheck", false)) {
        return;
      }
      await this.host.fileTracker?.flush(missionId);
      const mission = this.host.store.get(missionId);
      if (!mission?.blueprint || mission.blueprint.status !== "approved") return;
      const { drift, suspicious } = computePlanFidelityDrift(mission);
      if (!drift || !suspicious.length) return;
      const dupe = mission.queue.some(
        (w) => w.title.startsWith("Plan fidelity") && (w.status === "todo" || w.status === "running")
      );
      if (dupe) return;
      await this.host.store.enqueue(missionId, [
        {
          id: uid("work"),
          title: "Plan fidelity — unexpected file paths",
          role: "reviewer",
          status: "todo",
          requiredForCompletion: false,
          dependsOn: [implementerItem.id],
          prompt: `Blueprint drift heuristic flagged modified paths that do not match blueprint-derived keywords (allowlisted config files excluded): ${suspicious.slice(0, 24).join("; ")}. Review scope; if intentional, note why. Otherwise propose bounded follow-up or planner work.`
        }
      ]);
      await this.host.store.saveEvent(missionId, {
        level: "warn",
        source: "blueprint-fidelity",
        message: `Plan fidelity: ${suspicious.length} path(s) weakly aligned with blueprint tokens.`
      });
      await this.host.store.noteProgress(missionId);
    } catch {
      /* fidelity must not break the mission loop */
    }
  }

  async enqueueSynthesizedBlueprintWork(missionId: string): Promise<void> {
    const m = this.host.store.get(missionId);
    if (!m?.blueprint || m.blueprint.status !== "approved") return;
    const items = synthesizeWorkItemsFromBlueprint(m.blueprint);
    if (items.length) await this.host.store.enqueue(missionId, items);
  }

  async addBlueprintMemoryMirror(missionId: string): Promise<void> {
    const m = this.host.store.get(missionId);
    if (!m?.blueprint) return;
    const text = [
      `Requirements: ${m.blueprint.requirementsSummary}`,
      `Architecture: ${m.blueprint.architectureSummary}`,
      `Steps: ${m.blueprint.steps.map((s) => `${s.id}: ${s.title}`).join("; ")}`
    ].join("\n");
    const saved = await this.host.store.addMemory(missionId, {
      kind: "summary",
      text: text.slice(0, 50_000),
      tags: ["blueprint", "approved"],
      sourceMissionId: missionId
    });
    await this.host.globalMemory.add(saved);
  }

  /**
   * After pre-blueprint questions are shown, operator submits answers; host enqueues blueprint generation
   * with Q&A embedded in the planner prompt.
   */
  async submitPreBlueprintClarificationAnswers(
    missionId: string,
    answersMarkdown: string
  ): Promise<{ ok: boolean; message: string }> {
    const m = this.host.store.get(missionId);
    if (!m) return { ok: false, message: "Mission not found." };
    if (m.blockReasonCode !== "awaiting_pre_blueprint_answers" || m.preBlueprintClarification?.status !== "awaiting_answers") {
      return { ok: false, message: "Mission is not waiting for pre-blueprint answers." };
    }
    const q = m.preBlueprintClarification;
    if (!q?.questions?.length) {
      return { ok: false, message: "No clarification questions on mission." };
    }
    const trimmed = answersMarkdown.trim().slice(0, 50_000);
    const numbered = q.questions.map((question, i) => `${i + 1}. ${question}`).join("\n");
    const blueprintPrompt = [
      "Generate the full mission blueprint as structured JSON (see system instructions).",
      "",
      "## Pre-blueprint clarification",
      numbered,
      "",
      "## Operator answers",
      trimmed || "(none provided)"
    ].join("\n");

    await this.host.store.updateMission(missionId, {
      preBlueprintClarification: { ...q, answersMarkdown: trimmed || undefined, status: "complete" },
      status: "queued",
      blocker: undefined,
      blockReasonCode: undefined
    });
    await this.host.store.enqueue(missionId, [
      {
        id: uid("work"),
        title: "Mission blueprint (full plan)",
        role: "planner",
        status: "todo",
        workItemPurpose: "blueprint_generate",
        prompt: blueprintPrompt
      }
    ]);
    await this.host.store.saveEvent(missionId, {
      level: "info",
      source: "pre_blueprint",
      message: "Operator submitted pre-blueprint answers; blueprint generation enqueued."
    });
    await this.host.store.noteProgress(missionId);
    this.host.scheduleRunMission(missionId);
    return { ok: true, message: "Answers recorded; blueprint generation started." };
  }

  /** Operator approves a parsed blueprint and starts synthesized execution. */
  async approveMissionBlueprint(missionId: string): Promise<{ ok: boolean; message: string }> {
    const m = this.host.store.get(missionId);
    if (!m) return { ok: false, message: "Mission not found." };
    if (!m.blueprint || m.blueprint.status !== "awaiting_approval") {
      return { ok: false, message: "No blueprint awaiting approval." };
    }
    const readiness = validateBlueprintReadinessForApproval(m.blueprint);
    if (!readiness.ok) {
      const message = `Blueprint not ready for approval:\n- ${readiness.report.errors.join("\n- ")}`;
      await this.host.store.saveEvent(missionId, {
        level: "warn",
        source: "blueprint-readiness",
        message
      });
      return { ok: false, message };
    }
    const bp = { ...m.blueprint, status: "approved" as const, approvedAt: Date.now() };
    await this.host.store.updateMission(missionId, {
      blueprint: bp,
      status: "queued",
      blocker: undefined,
      blockReasonCode: undefined
    });
    await this.enqueueSynthesizedBlueprintWork(missionId);
    await this.addBlueprintMemoryMirror(missionId);
    await this.host.store.saveEvent(missionId, {
      level: "info",
      source: "blueprint",
      message: "Operator approved mission blueprint; work queue synthesized."
    });
    this.host.scheduleRunMission(missionId);
    return { ok: true, message: "Blueprint approved; mission resumed." };
  }

  async rejectMissionBlueprint(missionId: string): Promise<{ ok: boolean; message: string }> {
    const m = this.host.store.get(missionId);
    if (!m) return { ok: false, message: "Mission not found." };
    if (!m.blueprint || m.blueprint.status !== "awaiting_approval") {
      return { ok: false, message: "No blueprint awaiting approval." };
    }
    await this.host.store.updateMission(missionId, {
      status: "cancelled",
      blocker: "Mission blueprint rejected by operator.",
      blueprint: undefined
    });
    await this.host.store.saveEvent(missionId, { level: "warn", source: "blueprint", message: "Blueprint rejected; mission cancelled." });
    return { ok: true, message: "Mission cancelled." };
  }

  async requestMissionBlueprintRevision(missionId: string, note: string): Promise<{ ok: boolean; message: string }> {
    const m = this.host.store.get(missionId);
    if (!m) return { ok: false, message: "Mission not found." };
    const maxRev = vscode.workspace.getConfiguration().get<number>("myAi.missions.maxBlueprintRevisions", 3);
    if ((m.blueprintRevisionCount || 0) >= maxRev) {
      return { ok: false, message: `Revision limit reached (${maxRev}).` };
    }
    const readiness = m.blueprint ? validateBlueprintReadinessForApproval(m.blueprint) : undefined;
    const prior = m.blueprint
      ? JSON.stringify({
          requirementsSummary: m.blueprint.requirementsSummary,
          architectureSummary: m.blueprint.architectureSummary,
          goalEndState: m.blueprint.goalEndState,
          approachOptions: m.blueprint.approachOptions,
          chosenApproach: m.blueprint.chosenApproach,
          steps: m.blueprint.steps
        })
      : "";
    const readinessText = readiness
      ? `\n\nCurrent readiness report:\n${readinessMessageText(readiness)}`
      : "";
    await this.host.store.updateMission(missionId, {
      blueprintRevisionCount: (m.blueprintRevisionCount || 0) + 1,
      status: "queued",
      blocker: undefined,
      blockReasonCode: undefined,
      blueprint: undefined
    });
    await this.host.store.enqueue(missionId, [
      {
        id: uid("work"),
        title: "Mission blueprint (revision)",
        role: "planner",
        status: "todo",
        workItemPurpose: "blueprint_revise",
        prompt: `Revise the full mission blueprint as structured JSON. Prior plan (reference): ${prior.slice(0, 12_000)}${readinessText}\n\nOperator request: ${note}`
      }
    ]);
    await this.host.store.saveEvent(missionId, { level: "info", source: "blueprint", message: "Blueprint revision requested." });
    this.host.scheduleRunMission(missionId);
    return { ok: true, message: "Revision pass scheduled." };
  }
}
