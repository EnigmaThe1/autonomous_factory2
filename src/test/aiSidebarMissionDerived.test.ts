import test from "node:test";
import assert from "node:assert/strict";
import type { Mission } from "../types";
import { computeMissionDerivedSlicesPure } from "../ui/aiSidebarMissionDerived";

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

test("computeMissionDerivedSlicesPure: empty missions returns empty slices", () => {
  const result = computeMissionDerivedSlicesPure([]);
  assert.deepEqual(result.pendingApprovals, []);
  assert.deepEqual(result.approvalBundles, []);
  assert.deepEqual(result.timeline, []);
  assert.deepEqual(result.recentToolEvents, []);
});

test("computeMissionDerivedSlicesPure: collects pending approvals", () => {
  const m = baseMission({
    approvals: [
      {
        id: "a1",
        missionId: "m1",
        status: "pending",
        kind: "write_file",
        title: "Write foo.ts",
        createdAt: 2000,
        details: "content here",
        toolCall: { tool: "writeFile", args: { path: "foo.ts", content: "x" } }
      }
    ]
  });
  const result = computeMissionDerivedSlicesPure([m]);
  assert.equal(result.pendingApprovals.length, 1);
  assert.equal(result.pendingApprovals[0].approvalId, "a1");
  assert.equal(result.pendingApprovals[0].missionId, "m1");
  assert.equal(result.pendingApprovals[0].missionTitle, "Test mission");
});

test("computeMissionDerivedSlicesPure: excludes resolved approvals from pending", () => {
  const m = baseMission({
    approvals: [
      {
        id: "a1",
        missionId: "m1",
        status: "approved",
        kind: "write_file",
        title: "Done",
        details: "",
        createdAt: 1000,
        toolCall: { tool: "writeFile", args: {} }
      }
    ]
  });
  const result = computeMissionDerivedSlicesPure([m]);
  assert.equal(result.pendingApprovals.length, 0);
});

test("computeMissionDerivedSlicesPure: collects timeline events across missions", () => {
  const m1 = baseMission({
    id: "m1",
    events: [
      { id: "e1", ts: 3000, level: "info", source: "planner", message: "Plan created" }
    ] as Mission["events"]
  });
  const m2 = baseMission({
    id: "m2",
    events: [
      { id: "e2", ts: 4000, level: "info", source: "implementer", message: "Code written" }
    ] as Mission["events"]
  });
  const result = computeMissionDerivedSlicesPure([m1, m2]);
  assert.equal(result.timeline.length, 2);
  assert.equal(result.timeline[0].ts, 4000);
  assert.equal(result.timeline[1].ts, 3000);
});

test("computeMissionDerivedSlicesPure: timeline limited to 60 entries", () => {
  const events = Array.from({ length: 15 }, (_, i) => ({
    id: `e${i}`,
    ts: i * 1000,
    level: "info" as const,
    source: "test",
    message: `Event ${i}`
  }));
  const missions = Array.from({ length: 5 }, (_, i) =>
    baseMission({ id: `m${i}`, events: events as Mission["events"] })
  );
  const result = computeMissionDerivedSlicesPure(missions);
  assert.ok(result.timeline.length <= 60);
});

test("computeMissionDerivedSlicesPure: collects recent tool events", () => {
  const m = baseMission({
    events: [
      { id: "e1", ts: 1000, level: "info", source: "tool:readFile", message: "/src/index.ts" },
      { id: "e2", ts: 2000, level: "info", source: "tool:writeFile", message: "/src/out.ts" },
      { id: "e3", ts: 3000, level: "info", source: "planner", message: "Not a tool event" }
    ] as Mission["events"]
  });
  const result = computeMissionDerivedSlicesPure([m]);
  assert.ok(result.recentToolEvents.length >= 1);
  assert.ok(result.recentToolEvents.every((e) => e.source.startsWith("tool:")));
});

test("computeMissionDerivedSlicesPure: sorts pendingApprovals by createdAt descending", () => {
  const m = baseMission({
    approvals: [
      { id: "a1", missionId: "m1", status: "pending", kind: "write_file", title: "First", details: "", createdAt: 1000, toolCall: { tool: "w", args: {} } },
      { id: "a2", missionId: "m1", status: "pending", kind: "write_file", title: "Second", details: "", createdAt: 3000, toolCall: { tool: "w", args: {} } },
      { id: "a3", missionId: "m1", status: "pending", kind: "write_file", title: "Third", details: "", createdAt: 2000, toolCall: { tool: "w", args: {} } }
    ]
  });
  const result = computeMissionDerivedSlicesPure([m]);
  assert.equal(result.pendingApprovals[0].approvalId, "a2");
  assert.equal(result.pendingApprovals[1].approvalId, "a3");
  assert.equal(result.pendingApprovals[2].approvalId, "a1");
});
