import test from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import { uid } from "../util";
import {
  awaitMissionRunLoopIdle,
  balancedIntegrationPolicy,
  buildStandardNextQueue,
  createOrchestrator,
  createOrchestratorWithAbortSupport,
  roleScript
} from "./missionOrchestratorTestHarness";

const noopTool = async () => ({ ok: true as const, summary: "noop" });
const testVscode = vscode as typeof vscode & {
  __setTestConfig?: (key: string, value: unknown) => void;
  __clearTestConfig?: () => void;
};

test("history: blocked work item checkpoint and mirrored memory do not falsely say completed", async () => {
  testVscode.__setTestConfig?.("myAi.missions.autoCheckpointEveryStep", true);
  try {
    const { orchestrator, store } = await createOrchestrator(
      roleScript({
        implementer: [{ summary: "Human review required after bounded change.", markStatus: "blocked", toolCalls: [] }]
      }),
      noopTool
    );
    const m = await store.create("checkpoint-blocked-truth", "p", "ollama", undefined, {
      ...balancedIntegrationPolicy,
      minCompletedWorkItems: 1,
      requireReviewerBeforeComplete: false,
      requireValidatorBeforeComplete: false
    });
    await store.enqueue(m.id, [
      { id: uid("work"), title: "Implementation tranche", role: "implementer", status: "todo", prompt: "Implement." }
    ]);

    await orchestrator.runMission(m.id);
    await awaitMissionRunLoopIdle(orchestrator, m.id);
    const fin = store.get(m.id)!;

    assert.equal(fin.status, "blocked");
    const lastCheckpoint = fin.checkpoints.at(-1);
    assert.ok(lastCheckpoint);
    assert.equal(lastCheckpoint!.summary, "implementer blocked: Implementation tranche");
    assert.equal(lastCheckpoint!.queueSnapshot.find((w) => w.role === "implementer")?.status, "blocked");
    const checkpointMemory = [...fin.memory].reverse().find((m) => m.kind === "checkpoint");
    assert.ok(checkpointMemory);
    assert.equal(checkpointMemory!.text, "implementer blocked: Implementation tranche");
    assert.doesNotMatch(checkpointMemory!.text, /completed:/i);
  } finally {
    testVscode.__clearTestConfig?.();
  }
});

test("history: approval required then rejected records truthful events and no downstream success-like checkpoint", async () => {
  const tool = async () => ({
    ok: false as const,
    summary: "approval required",
    requiresApproval: { kind: "write_file" as const, title: "Approve write to x.txt", details: "diff" }
  });
  const { orchestrator, store } = await createOrchestrator(
    roleScript({
      planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
      implementer: [{ summary: "Need approval before applying change.", toolCalls: [{ tool: "write_file", args: { path: "x.txt", content: "1" } }] }]
    }),
    tool
  );
  const m = await store.create("approval-reject-history", "p", "ollama", undefined, {
    ...balancedIntegrationPolicy,
    minCompletedWorkItems: 1,
    requireImplementerBeforeComplete: false
  });
  await store.enqueue(m.id, [{ id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }]);

  await orchestrator.runMission(m.id);
  let mid = store.get(m.id)!;
  assert.equal(mid.status, "awaiting_input");
  assert.ok(mid.events.some((e) => e.source === "approval" && /Approval required:/i.test(e.message)));

  const pending = mid.approvals.find((a) => a.status === "pending");
  assert.ok(pending);
  await orchestrator.resolveApproval(m.id, pending!.id, false, "no");
  await awaitMissionRunLoopIdle(orchestrator, m.id);
  mid = store.get(m.id)!;

  assert.equal(mid.status, "blocked");
  assert.equal(mid.blockReasonCode, "approval_rejected");
  assert.ok(mid.events.some((e) => e.source === "approval" && /Rejected:/i.test(e.message)));
  assert.ok(mid.checkpoints.every((cp) => !/implementer completed:/i.test(cp.summary)));
  assert.ok(mid.memory.every((mem) => !(mem.kind === "checkpoint" && /implementer completed:/i.test(mem.text))));
});

test("history: approval, operator abort, resume, and completion remain coherent", async () => {
  testVscode.__setTestConfig?.("myAi.missions.autoCheckpointEveryStep", true);
  try {
    const tool = async (_mid: string, call: { args: Record<string, unknown> }) => {
      if (call.args.__approved) return { ok: true as const, summary: "write ok" };
      return {
        ok: false as const,
        summary: "approval required",
        requiresApproval: { kind: "write_file" as const, title: "Approve bounded write", details: "diff" }
      };
    };
    const { orchestrator, store } = await createOrchestratorWithAbortSupport(
      {
        planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
        implementer: [{ summary: "Implement bounded change.", toolCalls: [{ tool: "write_file", args: { path: "x.txt", content: "1" } }] }],
        reviewer: ["abort_operator", { summary: "Looks good after resume.", toolCalls: [] }],
        validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
      },
      tool as any
    );
    const m = await store.create("mixed-history-complete", "p", "ollama", undefined, balancedIntegrationPolicy);
    await store.enqueue(m.id, [{ id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }]);

    await orchestrator.runMission(m.id);
    let mid = store.get(m.id)!;
    const pending = mid.approvals.find((a) => a.status === "pending");
    assert.ok(pending);
    await orchestrator.resolveApproval(m.id, pending!.id, true);
    await awaitMissionRunLoopIdle(orchestrator, m.id);
    mid = store.get(m.id)!;
    assert.equal(mid.status, "blocked");
    assert.ok(mid.events.some((e) => /aborted by operator/i.test(e.message)));

    let passes = 0;
    while (mid.status !== "completed" && passes < 8) {
      await orchestrator.resumeMission(m.id);
      await awaitMissionRunLoopIdle(orchestrator, m.id);
      mid = store.get(m.id)!;
      const status = String(mid.status);
      if (status === "completed") break;
      if (status === "blocked") continue;
      if (status !== "queued") throw new Error(`unexpected status ${mid.status}`);
      passes += 1;
    }

    assert.equal(mid.status, "completed");
    assert.ok(mid.events.some((e) => e.source === "approval" && /Approved:/i.test(e.message)));
    assert.ok(mid.events.some((e) => /Work item LLM stream aborted by operator/i.test(e.message)));
    assert.equal(mid.checkpoints.at(-1)?.summary, "validator completed: Validation tranche");
  } finally {
    testVscode.__clearTestConfig?.();
  }
});

test("history: pass-limit queued mission records resumable event without blocked/failure evidence drift", async () => {
  const { orchestrator, store } = await createOrchestrator(
    roleScript({
      planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
      implementer: [{ summary: "Done impl.", toolCalls: [] }],
      reviewer: [{ summary: "Review ok.", toolCalls: [] }],
      validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
    }),
    noopTool
  );
  testVscode.__setTestConfig?.("myAi.missions.maxStepsPerRun", 1);
  testVscode.__setTestConfig?.("myAi.missions.autoCheckpointEveryStep", true);
  try {
    const m = await store.create("pass-limit-history", "p", "ollama", undefined, balancedIntegrationPolicy);
    await store.enqueue(m.id, [{ id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }]);
    await orchestrator.runMission(m.id);
    const mid = store.get(m.id)!;
    assert.equal(mid.status, "queued");
    assert.ok(mid.events.some((e) => /maxStepsPerRun/i.test(e.message) && /resumable/i.test(e.message)));
    assert.ok(mid.checkpoints.at(-1)?.summary.includes("planner completed"));
    assert.ok(!mid.events.some((e) => /manual review/i.test(e.message)));
    assert.ok(!mid.events.some((e) => /Approval required:/i.test(e.message)));
  } finally {
    testVscode.__clearTestConfig?.();
  }
});
