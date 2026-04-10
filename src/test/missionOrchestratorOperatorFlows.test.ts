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
  buildImplRevValPlusLateImplementerQueue,
  buildStandardNextQueue,
  buildTwoImplThenReviewValidateQueue,
  createOrchestrator,
  queueStructuralFingerprint,
  roleScript,
  runMissionUntilCompleted,
  type VscodeTestApi
} from "./missionOrchestratorTestHarness";

beforeEach(() => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

afterEach(() => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

test("operator flow: approval — status chain, approved tool, reviewer/validator, completed queue", async () => {
  const tool = async (_mid: string, call: ToolCall): Promise<ToolResult> => {
    if (call.args.__approved) return { ok: true, summary: "write applied" };
    return {
      ok: false,
      summary: "pending approval",
      requiresApproval: { kind: "write_file", title: "Confirm workspace write", details: "mutating" }
    };
  };
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [
      {
        summary: "Edit file.",
        toolCalls: [{ tool: "write_file", args: { path: "out.txt", content: "hello" } }]
      }
    ],
    reviewer: [{ summary: "LGTM after approval path.", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, tool);
  const m = await store.create("Op-approve-chain", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  assert.equal(store.get(m.id)!.status, "queued");
  await orchestrator.runMission(m.id);
  const mid = store.get(m.id)!;
  assert.equal(mid.status, "awaiting_input");
  assert.equal(mid.validationState, "failed");
  const pending = mid.approvals.filter((a) => a.status === "pending");
  assert.equal(pending.length, 1);
  assert.equal(pending[0].title, "Confirm workspace write");
  const implBlocked = mid.queue.find((w) => w.role === "implementer" && w.status === "awaiting_approval");
  assert.ok(implBlocked?.output?.includes("Pending approval"));
  assert.ok(hasRequiredUnresolvedWork(mid));

  await orchestrator.resolveApproval(m.id, pending[0].id, true, "ok");
  await awaitMissionRunLoopIdle(orchestrator, m.id);
  const fin = store.get(m.id)!;
  assert.equal(fin.status, "completed");
  assert.equal(fin.validationState, "passed");
  assert.ok(fin.approvals.every((a) => a.status !== "pending"));
  assert.ok(fin.approvals.some((a) => a.status === "approved"));
  const implDone = fin.queue.find((w) => w.role === "implementer" && w.status === "done");
  assert.ok(implDone?.output?.includes("Approved and executed"));
  const order = fin.queue.map((w) => w.role);
  const firstImpl = order.indexOf("implementer");
  const firstRev = order.indexOf("reviewer");
  const firstVal = order.indexOf("validator");
  assert.ok(firstImpl >= 0 && firstRev > firstImpl && firstVal > firstRev);
  assert.ok(fin.queue.every((w) => w.status === "done" || w.status === "skipped"));
  assert.equal(fin.completionReason, undefined);
});

test("operator flow: approval rejection — blocked mission, rejected approval, no completion", async () => {
  const tool = async (_mid: string, _call: ToolCall): Promise<ToolResult> => ({
    ok: false,
    summary: "need approval",
    requiresApproval: { kind: "write_file", title: "Reject me", details: "x" }
  });
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [
      {
        summary: "Try write.",
        toolCalls: [{ tool: "write_file", args: { path: "z.txt", content: "1" } }]
      }
    ],
    reviewer: [{ summary: "Would review", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, tool);
  const m = await store.create("Op-reject", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  let mid = store.get(m.id)!;
  assert.equal(mid.status, "awaiting_input");
  const pending = mid.approvals.find((a) => a.status === "pending");
  assert.ok(pending);
  await orchestrator.resolveApproval(m.id, pending!.id, false, "operator declined");
  mid = store.get(m.id)!;
  assert.equal(mid.status, "blocked");
  assert.equal(mid.validationState, "failed");
  assert.equal(mid.blocker, "operator declined");
  assert.equal(mid.approvals.find((a) => a.id === pending!.id)?.status, "rejected");
  const impl = mid.queue.find((w) => w.role === "implementer");
  assert.equal(impl?.status, "blocked");
  assert.notEqual(mid.status, "completed");
  assert.ok(mid.queue.some((w) => w.status === "todo"));
});

test("operator flow: reviewer defect → injected remediation → full chain to completed", async () => {
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
  const { orchestrator, store } = await createOrchestrator(agent, async () => ({ ok: true, summary: "noop" }));
  const m = await store.create("Op-remediation-e2e", "p", "ollama", undefined, {
    ...balancedIntegrationPolicy,
    minCompletedWorkItems: 6,
    maxAutoRounds: 40
  });
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  const fin = await runMissionUntilCompleted(orchestrator, store, m.id, 24);
  assert.equal(fin.status, "completed");
  assert.equal(fin.validationState, "passed");
  assert.ok(fin.events.some((e) => e.source === "reviewer-contract"));
  assert.ok(fin.queue.some((w) => w.title.includes("Reviewer remediation")));
  const implDone = fin.queue.filter((w) => w.role === "implementer" && w.status === "done");
  assert.ok(implDone.length >= 2);
  assert.ok(fin.queue.every((w) => w.status === "done" || w.status === "skipped"));
  assert.ok(!hasRequiredUnresolvedWork(fin));
});

test("operator flow: recovery + obsolescent tail on longer queue — resume implementer then complete", async () => {
  const agent = roleScript({
    implementer: [{ summary: "Resumed body of work.", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, async () => ({ ok: true, summary: "noop" }));
  const m = await store.create("Op-long-recover", "p", "ollama", undefined, {
    ...balancedIntegrationPolicy,
    minCompletedWorkItems: 4,
    requireValidatorBeforeComplete: false
  });
  const raw = [
    {
      id: "p1",
      title: "Plan",
      role: "planner" as const,
      status: "done" as const,
      prompt: "p",
      output: "ok"
    },
    {
      id: "ia",
      title: "Impl a",
      role: "implementer" as const,
      status: "done" as const,
      prompt: "p",
      output: "ok"
    },
    {
      id: "ra",
      title: "Rev a",
      role: "reviewer" as const,
      status: "done" as const,
      prompt: "p",
      output: "ok"
    },
    {
      id: "va",
      title: "Val",
      role: "validator" as const,
      status: "done" as const,
      prompt: "p",
      output: "passed"
    },
    {
      id: "ib",
      title: "Impl b",
      role: "implementer" as const,
      status: "running" as const,
      prompt: "p",
      output: "was running"
    },
    {
      id: "rt",
      title: "Tail reviewer",
      role: "reviewer" as const,
      status: "running" as const,
      prompt: "p",
      output: "stale"
    }
  ];
  const { queue } = recoverInterruptedQueueItems(raw);
  await store.updateMission(m.id, {
    status: "queued",
    validationState: "passed",
    queue,
    blocker: undefined
  });
  const fpBefore = queueStructuralFingerprint(store.get(m.id)!);
  await orchestrator.runMission(m.id);
  const fin = store.get(m.id)!;
  assert.equal(queueStructuralFingerprint(fin), fpBefore);
  assert.equal(fin.status, "completed");
  assert.equal(fin.queue.find((w) => w.id === "ib")?.status, "done");
  assert.equal(fin.queue.find((w) => w.id === "rt")?.status, "skipped");
  assert.ok(String(fin.queue.find((w) => w.id === "rt")?.output).includes("superseded"));
  assert.equal(fin.validationState, "passed");
});

test("operator flow: mixed ALREADY_SATISFIED + real tool — staged runs, no early completion, precedence reason", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 2);
  const tool = async (_mid: string, call: ToolCall): Promise<ToolResult> => {
    if (call.tool === "write_file") return { ok: true, summary: "wrote real bytes" };
    return { ok: true, summary: "noop" };
  };
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildTwoImplThenReviewValidateQueue() }],
    implementer: [
      {
        summary: "ALREADY_SATISFIED: first tranche present\n",
        toolCalls: []
      },
      {
        summary: "Real edit.",
        toolCalls: [{ tool: "write_file", args: { path: "a.txt", content: "mutation" } }]
      }
    ],
    reviewer: [{ summary: "LGTM both tranches.", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, tool);
  const m = await store.create("Op-mix-sat", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  const mid = store.get(m.id)!;
  assert.equal(mid.status, "queued");
  assert.equal(mid.validationState, "pending");
  assert.ok(mid.queue.find((w) => w.id === "wi-impl-a")?.status === "done");
  assert.ok(mid.queue.find((w) => w.id === "wi-impl-b")?.status === "todo");
  assert.ok(hasRequiredUnresolvedWork(mid));
  assert.notEqual(mid.status, "completed");

  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 32);
  await orchestrator.runMission(m.id);
  const fin = store.get(m.id)!;
  assert.equal(fin.status, "completed");
  assert.equal(fin.validationState, "passed");
  assert.equal(fin.completionReason, "already_satisfied_no_tool_run");
  const a = fin.queue.find((w) => w.id === "wi-impl-a");
  const b = fin.queue.find((w) => w.id === "wi-impl-b");
  assert.equal(a?.completionKind, "already_satisfied");
  assert.equal(b?.completionKind, undefined);
  assert.ok(b?.output?.includes("Real edit"));
});

test("operator flow: mixed apply_patch_noop + real write — per-item completionKind stays honest", async () => {
  const tool = async (_mid: string, call: ToolCall): Promise<ToolResult> => {
    if (call.tool === "applyPatch") {
      return { ok: true, summary: "replace already on disk", applyPatchNoop: true };
    }
    return { ok: true, summary: "real write" };
  };
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildTwoImplThenReviewValidateQueue() }],
    implementer: [
      {
        summary: "No-op patch.",
        toolCalls: [{ tool: "applyPatch", args: { patch: "@@\n-old\n+new" } }]
      },
      {
        summary: "Real file.",
        toolCalls: [{ tool: "write_file", args: { path: "w.txt", content: "content-here" } }]
      }
    ],
    reviewer: [{ summary: "LGTM.", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, tool);
  const m = await store.create("Op-mix-noop", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  const fin = store.get(m.id)!;
  assert.equal(fin.status, "completed");
  const first = fin.queue.find((w) => w.id === "wi-impl-a");
  const second = fin.queue.find((w) => w.id === "wi-impl-b");
  assert.equal(first?.completionKind, "apply_patch_noop");
  assert.notEqual(second?.completionKind, "apply_patch_noop");
  assert.equal(second?.completionKind, undefined);
  assert.equal(fin.completionReason, "apply_patch_noop_success");
});

test("operator flow: stale_patch completionReason beats already_satisfied and apply_patch_noop in one mission", async () => {
  const tool = async (_mid: string, call: ToolCall): Promise<ToolResult> => {
    if (call.tool === "applyPatch" && call.args.patch === "late-stale") {
      return { ok: false, summary: "search text not found in buffer" };
    }
    return { ok: true, summary: "noop patch ok", applyPatchNoop: true };
  };
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildImplRevValPlusLateImplementerQueue() }],
    implementer: [
      {
        summary: "ALREADY_SATISFIED: early tranche\n",
        toolCalls: []
      },
      {
        summary: "Late tranche: noop patch then stale miss.",
        toolCalls: [
          { tool: "applyPatch", args: { patch: "noopish" } },
          { tool: "applyPatch", args: { patch: "late-stale" } }
        ]
      }
    ],
    reviewer: [{ summary: "LGTM early work.", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, tool);
  const m = await store.create("Op-precedence", "p", "ollama", undefined, {
    ...balancedIntegrationPolicy,
    minCompletedWorkItems: 5,
    maxAutoRounds: 32
  });
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  const fin = store.get(m.id)!;
  assert.equal(fin.status, "completed");
  assert.equal(fin.completionReason, "stale_patch_but_goal_already_met");
  assert.ok(fin.queue.some((w) => w.completionKind === "already_satisfied"));
  assert.ok(fin.queue.some((w) => w.completionKind === "apply_patch_noop"));
});

test("operator flow: many maxStepsPerRun resumes — stable queue shape, validator passed only when truly done", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 2);
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "I", toolCalls: [] }],
    reviewer: [{ summary: "R", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, async () => ({ ok: true, summary: "noop" }));
  const m = await store.create("Op-multi-resume", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  let last = store.get(m.id)!;
  assert.equal(last.status, "queued");
  const structural = queueStructuralFingerprint(last);
  const idSet = new Set(last.queue.map((w) => w.id));
  let passes = 1;
  while (passes < 20 && last.status !== "completed") {
    await orchestrator.runMission(m.id);
    last = store.get(m.id)!;
    assert.equal(queueStructuralFingerprint(last), structural);
    assert.equal(new Set(last.queue.map((w) => w.id)).size, idSet.size);
    for (const id of idSet) assert.ok(last.queue.some((w) => w.id === id));
    if (last.status !== "completed") {
      assert.equal(last.status, "queued");
      assert.notEqual(last.validationState, "passed");
      assert.ok(last.events.some((e) => e.message.includes("maxStepsPerRun")));
    }
    passes += 1;
  }
  assert.equal(last.status, "completed");
  assert.equal(last.validationState, "passed");
  assert.ok(passes >= 2);
});
