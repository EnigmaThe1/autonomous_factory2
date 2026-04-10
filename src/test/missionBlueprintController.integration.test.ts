import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import type { MissionAgentRunForTest } from "../missions/MissionOrchestrator";
import { createOrchestrator, type VscodeTestApi } from "./missionOrchestratorTestHarness";
import {
  planBlueprintParseFailureOutcome,
  planReadinessFailureOutcome
} from "../missions/blueprint/missionBlueprintController";

beforeEach(() => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

afterEach(() => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

const archLong =
  "Next.js app router with TypeScript; API routes for orders; PostgreSQL persistence; deploy to Vercel-compatible stack.";
const reqLong = "Build shop with checkout flow, cart persistence, and basic inventory views.";

function blueprintJsonText(payload: Record<string, unknown>): string {
  return `Plan:\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``;
}

const validBlueprintPayload = {
  requirementsSummary: reqLong,
  architectureSummary: archLong,
  steps: [
    {
      id: "s1",
      title: "Scaffold application",
      summary: "Create Next.js app with basic pages and health check endpoint",
      roleHint: "implementer",
      acceptanceCriteria: ["Application boots and shows default page"],
      dependsOn: []
    }
  ]
};

test("planBlueprintParseFailureOutcome: replan vs soft_fallback vs block", () => {
  assert.equal(planBlueprintParseFailureOutcome({ mode: "soft", recoveryReplanAllowed: true }), "replan");
  assert.equal(planBlueprintParseFailureOutcome({ mode: "soft", recoveryReplanAllowed: false }), "soft_fallback");
  assert.equal(planBlueprintParseFailureOutcome({ mode: "hard", recoveryReplanAllowed: false }), "block");
  assert.equal(planBlueprintParseFailureOutcome({ mode: "off", recoveryReplanAllowed: false }), "block");
});

test("planReadinessFailureOutcome: revision vs soft_fallback vs manual", () => {
  assert.equal(planReadinessFailureOutcome({ mode: "soft", revisionUnderCap: true }), "schedule_revision");
  assert.equal(planReadinessFailureOutcome({ mode: "soft", revisionUnderCap: false }), "soft_fallback");
  assert.equal(planReadinessFailureOutcome({ mode: "hard", revisionUnderCap: false }), "awaiting_manual_review");
});

test("soft mode: malformed blueprint then valid repair continues (synthesized queue)", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.blueprintMode", "soft");
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.requireBlueprintApproval", true);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxBlueprintRevisions", 5);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 24);

  let gen = 0;
  const agent: MissionAgentRunForTest = async (_m, item) => {
    if (item.workItemPurpose === "blueprint_generate" || item.workItemPurpose === "blueprint_revise") {
      gen++;
      if (gen === 1) return { summary: "```json\nnot json at all\n```", nextWorkItems: [], markStatus: "done" };
      return { summary: blueprintJsonText(validBlueprintPayload), nextWorkItems: [], markStatus: "done" };
    }
    if (item.role === "implementer" || item.role === "reviewer" || item.role === "validator") {
      return { summary: "done", nextWorkItems: [], markStatus: "done" };
    }
    return { summary: "ok", nextWorkItems: [], markStatus: "done" };
  };

  const noop = async () => ({ ok: true, summary: "noop" });
  const { orchestrator, store } = await createOrchestrator(agent, noop);
  const started = await orchestrator.startMission("soft-repair", "Build shop", "ollama");
  await orchestrator.whenMissionRunLoopIdle(started.mission.id);

  const m = store.get(started.mission.id)!;
  assert.ok(m.blueprint?.status === "approved", "soft mode should auto-approve valid blueprint");
  assert.ok(m.queue.some((w) => w.blueprintStepId === "s1"), "expected synthesized work from blueprint");
});

test("soft mode: zero revision budget on parse failure falls back to dynamic decomposition", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.blueprintMode", "soft");
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxBlueprintRevisions", 0);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 24);

  const agent: MissionAgentRunForTest = async (_m, item) => {
    if (item.workItemPurpose === "blueprint_generate") {
      return { summary: "```json\n{\n  \"broken\": true\n```", nextWorkItems: [], markStatus: "done" };
    }
    if (item.title.includes("dynamic decomposition")) {
      return {
        summary: "WORK: implementer — Do minimal thing",
        nextWorkItems: [
          { id: "w-impl", title: "Impl", role: "implementer", status: "todo", prompt: "x" },
          { id: "w-rev", title: "Rev", role: "reviewer", status: "todo", prompt: "y" },
          { id: "w-val", title: "Val", role: "validator", status: "todo", prompt: "z" }
        ],
        markStatus: "done"
      };
    }
    return { summary: "ok", nextWorkItems: [], markStatus: "done" };
  };

  const noop = async () => ({ ok: true, summary: "noop" });
  const { orchestrator, store } = await createOrchestrator(agent, noop);
  const started = await orchestrator.startMission("soft-fallback", "Goal", "ollama");
  await orchestrator.whenMissionRunLoopIdle(started.mission.id);

  const m = store.get(started.mission.id)!;
  assert.equal(m.status, "queued");
  assert.equal(m.blueprint, undefined);
  assert.ok(m.queue.some((w) => w.title.includes("dynamic decomposition") || w.id === "w-impl"));
});

test("hard mode: valid blueprint awaits operator approval before synthesis", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.blueprintMode", "hard");
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.requireBlueprintApproval", true);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 24);

  const agent: MissionAgentRunForTest = async (_m, item) => {
    if (item.workItemPurpose === "blueprint_generate") {
      return { summary: blueprintJsonText(validBlueprintPayload), nextWorkItems: [], markStatus: "done" };
    }
    return { summary: "unexpected", nextWorkItems: [], markStatus: "done" };
  };

  const noop = async () => ({ ok: true, summary: "noop" });
  const { orchestrator, store } = await createOrchestrator(agent, noop);
  const started = await orchestrator.startMission("hard-await", "Build shop", "ollama");
  await orchestrator.whenMissionRunLoopIdle(started.mission.id);

  const m = store.get(started.mission.id)!;
  assert.equal(m.blueprint?.status, "awaiting_approval");
  assert.equal(m.blockReasonCode, "awaiting_blueprint_approval");
  assert.ok(!m.queue.some((w) => w.blueprintStepId === "s1"), "no synthesis until approve");
});

test("hard mode: after approveMissionBlueprint queue contains synthesized blueprint work", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.blueprintMode", "hard");
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.requireBlueprintApproval", true);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 24);

  const agent: MissionAgentRunForTest = async (_m, item) => {
    if (item.workItemPurpose === "blueprint_generate") {
      return { summary: blueprintJsonText(validBlueprintPayload), nextWorkItems: [], markStatus: "done" };
    }
    return { summary: "ok", nextWorkItems: [], markStatus: "done" };
  };

  const noop = async () => ({ ok: true, summary: "noop" });
  const { orchestrator, store } = await createOrchestrator(agent, noop);
  const started = await orchestrator.startMission("hard-approve", "Build shop", "ollama");
  await orchestrator.whenMissionRunLoopIdle(started.mission.id);

  const ap = await orchestrator.approveMissionBlueprint(started.mission.id);
  assert.equal(ap.ok, true);
  await orchestrator.whenMissionRunLoopIdle(started.mission.id);

  const m = store.get(started.mission.id)!;
  assert.equal(m.blueprint?.status, "approved");
  assert.ok(m.queue.some((w) => w.blueprintStepId === "s1"));
});

test("integration: repeated malformed blueprint in soft mode does not leave mission blocked", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.blueprintMode", "soft");
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxBlueprintRevisions", 2);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 32);

  let plannerIdx = 0;
  const agent: MissionAgentRunForTest = async (_m, item) => {
    if (item.role === "planner" && (item.workItemPurpose === "blueprint_generate" || item.workItemPurpose === "blueprint_revise")) {
      plannerIdx++;
      if (plannerIdx <= 3) {
        return { summary: `bad ${plannerIdx}\n\`\`\`json\n{{{`, nextWorkItems: [], markStatus: "done" };
      }
      return { summary: blueprintJsonText(validBlueprintPayload), nextWorkItems: [], markStatus: "done" };
    }
    if (item.title.includes("dynamic decomposition")) {
      return {
        summary: "WORK: implementer — step",
        nextWorkItems: [
          { id: "wi1", title: "Impl", role: "implementer", status: "todo", prompt: "p" },
          { id: "wi2", title: "Rev", role: "reviewer", status: "todo", prompt: "p" },
          { id: "wi3", title: "Val", role: "validator", status: "todo", prompt: "p" }
        ],
        markStatus: "done"
      };
    }
    if (item.role === "implementer" || item.role === "reviewer" || item.role === "validator") {
      return { summary: "done", nextWorkItems: [], markStatus: "done" };
    }
    return { summary: "ok", nextWorkItems: [], markStatus: "done" };
  };

  const noop = async () => ({ ok: true, summary: "noop" });
  const { orchestrator, store } = await createOrchestrator(agent, noop);
  const started = await orchestrator.startMission("soft-repeat", "Build shop", "ollama");
  await orchestrator.whenMissionRunLoopIdle(started.mission.id);

  const m = store.get(started.mission.id)!;
  assert.notEqual(m.status, "blocked");
  const fellBack = m.queue.some((w) => w.title.includes("dynamic decomposition"));
  const repaired = m.blueprint?.status === "approved";
  assert.ok(
    fellBack || repaired,
    "expected soft mode to recover via valid blueprint or dynamic fallback, not permanent block"
  );
});
