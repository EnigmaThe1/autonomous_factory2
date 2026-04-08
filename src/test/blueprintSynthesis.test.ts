import test from "node:test";
import assert from "node:assert/strict";
import { synthesizeWorkItemsFromBlueprint, topologicalBlueprintSteps } from "../missions/blueprintSynthesis";
import type { MissionBlueprint } from "../missions/missionBlueprintTypes";

const sampleBlueprint = (): MissionBlueprint => ({
  version: 1,
  createdAt: 1,
  status: "approved",
  approvedAt: 2,
  requirementsSummary: "req",
  architectureSummary: "arch",
  amendments: [],
  steps: [
    {
      id: "a",
      title: "First",
      summary: "do a",
      roleHint: "researcher",
      acceptanceCriteria: ["A done"],
      status: "pending"
    },
    {
      id: "b",
      title: "Second",
      summary: "do b",
      roleHint: "implementer",
      dependsOn: ["a"],
      acceptanceCriteria: ["B done"],
      status: "pending"
    }
  ]
});

test("topologicalBlueprintSteps orders dependencies first", () => {
  const ordered = topologicalBlueprintSteps(sampleBlueprint().steps);
  assert.equal(ordered[0].id, "a");
  assert.equal(ordered[1].id, "b");
});

test("synthesizeWorkItemsFromBlueprint maps dependsOn to work item ids", () => {
  const items = synthesizeWorkItemsFromBlueprint(sampleBlueprint());
  assert.equal(items.length, 2);
  const second = items.find((w) => w.blueprintStepId === "b");
  assert.ok(second?.dependsOn?.length === 1);
  const first = items.find((w) => w.blueprintStepId === "a");
  assert.ok(first);
  assert.equal(second!.dependsOn![0], first!.id);
});

test("synthesizeWorkItemsFromBlueprint prepends goal-first context to first work item", () => {
  const bp = sampleBlueprint();
  bp.goalEndState = "Ship feature";
  bp.approachOptions = ["Fast patch", "Deep fix"];
  bp.chosenApproach = "Fast patch";
  const items = synthesizeWorkItemsFromBlueprint(bp);
  const first = items.find((w) => w.blueprintStepId === "a");
  assert.ok(first);
  assert.match(first!.prompt, /\[Blueprint goal-first context\]/);
  assert.match(first!.prompt, /Ship feature/);
  assert.match(first!.prompt, /Fast patch/);
  const second = items.find((w) => w.blueprintStepId === "b");
  assert.ok(second);
  assert.doesNotMatch(second!.prompt, /\[Blueprint goal-first context\]/);
});
