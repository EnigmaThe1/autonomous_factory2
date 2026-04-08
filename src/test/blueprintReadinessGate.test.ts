import test from "node:test";
import assert from "node:assert/strict";
import { uid } from "../util";
import { validateBlueprintReadinessForApproval } from "../missions/blueprintReadinessGate";
import type { MissionBlueprint } from "../missions/missionBlueprintTypes";
import { createOrchestrator, roleScript, type VscodeTestApi } from "./missionOrchestratorTestHarness";
import * as vscode from "vscode";

const baseBlueprint = (): MissionBlueprint => ({
  version: 1,
  createdAt: Date.now(),
  status: "awaiting_approval",
  requirementsSummary: "req",
  architectureSummary: "arch",
  amendments: [],
  steps: [
    {
      id: "a",
      title: "A",
      summary: "do a",
      roleHint: "planner",
      acceptanceCriteria: ["A done"],
      status: "pending"
    }
  ]
});

test("Blueprint readiness: rejects empty acceptance criteria", () => {
  const bp = baseBlueprint();
  bp.steps[0].acceptanceCriteria = [];
  const v = validateBlueprintReadinessForApproval(bp);
  assert.equal(v.ok, false);
  assert.ok(v.report.errors.join("\n").includes("missing acceptanceCriteria"));
});

test("Blueprint readiness: rejects dependency cycles", () => {
  const bp = baseBlueprint();
  bp.steps.push({
    id: "b",
    title: "B",
    summary: "do b",
    roleHint: "implementer",
    dependsOn: ["a", "b"],
    acceptanceCriteria: ["B done"],
    status: "pending"
  });
  const v = validateBlueprintReadinessForApproval(bp);
  assert.equal(v.ok, false);
  assert.ok(v.report.errors.some((x: string) => x.includes("depends on itself") || x.includes("dependency")));
});

test("approveMissionBlueprint refuses approval when blueprint is not ready", async () => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
  const agent = roleScript({}); // no agent work needed
  const { orchestrator, store } = await createOrchestrator(agent, async () => ({ ok: true, summary: "noop" }));
  const m = await store.create("BPR", "p", "ollama", undefined, {
    minCompletedWorkItems: 1,
    requireReviewerBeforeComplete: false,
    requireValidatorBeforeComplete: false,
    requireImplementerBeforeComplete: false,
    requireValidationEvidence: false,
    closureRequired: true,
    autoContinue: true,
    maxAutoRounds: 3,
    stallReplanThreshold: 1,
    policyPreset: "light"
  });
  const bad = baseBlueprint();
  bad.steps[0].acceptanceCriteria = [];
  await store.updateMission(m.id, { blueprint: bad });

  await store.enqueue(m.id, [{ id: uid("work"), title: "noop", role: "planner", status: "todo", prompt: "noop" }]);
  const out = await orchestrator.approveMissionBlueprint(m.id);
  assert.equal(out.ok, false);
  const fin = store.get(m.id)!;
  assert.equal(fin.blueprint?.status, "awaiting_approval");
  assert.ok(fin.events.some((e) => e.source === "blueprint-readiness"));
});

test("Blueprint readiness: emits warnings when there is no implementer step", () => {
  const bp = baseBlueprint();
  bp.steps[0].roleHint = "researcher";
  const v = validateBlueprintReadinessForApproval(bp);
  assert.equal(v.ok, true);
  assert.ok(v.report.warnings.some((w) => w.toLowerCase().includes("no implementer steps")));
});

