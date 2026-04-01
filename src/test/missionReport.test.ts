import test from "node:test";
import assert from "node:assert/strict";
import { generateMissionReport } from "../missions/missionReport";
import type { Mission, WorkItem, MissionEvent } from "../types";

function makeItem(role: string, status: WorkItem["status"], extra: Partial<WorkItem> = {}): WorkItem {
  return { id: `w-${role}-${status}`, title: `${role} task`, role: role as WorkItem["role"], status, prompt: "p", ...extra };
}

function makeEvent(level: MissionEvent["level"], source: string, message: string, ts = Date.now()): MissionEvent {
  return { id: `e-${Math.random()}`, ts, level, source, message };
}

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: "m-test",
    title: "Test Mission",
    prompt: "Do the thing",
    createdAt: 1000,
    updatedAt: 61000,
    status: "completed",
    activeProviderId: "openai",
    queue: [
      makeItem("planner", "done"),
      makeItem("implementer", "done", { output: "Wrote main.ts" }),
      makeItem("reviewer", "done"),
      makeItem("validator", "done"),
    ],
    memory: [],
    events: [
      makeEvent("info", "orchestrator", "Mission started", 1000),
      makeEvent("info", "tool:writeFile", "/src/main.ts", 10000),
      makeEvent("warn", "tool:runCommand", "Exit code 1: build failed", 20000),
      makeEvent("info", "tool:runCommand", "Exit code 0: build succeeded", 30000),
      makeEvent("info", "orchestrator", "COMPLETE: mission finished", 60000),
    ],
    checkpoints: [],
    approvals: [],
    currentStep: 4,
    policy: { maxAutoRounds: 50, closureRequired: false },
    roundsCompleted: 10,
    filesModified: ["/src/main.ts", "/src/util.ts"],
    ...overrides,
  } as Mission;
}

test("generateMissionReport: produces complete report", () => {
  const report = generateMissionReport(makeMission());
  assert.equal(report.missionId, "m-test");
  assert.equal(report.title, "Test Mission");
  assert.equal(report.status, "completed");
  assert.equal(report.stats.totalWorkItems, 4);
  assert.equal(report.stats.done, 4);
  assert.equal(report.stats.completionPercent, 100);
  assert.equal(report.filesModified.length, 2);
});

test("generateMissionReport: includes work item summary", () => {
  const report = generateMissionReport(makeMission());
  assert.equal(report.workItemSummary.length, 4);
  assert.equal(report.workItemSummary[0].role, "planner");
  assert.equal(report.workItemSummary[1].output, "Wrote main.ts");
});

test("generateMissionReport: extracts error patterns from warnings", () => {
  const report = generateMissionReport(makeMission());
  assert.ok(report.errorPatterns.length > 0, "should have error patterns from warn events");
});

test("generateMissionReport: duration formatting", () => {
  const report = generateMissionReport(makeMission());
  assert.equal(report.duration, "1m 0s");
});

test("generateMissionReport: handles empty mission", () => {
  const report = generateMissionReport(makeMission({ queue: [], events: [], filesModified: [] }));
  assert.equal(report.stats.totalWorkItems, 0);
  assert.equal(report.stats.completionPercent, 0);
  assert.equal(report.filesModified.length, 0);
  assert.equal(report.errorPatterns.length, 0);
});

test("generateMissionReport: tracks retried items", () => {
  const report = generateMissionReport(makeMission({
    queue: [
      makeItem("implementer", "done", { retryCount: 2 }),
      makeItem("implementer", "done"),
    ],
  }));
  assert.equal(report.stats.retried, 1);
});

test("generateMissionReport: failed mission stats", () => {
  const report = generateMissionReport(makeMission({
    status: "failed",
    queue: [
      makeItem("planner", "done"),
      makeItem("implementer", "failed", { output: "Build error: module not found" }),
      makeItem("reviewer", "todo"),
    ],
  }));
  assert.equal(report.stats.done, 1);
  assert.equal(report.stats.failed, 1);
  assert.ok(report.stats.completionPercent < 100);
});

test("generateMissionReport: markdown includes all sections", () => {
  const report = generateMissionReport(makeMission());
  assert.ok(report.markdown.includes("# Mission Report"), "has title");
  assert.ok(report.markdown.includes("## Files Modified"), "has files section");
  assert.ok(report.markdown.includes("## Work Items"), "has work items section");
  assert.ok(report.markdown.includes("## Key Events"), "has timeline section");
  assert.ok(report.markdown.includes("main.ts"), "mentions modified file");
});

test("generateMissionReport: markdown shows dry-run mode", () => {
  const report = generateMissionReport(makeMission({ dryRun: true }));
  assert.ok(report.markdown.includes("Dry run"));
});

test("generateMissionReport: timeline filters key events", () => {
  const report = generateMissionReport(makeMission());
  assert.ok(report.timeline.length > 0);
  assert.ok(report.timeline.some((t) => t.source === "orchestrator"));
});
