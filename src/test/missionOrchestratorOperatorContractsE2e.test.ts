import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import { hasRequiredUnresolvedWork } from "../missions/requiredWork";
import type { ToolCall } from "../types";
import type { ToolResult } from "../tools/ToolRegistry";
import { uid } from "../util";
import {
  awaitMissionRunLoopIdle,
  balancedIntegrationPolicy,
  buildStandardNextQueue,
  createOrchestrator,
  createOrchestratorWithAbortSupport,
  queueStructuralFingerprint,
  roleScript,
  type VscodeTestApi
} from "./missionOrchestratorTestHarness";

beforeEach(() => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

afterEach(() => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

const noopTool = async (): Promise<ToolResult> => ({ ok: true, summary: "noop" });

test("contract: startMission returns non-terminal snapshot; work continues asynchronously", async () => {
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "I", toolCalls: [] }],
    reviewer: [{ summary: "R", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, noopTool);
  const { mission: m, pass } = await orchestrator.startMission("Start-contract", "p", "ollama");
  assert.equal(pass.kind, "scheduled_pass");
  assert.equal(pass.missionId, m.id);
  assert.notEqual(m.status, "completed");
  assert.ok(m.status === "queued" || m.status === "running");
  await awaitMissionRunLoopIdle(orchestrator, m.id);
  const fin = store.get(m.id)!;
  assert.equal(fin.status, "completed");
  assert.equal(fin.validationState, "passed");
});

test("contract: resumeMission completes one pass — queued mid-flight stays non-terminal until enough passes", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 1);
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "I", toolCalls: [] }],
    reviewer: [{ summary: "R", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, noopTool);
  const m = await store.create("Resume-contract", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  let mid = store.get(m.id)!;
  assert.equal(mid.status, "queued");
  const fp = queueStructuralFingerprint(mid);
  assert.ok(mid.events.some((e) => e.message.includes("maxStepsPerRun")));
  assert.notEqual(mid.validationState, "passed");

  await orchestrator.resumeMission(m.id);
  mid = store.get(m.id)!;
  assert.notEqual(mid.status, "completed");
  assert.equal(queueStructuralFingerprint(mid), fp);
  assert.equal(new Set(mid.queue.map((w) => w.id)).size, mid.queue.length);

  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 32);
  await orchestrator.resumeMission(m.id);
  await awaitMissionRunLoopIdle(orchestrator, m.id);
  mid = store.get(m.id)!;
  assert.equal(mid.status, "completed");
  assert.equal(mid.validationState, "passed");
  assert.equal(queueStructuralFingerprint(mid), fp);
});

test("contract: approve then maxSteps chunks — resumeMission drives remainder to completed", async () => {
  const tool = async (_mid: string, call: ToolCall): Promise<ToolResult> => {
    if (call.args.__approved) return { ok: true, summary: "ok" };
    return {
      ok: false,
      summary: "n",
      requiresApproval: { kind: "write_file" as const, title: "Confirm write", details: "d" }
    };
  };
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "W.", toolCalls: [{ tool: "write_file", args: { path: "a.txt", content: "b" } }] }],
    reviewer: [{ summary: "LGTM.", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, tool);
  const m = await store.create("Appr-resume", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  assert.equal(store.get(m.id)!.status, "awaiting_input");
  const pending = store.get(m.id)!.approvals.find((a) => a.status === "pending");
  assert.ok(pending);

  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 1);
  await orchestrator.resolveApproval(m.id, pending.id, true);
  await awaitMissionRunLoopIdle(orchestrator, m.id);
  let mid = store.get(m.id)!;
  const fp = queueStructuralFingerprint(mid);
  assert.equal(mid.status, "queued");
  assert.notEqual(mid.validationState, "passed");
  assert.ok(hasRequiredUnresolvedWork(mid));

  let passes = 0;
  while (mid.status !== "completed" && passes < 24) {
    await orchestrator.resumeMission(m.id);
    await awaitMissionRunLoopIdle(orchestrator, m.id);
    mid = store.get(m.id)!;
    assert.equal(queueStructuralFingerprint(mid), fp);
    assert.equal(new Set(mid.queue.map((w) => w.id)).size, mid.queue.length);
    passes += 1;
  }
  assert.equal(mid.status, "completed");
  assert.equal(mid.validationState, "passed");
  const order = mid.queue.map((w) => w.role);
  const iImpl = order.indexOf("implementer");
  const iRev = order.indexOf("reviewer");
  const iVal = order.indexOf("validator");
  assert.ok(iImpl >= 0 && iRev > iImpl && iVal > iRev);
});

test("contract: post-approval reviewer operator abort then resumeMission to completed", async () => {
  const tool = async (_mid: string, call: ToolCall): Promise<ToolResult> => {
    if (call.args.__approved) return { ok: true, summary: "ok" };
    return {
      ok: false,
      summary: "n",
      requiresApproval: { kind: "write_file" as const, title: "Approve", details: "d" }
    };
  };
  const { orchestrator, store } = await createOrchestratorWithAbortSupport(
    {
      planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
      implementer: [{ summary: "W.", toolCalls: [{ tool: "write_file", args: { path: "x.txt", content: "y" } }] }],
      reviewer: ["abort_operator", { summary: "LGTM.", toolCalls: [] }],
      validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
    },
    tool
  );
  const m = await store.create("Post-appr-abort", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  const pending = store.get(m.id)!.approvals.find((a) => a.status === "pending");
  assert.ok(pending);

  await orchestrator.resolveApproval(m.id, pending.id, true);
  await awaitMissionRunLoopIdle(orchestrator, m.id);
  let mid = store.get(m.id)!;
  const fp = queueStructuralFingerprint(mid);
  assert.equal(mid.status, "blocked");
  assert.ok(mid.blocker?.includes("operator abort") || mid.queue.some((w) => w.output?.includes("operator abort")));
  assert.ok(mid.approvals.some((a) => a.status === "approved"));
  assert.ok(hasRequiredUnresolvedWork(mid));

  await orchestrator.resumeMission(m.id);
  await awaitMissionRunLoopIdle(orchestrator, m.id);
  mid = store.get(m.id)!;
  assert.equal(queueStructuralFingerprint(mid), fp);
  if (mid.status !== "completed") {
    await orchestrator.runMission(m.id);
    await awaitMissionRunLoopIdle(orchestrator, m.id);
    mid = store.get(m.id)!;
  }
  assert.equal(mid.status, "completed");
  assert.equal(mid.validationState, "passed");
});

test("contract: rejected approval then resumeMission stays blocked with unresolved required work", async () => {
  const tool = async (_mid: string, _call: ToolCall): Promise<ToolResult> => ({
    ok: false,
    summary: "n",
    requiresApproval: { kind: "write_file" as const, title: "Reject path", details: "d" }
  });
  const agent = roleScript({
    planner: [
      { summary: "Plan.", nextWorkItems: buildStandardNextQueue() },
      { summary: "Replan (no-op).", nextWorkItems: [] }
    ],
    implementer: [{ summary: "W.", toolCalls: [{ tool: "write_file", args: { path: "z.txt", content: "1" } }] }],
    reviewer: [{ summary: "R", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, tool);
  const m = await store.create("Reject-resume", "p", "ollama", undefined, {
    ...balancedIntegrationPolicy,
    /** Avoid closure-gap replans while downstream is gated by rejected approval. */
    minCompletedWorkItems: 1,
    requireImplementerBeforeComplete: false
  });
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  const pending = store.get(m.id)!.approvals.find((a) => a.status === "pending");
  assert.ok(pending);
  await orchestrator.resolveApproval(m.id, pending.id, false, "no thanks");
  let mid = store.get(m.id)!;
  assert.equal(mid.approvals.find((a) => a.id === pending.id)?.status, "rejected");
  const fp = queueStructuralFingerprint(mid);

  await orchestrator.resumeMission(m.id);
  await awaitMissionRunLoopIdle(orchestrator, m.id);
  mid = store.get(m.id)!;
  assert.ok(["blocked", "queued", "failed"].includes(mid.status));
  assert.notEqual(mid.status, "completed");
  assert.ok(mid.queue.some((w) => w.role === "implementer" && (w.status === "blocked" || w.status === "failed")));
  assert.equal(queueStructuralFingerprint(mid), fp);
  assert.equal(new Set(mid.queue.map((w) => w.id)).size, mid.queue.length);
  // With downstream gating active after rejected approval, validator should not run to "passed" while implementer is blocked/failed.
  assert.notEqual(mid.validationState, "passed");

  await orchestrator.resumeMission(m.id);
  await awaitMissionRunLoopIdle(orchestrator, m.id);
  mid = store.get(m.id)!;
  assert.ok(["blocked", "queued", "failed"].includes(mid.status));
  assert.notEqual(mid.status, "completed");
  assert.ok(mid.queue.some((w) => w.role === "implementer" && (w.status === "blocked" || w.status === "failed")));
});

test("contract: after reject, interrupted running on queue is recovered; rejected approval rows preserved", async () => {
  const tool = async (_mid: string, _call: ToolCall): Promise<ToolResult> => ({
    ok: false,
    summary: "n",
    requiresApproval: { kind: "write_file" as const, title: "Reject path", details: "d" }
  });
  const agent = roleScript({
    planner: [
      { summary: "Plan.", nextWorkItems: buildStandardNextQueue() },
      { summary: "Replan (no-op).", nextWorkItems: [] }
    ],
    implementer: [{ summary: "W.", toolCalls: [{ tool: "write_file", args: { path: "z.txt", content: "1" } }] }],
    reviewer: [{ summary: "R", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, tool);
  const m = await store.create("Reject-recover", "p", "ollama", undefined, {
    ...balancedIntegrationPolicy,
    /** Avoid closure-gap replans while downstream is gated by rejected approval. */
    minCompletedWorkItems: 1,
    requireImplementerBeforeComplete: false
  });
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  const pending = store.get(m.id)!.approvals.find((a) => a.status === "pending");
  assert.ok(pending);
  await orchestrator.resolveApproval(m.id, pending.id, false, "no");
  let mid = store.get(m.id)!;
  const rejectedId = pending.id;
  const q = structuredClone(mid.queue);
  const rev = q.find((w) => w.role === "reviewer" && w.status === "todo");
  assert.ok(rev);
  rev!.status = "running";
  rev!.output = "simulated crash mid-stream";
  await store.updateMission(m.id, { status: "queued", queue: q, blocker: undefined });

  await orchestrator.resumeMission(m.id);
  await awaitMissionRunLoopIdle(orchestrator, m.id);
  mid = store.get(m.id)!;
  assert.equal(mid.approvals.find((a) => a.id === rejectedId)?.status, "rejected");
  assert.ok(mid.queue.every((w) => w.status !== "running"));
  assert.ok(["blocked", "queued", "failed"].includes(mid.status));
  assert.ok(mid.queue.some((w) => w.role === "implementer" && (w.status === "blocked" || w.status === "failed")));
});

test("contract: remediation mission with maxSteps uses resumeMission without duplicate queue ids", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 2);
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [
      { summary: "Initial implementation.", toolCalls: [] },
      { summary: "Remediation bounded fix.", toolCalls: [] }
    ],
    reviewer: [
      { summary: "We have a defect in the public API; must fix before ship.", toolCalls: [] },
      { summary: "Looks good; ready for validation.", toolCalls: [] }
    ],
    validator: [
      { summary: "COMPLETE: main line ok; follow-ups queued.", decision: "complete", toolCalls: [] },
      { summary: "COMPLETE:", decision: "complete", toolCalls: [] }
    ]
  });
  const { orchestrator, store } = await createOrchestrator(agent, noopTool);
  const m = await store.create("Rem-resume", "p", "ollama", undefined, {
    ...balancedIntegrationPolicy,
    minCompletedWorkItems: 6,
    maxAutoRounds: 48
  });
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  let mid = store.get(m.id)!;
  const idSet0 = new Set(mid.queue.map((w) => w.id));
  let passes = 0;
  while (mid.status !== "completed" && passes < 40) {
    if (mid.status === "queued") await orchestrator.resumeMission(m.id);
    else await orchestrator.runMission(m.id);
    await awaitMissionRunLoopIdle(orchestrator, m.id);
    mid = store.get(m.id)!;
    assert.equal(new Set(mid.queue.map((w) => w.id)).size, mid.queue.length);
    for (const id of idSet0) assert.ok(mid.queue.some((w) => w.id === id));
    passes += 1;
  }
  assert.equal(mid.status, "completed");
  assert.equal(mid.validationState, "passed");
  assert.ok(mid.events.some((e) => e.source === "reviewer-contract"));
  assert.ok(mid.queue.some((w) => w.title.includes("Reviewer remediation")));
  assert.ok(!hasRequiredUnresolvedWork(mid));
});

test("contract: duplicate resumeMission while queued does not duplicate queue entries", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 1);
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "I", toolCalls: [] }],
    reviewer: [{ summary: "R", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, noopTool);
  const m = await store.create("Dbl-resume", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  const mid = store.get(m.id)!;
  assert.equal(mid.status, "queued");
  const fp = queueStructuralFingerprint(mid);
  const n0 = mid.queue.length;
  await orchestrator.resumeMission(m.id);
  await orchestrator.resumeMission(m.id);
  const after = store.get(m.id)!;
  assert.equal(after.queue.length, n0);
  assert.equal(queueStructuralFingerprint(after), fp);
});
