import test from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import {
  applySupersededTerminalDemotions,
  applySupersededValidatorTerminalDemotions,
  supersededReviewerTerminalSkipReason,
  supersededValidatorTerminalSkipReason
} from "../missions/requiredWork";
import type { Mission, WorkItem } from "../types";
import {
  balancedIntegrationPolicy,
  createOrchestrator,
  roleScript,
  type VscodeTestApi
} from "./missionOrchestratorTestHarness";

test("supersededValidatorTerminalSkipReason: stale failed validator when later validator done and passed", () => {
  const q: WorkItem[] = [
    { id: "v1", title: "First validation", role: "validator", status: "failed", prompt: "p", output: "tool read failed" },
    { id: "v2", title: "Re-validation", role: "validator", status: "done", prompt: "p", output: "COMPLETE:" }
  ];
  const mission = { validationState: "passed" as const, queue: q } as Mission;
  const r = supersededValidatorTerminalSkipReason(mission, q[0]!);
  assert.ok(r);
  assert.equal(supersededValidatorTerminalSkipReason(mission, q[1]!), null);
});

test("applySupersededValidatorTerminalDemotions skips stale validator terminal rows", () => {
  const q: WorkItem[] = [
    { id: "v1", title: "First validation", role: "validator", status: "failed", prompt: "p" },
    { id: "v2", title: "Second", role: "validator", status: "done", prompt: "p" }
  ];
  const mission = { validationState: "passed" as const } as Mission;
  const out = applySupersededValidatorTerminalDemotions(mission, q);
  assert.equal(out.find((w) => w.id === "v1")?.status, "skipped");
  assert.equal(out.find((w) => w.id === "v2")?.status, "done");
});

test("supersededReviewerTerminalSkipReason: stale failed reviewer when later reviewer done and validation passed", () => {
  const q: WorkItem[] = [
    { id: "r1", title: "First review", role: "reviewer", status: "failed", prompt: "p", output: "old issues" },
    { id: "r2", title: "Second review", role: "reviewer", status: "done", prompt: "p", output: "closed" },
    { id: "v2", title: "Validation", role: "validator", status: "done", prompt: "p", output: "COMPLETE:" }
  ];
  const mission = { validationState: "passed" as const, queue: q } as Mission;
  const r = supersededReviewerTerminalSkipReason(mission, q[0]!);
  assert.ok(r);
  assert.equal(supersededReviewerTerminalSkipReason(mission, q[1]!), null);
});

test("applySupersededTerminalDemotions skips stale reviewer terminal rows", () => {
  const q: WorkItem[] = [
    { id: "r1", title: "First review", role: "reviewer", status: "blocked", prompt: "p", output: "old block" },
    { id: "r2", title: "Second review", role: "reviewer", status: "done", prompt: "p", output: "closed" },
    { id: "v2", title: "Validation", role: "validator", status: "done", prompt: "p", output: "COMPLETE:" }
  ];
  const mission = { validationState: "passed" as const } as Mission;
  const out = applySupersededTerminalDemotions(mission, q);
  assert.equal(out.find((w) => w.id === "r1")?.status, "skipped");
  assert.equal(out.find((w) => w.id === "r2")?.status, "done");
});

test("runMission collapses to completed when stale failed validator superseded after resume-shaped queue", async () => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
  try {
    (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 8);
    const agent = roleScript({});
    const noop = async () => ({ ok: true as const, summary: "noop" });
    const { orchestrator, store } = await createOrchestrator(agent, noop);
    const m = await store.create("superseded-val-closure", "p", "ollama", undefined, balancedIntegrationPolicy);
    const queue: WorkItem[] = [
      { id: "p1", title: "Plan", role: "planner", status: "done", prompt: "p" },
      { id: "i1", title: "Impl", role: "implementer", status: "done", prompt: "p" },
      { id: "r1", title: "Rev", role: "reviewer", status: "done", prompt: "p" },
      {
        id: "v-stale",
        title: "Validation (earlier attempt)",
        role: "validator",
        status: "failed",
        prompt: "p",
        output: "read-only tool failure"
      },
      { id: "v-ok", title: "Validation (passed)", role: "validator", status: "done", prompt: "p", output: "COMPLETE:" }
    ];
    await store.updateMission(m.id, {
      queue,
      validationState: "passed",
      status: "blocked",
      blocker: "Closure policy not satisfied",
      blockReasonCode: "closure_not_satisfied"
    });
    await orchestrator.resumeMission(m.id);
    await orchestrator.whenMissionRunLoopIdle(m.id);
    const fin = store.get(m.id)!;
    assert.equal(fin.status, "completed");
    assert.equal(fin.blockReasonCode, undefined);
    const stale = fin.queue.find((w) => w.id === "v-stale");
    assert.equal(stale?.status, "skipped");
    assert.match(String(stale?.output), /superseded validator attempt/);
  } finally {
    (vscode as VscodeTestApi).__clearTestConfig?.();
  }
});

test("runMission completes when stale failed reviewer is superseded after later review and validation passed", async () => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
  try {
    (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 8);
    const agent = roleScript({});
    const noop = async () => ({ ok: true as const, summary: "noop" });
    const { orchestrator, store } = await createOrchestrator(agent, noop);
    const m = await store.create("superseded-reviewer-closure", "p", "ollama", undefined, balancedIntegrationPolicy);
    const queue: WorkItem[] = [
      { id: "p1", title: "Plan", role: "planner", status: "done", prompt: "p" },
      { id: "i1", title: "Impl", role: "implementer", status: "done", prompt: "p" },
      {
        id: "r-stale",
        title: "Review (earlier attempt)",
        role: "reviewer",
        status: "failed",
        prompt: "p",
        output: "old reviewer failure"
      },
      { id: "r-ok", title: "Review (passed)", role: "reviewer", status: "done", prompt: "p", output: "closed" },
      { id: "v-ok", title: "Validation (passed)", role: "validator", status: "done", prompt: "p", output: "COMPLETE:" }
    ];
    await store.updateMission(m.id, {
      queue,
      validationState: "passed",
      status: "blocked",
      blocker: "Closure policy not satisfied",
      blockReasonCode: "closure_not_satisfied"
    });
    await orchestrator.resumeMission(m.id);
    await orchestrator.whenMissionRunLoopIdle(m.id);
    const fin = store.get(m.id)!;
    assert.equal(fin.status, "completed");
    assert.equal(fin.blockReasonCode, undefined);
    const stale = fin.queue.find((w) => w.id === "r-stale");
    assert.equal(stale?.status, "skipped");
    assert.match(String(stale?.output), /superseded reviewer attempt/);
  } finally {
    (vscode as VscodeTestApi).__clearTestConfig?.();
  }
});
