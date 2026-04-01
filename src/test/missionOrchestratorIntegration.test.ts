import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import { hasRequiredUnresolvedWork } from "../missions/requiredWork";
import { recoverInterruptedQueueItems } from "../missions/resumeRecovery";
import type { ToolCall } from "../types";
import type { ToolResult } from "../tools/ToolRegistry";
import { uid } from "../util";
import {
  awaitMissionRunLoopIdle,
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

test("MissionOrchestrator: happy path planner → implementer → reviewer → validator → completed", async () => {
  const agent = roleScript({
    planner: [
      {
        summary: "Planned work.",
        nextWorkItems: buildStandardNextQueue()
      }
    ],
    implementer: [{ summary: "Implemented.", toolCalls: [] }],
    reviewer: [{ summary: "Looks good; ready for validation.", toolCalls: [] }],
    validator: [{ summary: "COMPLETE: all good.", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, async () => ({ ok: true, summary: "noop" }));
  const m = await store.create("Happy", "Do it", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    {
      id: uid("work"),
      title: "Initial planning",
      role: "planner",
      status: "todo",
      prompt: "Plan."
    }
  ]);
  await orchestrator.runMission(m.id);
  const fin = store.get(m.id)!;
  assert.equal(fin.status, "completed");
  assert.equal(fin.validationState, "passed");
  assert.ok(fin.queue.every((w) => w.status === "done" || w.status === "skipped"));
  assert.equal(fin.completionReason, undefined);
});

test("MissionOrchestrator: implementer ALREADY_SATISFIED (no tools) still runs reviewer and validator before completed", async () => {
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [
      {
        summary: "ALREADY_SATISFIED: change already on disk\nNothing else.",
        toolCalls: []
      }
    ],
    reviewer: [{ summary: "Reviewed; no blocker.", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, async () => ({ ok: true, summary: "noop" }));
  const m = await store.create("Partial", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  const fin = store.get(m.id)!;
  assert.equal(fin.status, "completed");
  assert.equal(fin.validationState, "passed");
  const imp = fin.queue.find((w) => w.role === "implementer" && w.status === "done");
  assert.equal(imp?.completionKind, "already_satisfied");
  assert.equal(fin.completionReason, "already_satisfied_no_tool_run");
});

test("MissionOrchestrator: stale applyPatch search-not-found with validation already passed → stale_patch_but_goal_already_met and completed", async () => {
  const agent = roleScript({
    implementer: [
      {
        summary: "Try patch.",
        toolCalls: [{ tool: "applyPatch", args: { patch: "x" } }]
      }
    ]
  });
  const { orchestrator, store } = await createOrchestrator(agent, async () => ({
    ok: false,
    summary: "search text not found in file"
  }));
  const m = await store.create("Stale", "p", "ollama", undefined, {
    minCompletedWorkItems: 1,
    requireReviewerBeforeComplete: false,
    requireValidatorBeforeComplete: false,
    requireImplementerBeforeComplete: true,
    requireValidationEvidence: false,
    closureRequired: true,
    autoContinue: true,
    maxAutoRounds: 12,
    stallReplanThreshold: 2,
    policyPreset: "light"
  });
  await store.updateMission(m.id, {
    validationState: "passed",
    queue: [
      {
        id: "wi-imp",
        title: "Late patch",
        role: "implementer",
        status: "todo",
        prompt: "Patch"
      }
    ]
  });
  await orchestrator.runMission(m.id);
  const fin = store.get(m.id)!;
  assert.equal(fin.status, "completed");
  assert.equal(fin.validationState, "passed");
  assert.equal(fin.completionReason, "stale_patch_but_goal_already_met");
  const imp = fin.queue.find((w) => w.id === "wi-imp");
  assert.equal(imp?.status, "done");
});

test("MissionOrchestrator: recovered running reviewer is demoted when obsolescent; mission completes when gates align", async () => {
  const agent = roleScript({});
  const { orchestrator, store } = await createOrchestrator(agent, async () => ({ ok: true, summary: "noop" }));
  const m = await store.create("Recover", "p", "ollama", undefined, {
    ...balancedIntegrationPolicy,
    minCompletedWorkItems: 2,
    requireValidatorBeforeComplete: false
  });
  const q = [
    {
      id: "r-done",
      title: "First review",
      role: "reviewer" as const,
      status: "done" as const,
      prompt: "r",
      output: "ok"
    },
    {
      id: "r-run",
      title: "Tail review",
      role: "reviewer" as const,
      status: "running" as const,
      prompt: "r",
      output: "interrupted"
    }
  ];
  const recovered = recoverInterruptedQueueItems(q).queue;
  await store.updateMission(m.id, {
    status: "queued",
    validationState: "passed",
    queue: recovered,
    blocker: undefined
  });
  await orchestrator.runMission(m.id);
  const fin = store.get(m.id)!;
  assert.equal(fin.status, "completed");
  const tail = fin.queue.find((w) => w.id === "r-run");
  assert.equal(tail?.status, "skipped");
  assert.ok(String(tail?.output).includes("superseded reviewer"));
});

test("MissionOrchestrator: non-recoverable implementer tool failure blocks mission", async () => {
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [
      {
        summary: "Will run tool.",
        toolCalls: [{ tool: "write_file", args: { path: "x.txt", content: "a" } }]
      }
    ]
  });
  const { orchestrator, store } = await createOrchestrator(agent, async () => ({
    ok: false,
    summary: "disk full"
  }));
  const m = await store.create("Fail", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  const fin = store.get(m.id)!;
  assert.equal(fin.status, "blocked");
  assert.equal(fin.validationState, "failed");
  assert.ok(fin.blocker?.includes("write_file"));
  const imp = fin.queue.find((w) => w.role === "implementer" && w.status === "failed");
  assert.ok(imp);
  const todo = fin.queue.filter((w) => w.status === "todo");
  assert.ok(todo.some((w) => w.role === "reviewer" || w.role === "validator"));
});

test("MissionOrchestrator: tool requires approval → awaiting_input; after approval resumes and can complete", async () => {
  let approved = false;
  const tool = async (_mid: string, call: ToolCall): Promise<ToolResult> => {
    if (call.args.__approved) {
      approved = true;
      return { ok: true, summary: "applied after approval" };
    }
    return {
      ok: false,
      summary: "needs human",
      requiresApproval: {
        kind: "write_file",
        title: "Approve write",
        details: "test"
      }
    };
  };
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [
      {
        summary: "Mutate.",
        toolCalls: [{ tool: "write_file", args: { path: "f.txt", content: "z" } }]
      }
    ],
    reviewer: [{ summary: "LGTM", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, tool);
  const m = await store.create("Approve", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  let mid = store.get(m.id)!;
  assert.equal(mid.status, "awaiting_input");
  assert.ok(mid.blocker?.includes("Approve write"));
  const pending = mid.approvals.find((a) => a.status === "pending");
  assert.ok(pending);
  assert.equal(mid.approvals.filter((a) => a.status === "pending").length, 1);
  assert.notEqual(mid.status, "completed");
  const wi = mid.queue.find((w) => w.role === "implementer" && w.status === "blocked");
  assert.ok(wi?.output?.includes("Pending approval"));
  await orchestrator.resolveApproval(m.id, pending!.id, true);
  assert.equal(approved, true);
  await awaitMissionRunLoopIdle(orchestrator, m.id);
  mid = store.get(m.id)!;
  assert.equal(mid.status, "completed");
  assert.equal(mid.validationState, "passed");
  const imp = mid.queue.find((w) => w.role === "implementer" && w.status === "done");
  assert.ok(imp?.output?.includes("Approved and executed"));
});

test("MissionOrchestrator: approval reject blocks mission without approved tool execution", async () => {
  let approvedExecutions = 0;
  const tool = async (_mid: string, call: ToolCall): Promise<ToolResult> => {
    if (call.args.__approved) {
      approvedExecutions += 1;
      return { ok: true, summary: "written after approval" };
    }
    return {
      ok: false,
      summary: "needs human",
      requiresApproval: {
        kind: "write_file",
        title: "Approve write",
        details: "test"
      }
    };
  };
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [
      {
        summary: "Mutate.",
        toolCalls: [{ tool: "write_file", args: { path: "f.txt", content: "z" } }]
      }
    ],
    reviewer: [{ summary: "LGTM", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, tool);
  const m = await store.create("Reject-approval", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  let mid = store.get(m.id)!;
  assert.equal(mid.status, "awaiting_input");
  const pending = mid.approvals.find((a) => a.status === "pending");
  assert.ok(pending);
  await orchestrator.resolveApproval(m.id, pending!.id, false, "operator declined");
  await awaitMissionRunLoopIdle(orchestrator, m.id);
  mid = store.get(m.id)!;
  assert.equal(mid.status, "blocked");
  assert.equal(mid.blockReasonCode, "approval_rejected");
  assert.equal(approvedExecutions, 0);
});

test("MissionOrchestrator: maxStepsPerRun leaves mission queued and a second run finishes", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 3);
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "Impl", toolCalls: [] }],
    reviewer: [{ summary: "Rev", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, async () => ({ ok: true, summary: "noop" }));
  const m = await store.create("Max", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  let mid = store.get(m.id)!;
  assert.equal(mid.status, "queued");
  assert.ok(mid.events.some((e) => e.message.includes("maxStepsPerRun")));
  assert.ok(mid.queue.some((w) => w.role === "validator" && w.status === "todo"));
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 32);
  await orchestrator.runMission(m.id);
  mid = store.get(m.id)!;
  assert.equal(mid.status, "completed");
  assert.equal(mid.validationState, "passed");
});

test("MissionOrchestrator: reviewer ALREADY_SATISFIED skips auto-remediation; defect wording still injects remediation", async () => {
  const agentSatisfied = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "Done", toolCalls: [] }],
    reviewer: [
      {
        summary: "ALREADY_SATISFIED: nothing to review\nClean.",
        toolCalls: []
      }
    ],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator: o1, store: s1 } = await createOrchestrator(agentSatisfied, async () => ({
    ok: true,
    summary: "noop"
  }));
  const m1 = await s1.create("Rem-sat", "p", "ollama", undefined, balancedIntegrationPolicy);
  await s1.enqueue(m1.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await o1.runMission(m1.id);
  const fin1 = s1.get(m1.id)!;
  assert.equal(fin1.status, "completed");
  assert.ok(!fin1.events.some((e) => e.source === "reviewer-contract"));

  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 3);
  const agentDefect = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "Done", toolCalls: [] }],
    reviewer: [
      {
        summary: "Found a defect in the handler; must fix before ship.",
        toolCalls: []
      }
    ]
  });
  const { orchestrator: o2, store: s2 } = await createOrchestrator(agentDefect, async () => ({
    ok: true,
    summary: "noop"
  }));
  const m2 = await s2.create("Rem-def", "p", "ollama", undefined, balancedIntegrationPolicy);
  await s2.enqueue(m2.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await o2.runMission(m2.id);
  const fin2 = s2.get(m2.id)!;
  assert.equal(fin2.status, "queued");
  assert.ok(fin2.events.some((e) => e.source === "reviewer-contract"));
  assert.ok(
    fin2.queue.some((w) => w.role === "implementer" && w.title.includes("Reviewer remediation"))
  );
  assert.ok(hasRequiredUnresolvedWork(fin2));
});

test("MissionOrchestrator: applyPatch deterministic no-op sets apply_patch_noop completion when validation completes", async () => {
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [
      {
        summary: "Apply noop patch.",
        toolCalls: [{ tool: "applyPatch", args: { patch: "noop" } }]
      }
    ],
    reviewer: [{ summary: "OK", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, async () => ({
    ok: true,
    summary: "replace already present",
    applyPatchNoop: true
  }));
  const m = await store.create("Noop", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  const fin = store.get(m.id)!;
  assert.equal(fin.status, "completed");
  const imp = fin.queue.find((w) => w.role === "implementer" && w.status === "done");
  assert.equal(imp?.completionKind, "apply_patch_noop");
  assert.equal(fin.completionReason, "apply_patch_noop_success");
});
