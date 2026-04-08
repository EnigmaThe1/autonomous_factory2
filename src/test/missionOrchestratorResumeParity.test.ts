import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import { recoverInterruptedQueueItems, requeueOperatorStreamAbortedWorkItems } from "../missions/resumeRecovery";
import type { Mission, ToolCall, WorkItem } from "../types";
import type { MissionOrchestrator } from "../missions/MissionOrchestrator";
import type { MissionStore } from "../missions/MissionStore";
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

const noop = async () => ({ ok: true, summary: "noop" });

/** Mirrors `resumeMission` queue normalization without persistence events (for parity checks). */
async function lowerLevelResumeThenRun(
  store: MissionStore,
  orchestrator: MissionOrchestrator,
  missionId: string
): Promise<void> {
  const mission = store.get(missionId)!;
  const recovered = recoverInterruptedQueueItems(mission.queue);
  const queue = requeueOperatorStreamAbortedWorkItems(recovered.queue);
  await store.updateMission(missionId, {
    status: "queued",
    blocker: undefined,
    queue
  });
  await orchestrator.runMission(missionId);
}

function _queueRoleStatusSignature(m: Mission): string {
  return m.queue.map((w) => `${w.id}:${w.role}:${w.status}`).join("|");
}

function assertQueueWorkParallel(m1: Mission, m2: Mission): void {
  assert.equal(m1.queue.length, m2.queue.length);
  for (let i = 0; i < m1.queue.length; i++) {
    assert.equal(m1.queue[i]!.role, m2.queue[i]!.role);
    assert.equal(m1.queue[i]!.status, m2.queue[i]!.status);
    assert.equal(m1.queue[i]!.title, m2.queue[i]!.title);
  }
}

test("resume parity: interrupted running recovery matches lower-level recover + runMission", async () => {
  const mkAgent = () =>
    roleScript({
      implementer: [{ summary: "Finished after recovery.", toolCalls: [] }]
    });
  const { orchestrator: o1, store: s1 } = await createOrchestrator(mkAgent(), noop);
  const { orchestrator: o2, store: s2 } = await createOrchestrator(mkAgent(), noop);
  const baseQueue: WorkItem[] = [
    {
      id: "p0",
      title: "Plan",
      role: "planner",
      status: "done",
      prompt: "p",
      output: "ok"
    },
    {
      id: "i0",
      title: "Impl",
      role: "implementer",
      status: "running",
      prompt: "p",
      output: "was running"
    }
  ];
  const m1 = await s1.create("Parity-a", "p", "ollama", undefined, {
    ...balancedIntegrationPolicy,
    minCompletedWorkItems: 2,
    requireValidatorBeforeComplete: false,
    requireReviewerBeforeComplete: false
  });
  const m2 = await s2.create("Parity-b", "p", "ollama", undefined, {
    ...balancedIntegrationPolicy,
    minCompletedWorkItems: 2,
    requireValidatorBeforeComplete: false,
    requireReviewerBeforeComplete: false
  });
  await s1.updateMission(m1.id, { status: "queued", validationState: "passed", queue: structuredClone(baseQueue) });
  await s2.updateMission(m2.id, { status: "queued", validationState: "passed", queue: structuredClone(baseQueue) });

  await lowerLevelResumeThenRun(s1, o1, m1.id);
  await o2.resumeMission(m2.id);

  const a = s1.get(m1.id)!;
  const b = s2.get(m2.id)!;
  assertQueueWorkParallel(a, b);
  assert.equal(a.status, b.status);
  assert.equal(a.validationState, b.validationState);
  assert.equal(a.queue.find((w) => w.id === "i0")?.status, "done");
});

test("resume parity: operator-abort blocked item re-queued; order preserved vs lower-level path", async () => {
  const mkAgent = () =>
    roleScript({
      implementer: [
        { summary: "First.", toolCalls: [] },
        { summary: "Second after abort.", toolCalls: [] }
      ],
      reviewer: [{ summary: "Looks good; ready for validation.", toolCalls: [] }]
    });
  const { orchestrator: o1, store: s1 } = await createOrchestrator(mkAgent(), noop);
  const { orchestrator: o2, store: s2 } = await createOrchestrator(mkAgent(), noop);
  const baseQueue: WorkItem[] = [
    {
      id: "i0",
      title: "A",
      role: "implementer",
      status: "done",
      prompt: "p",
      output: "ok"
    },
    {
      id: "i1",
      title: "B",
      role: "implementer",
      status: "blocked",
      prompt: "p",
      hardStopClass: "operator_abort",
      output: "Model stream cancelled (operator abort)."
    },
    {
      id: "rv",
      title: "Review",
      role: "reviewer",
      status: "todo",
      prompt: "p"
    }
  ];
  const p1 = await s1.create("Op-a", "p", "ollama", undefined, {
    ...balancedIntegrationPolicy,
    minCompletedWorkItems: 3,
    requireValidatorBeforeComplete: false
  });
  const p2 = await s2.create("Op-b", "p", "ollama", undefined, {
    ...balancedIntegrationPolicy,
    minCompletedWorkItems: 3,
    requireValidatorBeforeComplete: false
  });
  await s1.updateMission(p1.id, { status: "blocked", validationState: "passed", queue: structuredClone(baseQueue) });
  await s2.updateMission(p2.id, { status: "blocked", validationState: "passed", queue: structuredClone(baseQueue) });

  await lowerLevelResumeThenRun(s1, o1, p1.id);
  await o2.resumeMission(p2.id);

  const a = s1.get(p1.id)!;
  const b = s2.get(p2.id)!;
  assertQueueWorkParallel(a, b);
  assert.equal(a.status, b.status);
  assert.equal(a.queue.filter((w) => w.role === "implementer" && w.status === "done").length, 2);
  assert.equal(a.queue.find((w) => w.id === "rv")?.status, "done");
});

test("resume parity: maxStepsPerRun queued mission continues to completed via resumeMission", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 2);
  const { orchestrator, store } = await createOrchestrator(
    roleScript({
      planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
      implementer: [{ summary: "I", toolCalls: [] }],
      reviewer: [{ summary: "Looks good; ready for validation.", toolCalls: [] }],
      validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
    }),
    noop
  );
  const m = await store.create("Max-resume", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  let mid = store.get(m.id)!;
  const fp = queueStructuralFingerprint(mid);
  assert.equal(mid.status, "queued");
  assert.ok(mid.events.some((e) => e.message.includes("maxStepsPerRun")));
  assert.ok(!mid.blocker?.includes("operator abort"));

  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 32);
  await orchestrator.resumeMission(m.id);
  assert.equal(orchestrator.isMissionRunLoopActive(m.id), false);
  mid = store.get(m.id)!;
  assert.equal(mid.status, "completed");
  assert.equal(mid.validationState, "passed");
  assert.equal(queueStructuralFingerprint(mid), fp);
});

test("resumeMission on awaiting_input is a no-op (approval gate); after resolveApproval, continuation works", async () => {
  const tool = async (_mid: string, call: ToolCall) => {
    if (call.args.__approved) return { ok: true, summary: "ok" };
    return {
      ok: false,
      summary: "n",
      requiresApproval: { kind: "write_file" as const, title: "Approve", details: "d" }
    };
  };
  const { orchestrator, store } = await createOrchestrator(
    roleScript({
      planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
      implementer: [
        { summary: "W.", toolCalls: [{ tool: "write_file", args: { path: "x.txt", content: "y" } }] }
      ],
      reviewer: [{ summary: "LGTM.", toolCalls: [] }],
      validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
    }),
    tool
  );
  const m = await store.create("Await-resume", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  let mid = store.get(m.id)!;
  assert.equal(mid.status, "awaiting_input");
  const pendingBefore = mid.approvals.filter((a) => a.status === "pending");
  assert.equal(pendingBefore.length, 1);
  const fpBefore = queueStructuralFingerprint(mid);

  await orchestrator.resumeMission(m.id);
  mid = store.get(m.id)!;
  assert.equal(mid.status, "awaiting_input");
  assert.equal(mid.approvals.filter((a) => a.status === "pending").length, 1);
  assert.equal(queueStructuralFingerprint(mid), fpBefore);

  await orchestrator.resolveApproval(m.id, pendingBefore[0]!.id, true);
  await awaitMissionRunLoopIdle(orchestrator, m.id);
  mid = store.get(m.id)!;
  assert.equal(mid.status, "completed");
  assert.equal(mid.validationState, "passed");
  assert.equal(mid.approvals.every((a) => a.status === "approved"), true);
  const remediationTitles = mid.queue.filter((w) => w.title.includes("Reviewer remediation")).length;
  assert.equal(remediationTitles, 0);
});

test("resumeMission on tool-failure blocked does not hide failure; ends blocked again with honest queue", async () => {
  const { orchestrator, store } = await createOrchestrator(
    roleScript({
      planner: [
        { summary: "P.", nextWorkItems: buildStandardNextQueue() },
        { summary: "Replan (no-op).", nextWorkItems: [] }
      ],
      implementer: [
        {
          summary: "T.",
          toolCalls: [{ tool: "write_file", args: { path: "z.txt", content: "1" } }]
        }
      ],
      reviewer: [{ summary: "Looks good; ready for validation.", toolCalls: [] }],
      validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
    }),
    async () => ({ ok: false, summary: "hard fail" })
  );
  const m = await store.create("Tool-block", "p", "ollama", undefined, {
    ...balancedIntegrationPolicy,
    /** Avoid closure-gap replans while downstream is gated by implementer tool failure. */
    minCompletedWorkItems: 1,
    requireImplementerBeforeComplete: false
  });
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  let mid = store.get(m.id)!;
  assert.equal(mid.status, "blocked");
  assert.equal(mid.validationState, "failed");
  const fp = queueStructuralFingerprint(mid);

  await orchestrator.resumeMission(m.id);
  mid = store.get(m.id)!;
  assert.equal(orchestrator.isMissionRunLoopActive(m.id), false);
  assert.ok(["blocked", "queued", "failed"].includes(mid.status));
  assert.ok(mid.queue.some((w) => w.role === "implementer" && w.status === "failed"));
  assert.equal(queueStructuralFingerprint(mid), fp);
});

test("resumeActiveMissions auto-recovers blocked mission with interrupted running work and completes", async () => {
  const { orchestrator, store } = await createOrchestrator(
    roleScript({
      implementer: [{ summary: "Recovered implementer.", toolCalls: [] }],
      reviewer: [{ summary: "Looks good; ready for validation.", toolCalls: [] }],
      validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
    }),
    noop
  );
  const m = await store.create("Startup-recover-running", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.updateMission(m.id, {
    status: "blocked",
    blocker: "Host interrupted during prior run",
    validationState: "pending",
    queue: [
      { id: "p0", title: "Plan", role: "planner", status: "done", prompt: "p", output: "planned" },
      { id: "i0", title: "Implement", role: "implementer", status: "running", prompt: "i", output: "half done" },
      { id: "r0", title: "Review", role: "reviewer", status: "todo", prompt: "r" },
      { id: "v0", title: "Validate", role: "validator", status: "todo", prompt: "v" }
    ]
  });

  await orchestrator.resumeActiveMissions();

  const fin = store.get(m.id)!;
  assert.equal(fin.status, "completed");
  assert.equal(fin.validationState, "passed");
  assert.equal(fin.queue.find((w) => w.id === "i0")?.status, "done");
  assert.ok(
    fin.events.some((e) => e.message.includes("Recovered 1 interrupted running work item")),
    "startup auto-resume should recover stranded running work"
  );
});

test("resumeActiveMissions leaves genuinely blocked tool-failure missions untouched", async () => {
  const { orchestrator, store } = await createOrchestrator(
    async () => {
      throw new Error("resumeActiveMissions should not invoke agent for genuinely blocked work");
    },
    noop
  );
  const m = await store.create("Startup-skip-blocked", "p", "ollama", undefined, {
    ...balancedIntegrationPolicy,
    minCompletedWorkItems: 1,
    requireImplementerBeforeComplete: false
  });
  await store.updateMission(m.id, {
    status: "blocked",
    blocker: "Mission halted after tool failure (writeFile: hard fail)",
    blockReasonCode: "tool_failure",
    validationState: "failed",
    queue: [
      { id: "p0", title: "Plan", role: "planner", status: "done", prompt: "p", output: "planned" },
      { id: "i0", title: "Implement", role: "implementer", status: "failed", prompt: "i", output: "hard fail" },
      { id: "r0", title: "Review", role: "reviewer", status: "todo", prompt: "r" },
      { id: "v0", title: "Validate", role: "validator", status: "todo", prompt: "v" }
    ]
  });
  const before = store.get(m.id)!;
  const beforeFingerprint = queueStructuralFingerprint(before);
  const beforeEvents = before.events.length;
  const beforeBlocker = before.blocker;
  const beforeReason = before.blockReasonCode;

  await orchestrator.resumeActiveMissions();

  const after = store.get(m.id)!;
  assert.equal(after.status, "blocked");
  assert.equal(after.blocker, beforeBlocker);
  assert.equal(after.blockReasonCode, beforeReason);
  assert.equal(after.events.length, beforeEvents);
  assert.equal(queueStructuralFingerprint(after), beforeFingerprint);
});

test("resumeMission completion observability: promise resolves with run loop inactive unless concurrent skip", async () => {
  const { orchestrator, store } = await createOrchestratorWithAbortSupport(
    {
      planner: [
        "abort_operator",
        { summary: "Done.", nextWorkItems: buildStandardNextQueue() }
      ],
      implementer: [{ summary: "Impl ok.", toolCalls: [] }],
      reviewer: [{ summary: "Looks good; ready for validation.", toolCalls: [] }],
      validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
    },
    noop
  );
  const m = await store.create("Obs", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  const p = orchestrator.resumeMission(m.id);
  await p;
  assert.equal(orchestrator.isMissionRunLoopActive(m.id), false);
  const mid = store.get(m.id)!;
  assert.notEqual(mid.status, "running");
});

test("resumeMission idempotence: double resume on completed is safe; double on max-steps queue preserves fingerprint", async () => {
  const agent = roleScript({
    // Two missions in this test each need their own planner turn (shared script index is not reset per mission).
    planner: [
      { summary: "Plan.", nextWorkItems: buildStandardNextQueue() },
      { summary: "Plan.", nextWorkItems: buildStandardNextQueue() }
    ],
    implementer: [
      { summary: "I", toolCalls: [] },
      { summary: "I", toolCalls: [] }
    ],
    reviewer: [
      { summary: "R", toolCalls: [] },
      { summary: "R", toolCalls: [] }
    ],
    validator: [
      { summary: "COMPLETE:", decision: "complete", toolCalls: [] },
      { summary: "COMPLETE:", decision: "complete", toolCalls: [] }
    ]
  });
  const { orchestrator, store } = await createOrchestrator(agent, noop);
  const m = await store.create("Idem", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 32);
  await orchestrator.runMission(m.id);
  let fin = store.get(m.id)!;
  assert.equal(fin.status, "completed");
  const fpDone = queueStructuralFingerprint(fin);
  await orchestrator.resumeMission(m.id);
  await orchestrator.resumeMission(m.id);
  fin = store.get(m.id)!;
  assert.equal(fin.status, "completed");
  assert.equal(queueStructuralFingerprint(fin), fpDone);
  assert.equal(fin.queue.filter((w) => w.title.includes("Reviewer remediation")).length, 0);

  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 1);
  const m2 = await store.create("Idem2", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m2.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m2.id);
  let mid = store.get(m2.id)!;
  const fpQ = queueStructuralFingerprint(mid);
  await orchestrator.resumeMission(m2.id);
  mid = store.get(m2.id)!;
  assert.equal(queueStructuralFingerprint(mid), fpQ);
  await orchestrator.resumeMission(m2.id);
  mid = store.get(m2.id)!;
  assert.equal(queueStructuralFingerprint(mid), fpQ);
});
