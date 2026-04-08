import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import { uid } from "../util";
import {
  balancedIntegrationPolicy,
  buildStandardNextQueue,
  createOrchestrator,
  roleScript,
  type VscodeTestApi
} from "./missionOrchestratorTestHarness";

beforeEach(() => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

afterEach(() => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

/** P4-T-001: operator timeline — failed mission salvage via resumeMission (failed → queued + event + cleared codes). */
test("resumeMission: failed mission resets to salvageable queued, logs event, clears failureReasonCode, then runs a pass", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 32);
  const noop = async () => ({ ok: true as const, summary: "noop" });
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "I", toolCalls: [] }],
    reviewer: [{ summary: "R", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, noop);
  const m = await store.create("p4-failed-salvage", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await store.updateMission(m.id, {
    status: "failed",
    failureReasonCode: "orchestrator_uncaught_error",
    blocker: "simulated failure",
    blockReasonCode: "generic_blocked",
    validationState: "failed"
  });

  const r = await orchestrator.resumeMission(m.id);
  assert.equal(r.kind, "ran_pass");

  const mid = store.get(m.id)!;
  assert.ok(
    mid.events.some(
      (e) =>
        e.source === "orchestrator" &&
        typeof e.message === "string" &&
        e.message.includes("Operator resumed after mission failure")
    ),
    "expected salvage info event on failed → resume"
  );
  assert.equal(mid.failureReasonCode, undefined);
  assert.equal(mid.blockReasonCode, undefined);
  assert.equal(mid.status, "completed");
});

/** P4-T-001: failed + pending approval still gates resume (stale snapshot uses pre-salvage approvals list). */
test("resumeMission: failed mission with pending approval returns gated_pending_approval", async () => {
  const noop = async () => ({ ok: true as const, summary: "noop" });
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, noop);
  const m = await store.create("p4-failed-approval-gate", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await store.addApproval(m.id, {
    id: uid("appr"),
    missionId: m.id,
    status: "pending",
    title: "t",
    details: "d",
    kind: "write_file",
    toolCall: { tool: "write_file", args: { path: "x", content: "y" } },
    createdAt: Date.now()
  });
  await store.updateMission(m.id, {
    status: "failed",
    failureReasonCode: "orchestrator_uncaught_error",
    blocker: "failed with pending approval",
    validationState: "failed"
  });

  const r = await orchestrator.resumeMission(m.id);
  assert.equal(r.kind, "gated_pending_approval");
});
