import test from "node:test";
import assert from "node:assert/strict";
import { MissionAgentRole, type Mission } from "../types";
import {
  buildRoleSpecificUserPromptCoreLines,
  isMissionToolAllowedForRole,
  missionWorkItemContextKeywords,
  researcherTargetedEnrichmentNeeded
} from "../missions/agentDispatch";

function minimalMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: "m1",
    title: "T",
    prompt: "Goal: ship feature X.",
    status: "queued",
    memory: [],
    queue: [
      { id: "q1", title: "Plan", role: MissionAgentRole.Planner, status: "todo", prompt: "p" },
      { id: "q2", title: "Impl", role: MissionAgentRole.Implementer, status: "done", prompt: "i" }
    ],
    routing: {},
    policy: {
      closureRequired: true,
      requireReviewerBeforeComplete: true,
      requireValidatorBeforeComplete: true,
      requireImplementerBeforeComplete: true,
      autoContinue: true,
      maxAutoRounds: 10,
      minCompletedWorkItems: 1,
      stallReplanThreshold: 3
    },
    activeProviderId: "ollama",
    activeModel: "m",
    createdAt: 1,
    updatedAt: 1,
    validationState: "unknown",
    ...overrides
  } as Mission;
}

test("isMissionToolAllowedForRole: planner cannot writeFile; implementer can", () => {
  assert.equal(isMissionToolAllowedForRole(MissionAgentRole.Planner, "writeFile"), false);
  assert.equal(isMissionToolAllowedForRole(MissionAgentRole.Implementer, "writeFile"), true);
  assert.equal(isMissionToolAllowedForRole(MissionAgentRole.Reviewer, "runTests"), false);
  assert.equal(isMissionToolAllowedForRole(MissionAgentRole.Validator, "runTests"), true);
});

test("missionWorkItemContextKeywords: planner gets no rg keywords", () => {
  const m = minimalMission();
  const item = { id: "w", title: "P", role: MissionAgentRole.Planner, status: "todo", prompt: "long complicated planning words here" };
  assert.deepEqual(missionWorkItemContextKeywords(m, item as any), []);
});

test("researcherTargetedEnrichmentNeeded: true for failure investigation purpose", () => {
  const m = minimalMission({ blocker: "tool failed" });
  const item = {
    id: "w",
    title: "Diagnose",
    role: MissionAgentRole.Researcher,
    status: "todo",
    prompt: "p",
    workItemPurpose: "failure_investigation_diagnose" as const
  };
  assert.equal(researcherTargetedEnrichmentNeeded(item as any, m), true);
});

test("buildRoleSpecificUserPromptCoreLines: planner includes QUEUE summary", () => {
  const m = minimalMission();
  const item = { id: "w", title: "Plan tranche", role: MissionAgentRole.Planner, status: "todo", prompt: "Sequence work." };
  const lines = buildRoleSpecificUserPromptCoreLines(m, item as any);
  const joined = lines.join("\n");
  assert.match(joined, /QUEUE \(work items\)/);
  assert.match(joined, /\[todo\]/);
});

test("buildRoleSpecificUserPromptCoreLines: reviewer mentions REVIEW TARGET", () => {
  const m = minimalMission({ filesModified: ["src/a.ts"] });
  const item = { id: "w", title: "Review", role: MissionAgentRole.Reviewer, status: "todo", prompt: "Check quality." };
  const lines = buildRoleSpecificUserPromptCoreLines(m, item as any);
  assert.ok(lines.some((l) => l.includes("REVIEW TARGET")));
});

test("buildRoleSpecificUserPromptCoreLines: validator mentions VALIDATION STATE", () => {
  const m = minimalMission({ validationState: "failed" });
  const item = {
    id: "w",
    title: "Validate",
    role: MissionAgentRole.Validator,
    status: "todo",
    prompt: "Prove closure.",
    validationScopeHint: "Focus on API surface."
  };
  const lines = buildRoleSpecificUserPromptCoreLines(m, item as any);
  const joined = lines.join("\n");
  assert.match(joined, /VALIDATION STATE: failed/);
  assert.match(joined, /Focus on API surface/);
});
