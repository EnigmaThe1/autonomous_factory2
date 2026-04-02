import test from "node:test";
import assert from "node:assert/strict";
import {
  computePlanFidelityDrift,
  extractBlueprintKeywords,
  pathMatchesBlueprintKeywords
} from "../missions/blueprintPlanFidelity";
import type { Mission } from "../types";
import type { MissionBlueprint } from "../missions/missionBlueprintTypes";

function makeBlueprintMission(overrides?: Partial<Mission>): Mission {
  const blueprint: MissionBlueprint = {
    version: 1,
    createdAt: 1,
    status: "approved",
    approvedAt: 2,
    requirementsSummary: "Deliver elephant datastore and giraffe indexer APIs for operators.",
    architectureSummary: "Python workers coordinating elephant ingestion and giraffe search.",
    amendments: [],
    steps: [
      {
        id: "s1",
        title: "Elephant ingestion",
        summary: "Stream records into elephant datastore",
        roleHint: "implementer",
        acceptanceCriteria: ["Giraffe search returns hits"],
        status: "done"
      }
    ]
  };
  return {
    id: "m1",
    title: "t",
    prompt: "p",
    createdAt: 0,
    updatedAt: 0,
    status: "running",
    activeProviderId: "ollama",
    queue: [],
    memory: [],
    events: [],
    checkpoints: [],
    approvals: [],
    currentStep: 0,
    policy: {
      closureRequired: true,
      requireReviewerBeforeComplete: true,
      requireValidatorBeforeComplete: true,
      requireImplementerBeforeComplete: true,
      autoContinue: true,
      maxAutoRounds: 24,
      minCompletedWorkItems: 4,
      stallReplanThreshold: 3
    },
    blueprint,
    ...overrides
  };
}

test("extractBlueprintKeywords: picks tokens from blueprint text", () => {
  const m = makeBlueprintMission();
  const k = extractBlueprintKeywords(m);
  assert.ok(k.has("elephant") || k.has("giraffe"));
});

test("pathMatchesBlueprintKeywords: allowlisted package.json matches without keywords", () => {
  const k = new Set(["nonexistenttokenxyz"]);
  assert.equal(pathMatchesBlueprintKeywords("/proj/package.json", k), true);
});

test("computePlanFidelityDrift: no drift when path contains a blueprint keyword", () => {
  const m = makeBlueprintMission({
    filesModified: ["/app/src/elephant/ingest.py"]
  });
  const r = computePlanFidelityDrift(m);
  assert.equal(r.drift, false);
  assert.equal(r.suspicious.length, 0);
});

test("computePlanFidelityDrift: drift when path matches no keyword", () => {
  const m = makeBlueprintMission({
    filesModified: ["/__drift_probe__/neutral-zone/unrelated.bin"]
  });
  const r = computePlanFidelityDrift(m);
  assert.equal(r.drift, true);
  assert.ok(r.suspicious.some((p) => p.includes("neutral-zone")));
});

test("computePlanFidelityDrift: no blueprint or not approved → no drift", () => {
  const m = makeBlueprintMission({ blueprint: undefined });
  assert.equal(computePlanFidelityDrift(m).drift, false);
  const m2 = makeBlueprintMission();
  m2.blueprint = { ...m2.blueprint!, status: "awaiting_approval" };
  assert.equal(computePlanFidelityDrift(m2).drift, false);
});
