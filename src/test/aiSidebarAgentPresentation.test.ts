import test from "node:test";
import assert from "node:assert/strict";
import type { Mission } from "../types";
import {
  buildAgentLiveFromMission,
  buildApprovalBundlesFromMissions,
  resolveFocusedMission
} from "../ui/aiSidebarAgentPresentation";

function baseMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: "m1",
    title: "Test mission",
    prompt: "Do something",
    status: "running",
    activeProviderId: "ollama",
    activeModel: "llama3",
    queue: [],
    events: [],
    memory: [],
    approvals: [],
    validationState: "none",
    startedAt: 1000,
    policy: {
      requireApproval: true,
      requireReviewerBeforeComplete: false,
      requireValidatorBeforeComplete: false,
      requireImplementerBeforeComplete: false
    },
    ...overrides
  } as Mission;
}

test("resolveFocusedMission: returns matching mission when focusedMissionId set", () => {
  const m1 = baseMission({ id: "m1" });
  const m2 = baseMission({ id: "m2" });
  const result = resolveFocusedMission([m1, m2], "m2");
  assert.equal(result?.id, "m2");
});

test("resolveFocusedMission: falls back to first mission when id not found", () => {
  const m1 = baseMission({ id: "m1" });
  const result = resolveFocusedMission([m1], "nonexistent");
  assert.equal(result?.id, "m1");
});

test("resolveFocusedMission: falls back to first mission when no id set", () => {
  const m1 = baseMission({ id: "m1" });
  const result = resolveFocusedMission([m1]);
  assert.equal(result?.id, "m1");
});

test("resolveFocusedMission: returns undefined for empty list", () => {
  const result = resolveFocusedMission([]);
  assert.equal(result, undefined);
});

test("buildAgentLiveFromMission: returns idle agents when no mission", () => {
  const result = buildAgentLiveFromMission(undefined);
  assert.equal(result.length, 5);
  for (const agent of result) {
    assert.equal(agent.status, "idle");
  }
});

test("buildAgentLiveFromMission: detects running work", () => {
  const m = baseMission({
    queue: [
      { id: "w1", title: "Plan", role: "planner", status: "running", prompt: "plan" },
      { id: "w2", title: "Implement", role: "implementer", status: "todo", prompt: "impl" }
    ] as Mission["queue"]
  });
  const result = buildAgentLiveFromMission(m);
  const planner = result.find((a) => a.role === "planner");
  assert.equal(planner?.status, "running");
  assert.equal(planner?.currentWork, "Plan");
  const implementer = result.find((a) => a.role === "implementer");
  assert.equal(implementer?.status, "queued");
  assert.equal(implementer?.currentWork, "Implement");
});

test("buildApprovalBundlesFromMissions: empty approvals returns empty", () => {
  const m = baseMission({ approvals: [] });
  const result = buildApprovalBundlesFromMissions([m]);
  assert.equal(result.length, 0);
});

test("buildApprovalBundlesFromMissions: groups pending approvals", () => {
  const m = baseMission({
    approvals: [
      {
        id: "a1",
        missionId: "m1",
        status: "pending",
        kind: "write_file",
        title: "Write foo.ts",
        details: "content",
        createdAt: 2000,
        toolCall: { tool: "writeFile", args: { path: "foo.ts", content: "x" } }
      },
      {
        id: "a2",
        missionId: "m1",
        status: "approved",
        kind: "write_file",
        title: "Write bar.ts",
        details: "content",
        createdAt: 1000,
        toolCall: { tool: "writeFile", args: { path: "bar.ts", content: "y" } }
      }
    ]
  });
  const result = buildApprovalBundlesFromMissions([m]);
  assert.ok(result.length >= 1);
});
