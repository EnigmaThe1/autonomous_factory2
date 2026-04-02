import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import type { MissionAgentRunForTest } from "../missions/MissionOrchestrator";
import { createOrchestrator, type VscodeTestApi } from "./missionOrchestratorTestHarness";

beforeEach(() => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

afterEach(() => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

const blueprintModelText = `Here is the plan:\n\`\`\`json\n${JSON.stringify({
  requirementsSummary: "Build shop",
  architectureSummary: "Next.js + API",
  steps: [
    {
      id: "s1",
      title: "Scaffold",
      summary: "Create app",
      roleHint: "implementer",
      acceptanceCriteria: ["App runs"],
      dependsOn: []
    }
  ]
})}\n\`\`\``;

test("preBlueprintClarification: clarify gate then submit enqueues blueprint awaiting approval", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.blueprintMode", true);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.preBlueprintClarification", true);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.requireBlueprintApproval", true);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 24);

  const agent: MissionAgentRunForTest = async (_m, item) => {
    if (item.workItemPurpose === "pre_blueprint_clarify") {
      return {
        summary: JSON.stringify({ questions: ["What runtime?"] }),
        nextWorkItems: [],
        markStatus: "done"
      };
    }
    if (item.workItemPurpose === "blueprint_generate") {
      assert.match(item.prompt || "", /Pre-blueprint clarification/i);
      assert.match(item.prompt || "", /Operator answers/i);
      assert.match(item.prompt || "", /TypeScript/);
      return { summary: blueprintModelText, nextWorkItems: [], markStatus: "done" };
    }
    throw new Error(`unexpected work item ${item.workItemPurpose || item.role}`);
  };

  const noop = async () => ({ ok: true, summary: "noop" });
  const { orchestrator, store } = await createOrchestrator(agent, noop);
  const started = await orchestrator.startMission("pbq", "Build a shop", "ollama");
  await orchestrator.whenMissionRunLoopIdle(started.mission.id);

  let m = store.get(started.mission.id)!;
  assert.equal(m.status, "awaiting_input");
  assert.equal(m.blockReasonCode, "awaiting_pre_blueprint_answers");
  assert.equal(m.preBlueprintClarification?.status, "awaiting_answers");
  assert.deepEqual(m.preBlueprintClarification?.questions, ["What runtime?"]);

  const sub = await orchestrator.submitPreBlueprintClarificationAnswers(started.mission.id, "TypeScript.");
  assert.equal(sub.ok, true);
  await orchestrator.whenMissionRunLoopIdle(started.mission.id);

  m = store.get(started.mission.id)!;
  assert.equal(m.preBlueprintClarification?.status, "complete");
  assert.equal(m.preBlueprintClarification?.answersMarkdown, "TypeScript.");
  assert.ok(m.blueprint);
  assert.equal(m.blueprint?.status, "awaiting_approval");
  assert.equal(m.status, "awaiting_input");
  assert.equal(m.blockReasonCode, "awaiting_blueprint_approval");
});
