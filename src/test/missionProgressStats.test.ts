import test from "node:test";
import assert from "node:assert/strict";
import { computeMissionProgressStats, computeAllMissionProgressStats } from "../ui/missionProgressStats";
import type { Mission, WorkItem } from "../types";

function makeItem(status: WorkItem["status"]): WorkItem {
  return { id: `w-${status}-${Math.random()}`, title: status, role: "implementer", status, prompt: "" };
}

function makeMission(queue: WorkItem[], overrides: Partial<Mission> = {}): Mission {
  return {
    id: "m-1",
    title: "Test mission",
    prompt: "test",
    createdAt: 1000,
    updatedAt: 11000,
    status: "running",
    activeProviderId: "openai",
    queue,
    memory: [],
    events: [],
    checkpoints: [],
    approvals: [],
    currentStep: 0,
    policy: { maxAutoRounds: 50, closureRequired: false },
    roundsCompleted: 5,
    ...overrides,
  } as Mission;
}

test("progress stats: all counts correct", () => {
  const queue = [
    makeItem("done"), makeItem("done"), makeItem("done"),
    makeItem("running"),
    makeItem("todo"), makeItem("todo"),
    makeItem("blocked"),
    makeItem("failed"),
    makeItem("skipped"),
  ];
  const stats = computeMissionProgressStats(makeMission(queue));
  assert.equal(stats.total, 9);
  assert.equal(stats.done, 3);
  assert.equal(stats.running, 1);
  assert.equal(stats.todo, 2);
  assert.equal(stats.blocked, 1);
  assert.equal(stats.failed, 1);
  assert.equal(stats.skipped, 1);
});

test("progress stats: completion percent counts done + skipped", () => {
  const queue = [makeItem("done"), makeItem("done"), makeItem("skipped"), makeItem("todo")];
  const stats = computeMissionProgressStats(makeMission(queue));
  assert.equal(stats.completionPercent, 75);
});

test("progress stats: zero items yields 0%", () => {
  const stats = computeMissionProgressStats(makeMission([]));
  assert.equal(stats.completionPercent, 0);
  assert.equal(stats.avgStepMs, 0);
  assert.equal(stats.estimatedRemainingMs, 0);
});

test("progress stats: elapsed and avgStepMs", () => {
  const queue = [makeItem("done"), makeItem("done"), makeItem("todo")];
  const m = makeMission(queue, { createdAt: 0, updatedAt: 10000 });
  const stats = computeMissionProgressStats(m);
  assert.equal(stats.elapsedMs, 10000);
  assert.equal(stats.avgStepMs, 5000);
  assert.equal(stats.estimatedRemainingMs, 5000);
});

test("progress stats: roundsCompleted and maxAutoRounds", () => {
  const stats = computeMissionProgressStats(makeMission([makeItem("done")], { roundsCompleted: 12 }));
  assert.equal(stats.roundsCompleted, 12);
  assert.equal(stats.maxAutoRounds, 50);
});

test("progress stats: dryRun flag", () => {
  const stats = computeMissionProgressStats(makeMission([], { dryRun: true }));
  assert.equal(stats.dryRun, true);
  const stats2 = computeMissionProgressStats(makeMission([]));
  assert.equal(stats2.dryRun, false);
});

test("computeAllMissionProgressStats: excludes completed/failed/archived", () => {
  const running = makeMission([makeItem("todo")], { id: "r1", status: "running" });
  const completed = makeMission([makeItem("done")], { id: "c1", status: "completed" });
  const failed = makeMission([makeItem("failed")], { id: "f1", status: "failed" });
  const archived = makeMission([makeItem("done")], { id: "a1", status: "running", archivedAt: Date.now() });
  const queued = makeMission([makeItem("todo")], { id: "q1", status: "queued" });

  const all = computeAllMissionProgressStats([running, completed, failed, archived, queued]);
  assert.ok(all["r1"], "running mission included");
  assert.ok(all["q1"], "queued mission included");
  assert.equal(all["c1"], undefined, "completed excluded");
  assert.equal(all["f1"], undefined, "failed excluded");
  assert.equal(all["a1"], undefined, "archived excluded");
});

test("progress stats: 100% when all done", () => {
  const queue = [makeItem("done"), makeItem("done"), makeItem("done")];
  const stats = computeMissionProgressStats(makeMission(queue));
  assert.equal(stats.completionPercent, 100);
  assert.equal(stats.estimatedRemainingMs, 0);
});
