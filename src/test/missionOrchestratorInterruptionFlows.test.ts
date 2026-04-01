import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import { hasRequiredUnresolvedWork } from "../missions/requiredWork";
import { recoverInterruptedQueueItems, requeueOperatorStreamAbortedWorkItems } from "../missions/resumeRecovery";
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

test("interruption: operator abort during active run — blocked mission, honest queue, resume re-queues abort item", async () => {
  const { orchestrator, store } = await createOrchestratorWithAbortSupport(
    {
      planner: [
        "abort_operator",
        { summary: "Planned.", nextWorkItems: buildStandardNextQueue() }
      ],
      implementer: [{ summary: "Impl ok.", toolCalls: [] }],
      reviewer: [{ summary: "Looks good; ready for validation.", toolCalls: [] }],
      validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
    },
    noopTool
  );
  const m = await store.create("Abort-active", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  let mid = store.get(m.id)!;
  const plId = mid.queue.find((w) => w.role === "planner")?.id;
  assert.equal(mid.status, "blocked");
  assert.ok(mid.blocker?.includes("operator abort"));
  assert.equal(mid.validationState, "pending");
  assert.notEqual(mid.status, "completed");
  assert.equal(mid.queue.find((w) => w.id === plId)?.status, "blocked");
  assert.ok(mid.queue.find((w) => w.id === plId)?.output?.includes("operator abort"));
  assert.ok(mid.events.some((e) => e.message.includes("aborted by operator")));
  assert.ok(!mid.events.some((e) => e.message.includes("maxStepsPerRun")));

  await orchestrator.resumeMission(m.id);
  mid = store.get(m.id)!;
  assert.ok(mid.events.some((e) => e.message.includes("operator stream abort")));
  const plAfter = mid.queue.find((w) => w.id === plId);
  assert.ok(plAfter?.status === "todo" || plAfter?.status === "done");
  assert.notEqual(mid.status, "blocked");
});

test("interruption: operator abort after partial progress — stable done work, resume completes to validator passed", async () => {
  const { orchestrator, store } = await createOrchestratorWithAbortSupport(
    {
      planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
      implementer: [{ summary: "Impl ok.", toolCalls: [] }],
      reviewer: [
        "abort_operator",
        { summary: "Looks good; ready for validation.", toolCalls: [] }
      ],
      validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
    },
    noopTool
  );
  const m = await store.create("Abort-partial", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  let mid = store.get(m.id)!;
  const structural = queueStructuralFingerprint(mid);
  const plDone = mid.queue.find((w) => w.role === "planner" && w.status === "done");
  const implDone = mid.queue.find((w) => w.role === "implementer" && w.status === "done");
  assert.ok(plDone);
  assert.ok(implDone);
  assert.ok(mid.queue.find((w) => w.role === "reviewer")?.output?.includes("operator abort"));
  assert.equal(mid.status, "blocked");
  assert.ok(mid.queue.some((w) => w.role === "validator" && w.status === "todo"));
  assert.ok(hasRequiredUnresolvedWork(mid));

  await orchestrator.resumeMission(m.id);
  mid = store.get(m.id)!;
  assert.equal(queueStructuralFingerprint(mid), structural);
  assert.equal(mid.queue.find((w) => w.id === plDone?.id)?.status, "done");
  assert.equal(mid.queue.find((w) => w.id === implDone?.id)?.status, "done");

  if (mid.status !== "completed") {
    await orchestrator.runMission(m.id);
    mid = store.get(m.id)!;
  }
  assert.equal(mid.status, "completed");
  assert.equal(mid.validationState, "passed");
  assert.ok(mid.queue.every((w) => w.status === "done" || w.status === "skipped"));
});

test("interruption: timeout-like stream abort — work item failed, same run still drains reviewer/validator; terminal blocked while failed remains", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 32);
  const { orchestrator, store } = await createOrchestratorWithAbortSupport(
    {
      planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
      implementer: ["abort_timeout"],
      reviewer: [{ summary: "LGTM.", toolCalls: [] }],
      validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
    },
    noopTool
  );
  const m = await store.create("Timeout-recover", "p", "ollama", undefined, {
    ...balancedIntegrationPolicy,
    /** Failed implementer is not `done`; closure would otherwise inject another impl and exhaust the scripted agent. */
    requireImplementerBeforeComplete: false,
    /** Planner + reviewer + validator `done` must meet min without counting the failed implementer. */
    minCompletedWorkItems: 3
  });
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  const fin = store.get(m.id)!;
  assert.equal(fin.status, "blocked");
  assert.ok(fin.queue.some((w) => w.role === "implementer" && w.status === "failed"));
  assert.ok(fin.queue.some((w) => w.role === "reviewer" && w.status === "done"));
  assert.ok(fin.queue.some((w) => w.role === "validator" && w.status === "done"));
  assert.equal(fin.validationState, "passed");
  const failedImp = fin.queue.filter((w) => w.role === "implementer" && w.status === "failed");
  assert.equal(failedImp.length, 1);
  assert.ok(failedImp[0].output?.includes("timeout"));
  assert.ok(fin.events.some((e) => e.message.includes("timeout")));
  assert.ok(!fin.events.some((e) => e.message.includes("aborted by operator")));
  assert.ok(
    fin.events.some((e) => e.message.includes("do not treat as successfully shipped")),
    "honesty signal when validator passed coexists with failed implementer"
  );
});

test("interruption: running → recover + requeue operator abort — no duplicate ids, no false completion", async () => {
  const agent = roleScript({
    implementer: [
      { summary: "After recovery (first).", toolCalls: [] },
      { summary: "After recovery (second).", toolCalls: [] }
    ]
  });
  const { orchestrator, store } = await createOrchestrator(agent, noopTool);
  const m = await store.create("Recover-mix", "p", "ollama", undefined, {
    ...balancedIntegrationPolicy,
    minCompletedWorkItems: 2,
    requireValidatorBeforeComplete: false
  });
  const raw = [
    {
      id: "ia",
      title: "done impl",
      role: "implementer" as const,
      status: "done" as const,
      prompt: "p",
      output: "ok"
    },
    {
      id: "ib",
      title: "running impl",
      role: "implementer" as const,
      status: "running" as const,
      prompt: "p",
      output: "was running"
    },
    {
      id: "ic",
      title: "blocked op abort",
      role: "implementer" as const,
      status: "blocked" as const,
      prompt: "p",
      hardStopClass: "operator_abort" as const,
      output: "Model stream cancelled (operator abort)."
    }
  ];
  const interrupted = recoverInterruptedQueueItems(raw).queue;
  const queue = requeueOperatorStreamAbortedWorkItems(interrupted);
  await store.updateMission(m.id, {
    status: "queued",
    validationState: "passed",
    queue,
    blocker: undefined
  });
  const idsBefore = queue.map((w) => w.id).join(",");
  assert.equal(idsBefore.split(",").length, 3);
  await orchestrator.resumeMission(m.id);
  let fin = store.get(m.id)!;
  if (fin.status !== "completed") {
    await orchestrator.runMission(m.id);
    fin = store.get(m.id)!;
  }
  assert.equal(fin.queue.map((w) => w.id).join(","), idsBefore);
  assert.equal(fin.status, "completed");
  assert.equal(fin.queue.find((w) => w.id === "ib")?.status, "done");
  assert.equal(fin.queue.find((w) => w.id === "ic")?.status, "done");
});

test("interruption: operator abort vs tool failure — different blocker, validationState, work item terminal", async () => {
  const { orchestrator: o1, store: s1 } = await createOrchestratorWithAbortSupport(
    {
      planner: [{ summary: "P.", nextWorkItems: buildStandardNextQueue() }],
      implementer: ["abort_operator"]
    },
    noopTool
  );
  const m1 = await s1.create("Cmp-abort", "p", "ollama", undefined, balancedIntegrationPolicy);
  await s1.enqueue(m1.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await o1.runMission(m1.id);
  const a = s1.get(m1.id)!;
  assert.equal(a.status, "blocked");
  assert.ok(a.blocker?.includes("operator abort"));
  assert.equal(a.validationState, "pending");
  assert.equal(a.queue.find((w) => w.role === "implementer")?.status, "blocked");

  const { orchestrator: o2, store: s2 } = await createOrchestrator(
    roleScript({
      planner: [{ summary: "P.", nextWorkItems: buildStandardNextQueue() }],
      implementer: [
        {
          summary: "Tool.",
          toolCalls: [{ tool: "write_file", args: { path: "t.txt", content: "x" } }]
        }
      ]
    }),
    async () => ({ ok: false, summary: "permission denied" })
  );
  const m2 = await s2.create("Cmp-tool", "p", "ollama", undefined, balancedIntegrationPolicy);
  await s2.enqueue(m2.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await o2.runMission(m2.id);
  const b = s2.get(m2.id)!;
  assert.equal(b.status, "blocked");
  assert.ok(b.blocker?.includes("write_file"));
  assert.equal(b.validationState, "failed");
  assert.equal(b.queue.find((w) => w.role === "implementer")?.status, "failed");
  assert.ok(!b.blocker?.includes("operator abort"));
});

test("interruption: maxSteps queued vs operator abort — distinct events and terminal semantics", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 1);
  const { orchestrator: oMax, store: sMax } = await createOrchestrator(
    roleScript({
      planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
      implementer: [{ summary: "I", toolCalls: [] }],
      reviewer: [{ summary: "R", toolCalls: [] }],
      validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
    }),
    noopTool
  );
  const mMax = await sMax.create("Max-cap", "p", "ollama", undefined, balancedIntegrationPolicy);
  await sMax.enqueue(mMax.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await oMax.runMission(mMax.id);
  const maxMid = sMax.get(mMax.id)!;
  assert.equal(maxMid.status, "queued");
  assert.ok(maxMid.events.some((e) => e.message.includes("maxStepsPerRun")));
  assert.ok(!maxMid.blocker?.includes("operator abort"));

  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 24);
  const { orchestrator: oAb, store: sAb } = await createOrchestratorWithAbortSupport(
    {
      planner: [{ summary: "Plan once.", nextWorkItems: [] }],
      implementer: ["abort_operator"]
    },
    noopTool
  );
  const mAb = await sAb.create("Abort-cap", "p", "ollama", undefined, balancedIntegrationPolicy);
  await sAb.enqueue(mAb.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." },
    {
      id: "solo-imp",
      title: "Solo impl",
      role: "implementer",
      status: "todo",
      prompt: "p"
    }
  ]);
  await oAb.runMission(mAb.id);
  const abMid = sAb.get(mAb.id)!;
  assert.equal(abMid.status, "blocked");
  assert.ok(abMid.events.some((e) => e.message.includes("aborted by operator")));
  assert.ok(!abMid.events.some((e) => e.message.includes("maxStepsPerRun")));
});

test("interruption: multi-run chain — maxSteps, operator abort, resume, then complete with stable fingerprint", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 1);
  const { orchestrator, store } = await createOrchestratorWithAbortSupport(
    {
      planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
      implementer: [{ summary: "I", toolCalls: [] }],
      reviewer: [
        "abort_operator",
        { summary: "Looks good; ready for validation.", toolCalls: [] }
      ],
      validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
    },
    noopTool
  );
  const m = await store.create("Multi-chain", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  let mid = store.get(m.id)!;
  assert.equal(mid.status, "queued");
  assert.ok(mid.events.some((e) => e.message.includes("maxStepsPerRun")));
  const structural = queueStructuralFingerprint(mid);

  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 32);
  await orchestrator.runMission(m.id);
  mid = store.get(m.id)!;
  assert.equal(queueStructuralFingerprint(mid), structural);
  assert.equal(mid.status, "blocked");
  assert.ok(mid.queue.some((w) => w.role === "reviewer" && w.status === "blocked"));

  await orchestrator.resumeMission(m.id);
  mid = store.get(m.id)!;
  assert.equal(queueStructuralFingerprint(mid), structural);

  if (mid.status !== "completed") {
    await orchestrator.runMission(m.id);
    mid = store.get(m.id)!;
  }
  assert.equal(mid.status, "completed");
  assert.equal(mid.validationState, "passed");
});

test("interruption: awaiting approval — abortMissionWork no stream; resolveApproval still coherent", async () => {
  const tool = async (_mid: string, call: ToolCall): Promise<ToolResult> => {
    if (call.args.__approved) return { ok: true, summary: "ok" };
    return {
      ok: false,
      summary: "need",
      requiresApproval: { kind: "write_file", title: "Approve mut", details: "d" }
    };
  };
  const { orchestrator, store } = await createOrchestrator(
    roleScript({
      planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
      implementer: [
        { summary: "W.", toolCalls: [{ tool: "write_file", args: { path: "a.txt", content: "b" } }] }
      ],
      reviewer: [{ summary: "LGTM.", toolCalls: [] }],
      validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
    }),
    tool
  );
  const m = await store.create("Appr-abort", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  let mid = store.get(m.id)!;
  assert.equal(mid.status, "awaiting_input");
  const pending = mid.approvals.filter((a) => a.status === "pending");
  assert.equal(pending.length, 1);
  orchestrator.abortMissionWork(m.id, "operator");
  mid = store.get(m.id)!;
  assert.equal(mid.status, "awaiting_input");
  assert.equal(mid.approvals.filter((a) => a.status === "pending").length, 1);

  await orchestrator.resolveApproval(m.id, pending[0].id, true);
  await awaitMissionRunLoopIdle(orchestrator, m.id);
  mid = store.get(m.id)!;
  assert.equal(mid.status, "completed");
  assert.equal(mid.validationState, "passed");
  assert.ok(mid.approvals.every((a) => a.status === "approved"));
});

test("interruption: remediation inject then operator abort on remediation — single injection, resume finishes", async () => {
  const { orchestrator, store } = await createOrchestratorWithAbortSupport(
    {
      planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
      implementer: [
        { summary: "First impl.", toolCalls: [] },
        "abort_operator",
        { summary: "Remediation done.", toolCalls: [] }
      ],
      reviewer: [
        { summary: "There is a defect in the module; fix required.", toolCalls: [] },
        { summary: "Looks good; ready for validation.", toolCalls: [] }
      ],
      validator: [
        { summary: "COMPLETE:", decision: "complete", toolCalls: [] },
        { summary: "COMPLETE:", decision: "complete", toolCalls: [] }
      ]
    },
    noopTool
  );
  const m = await store.create("Rem-abort", "p", "ollama", undefined, {
    ...balancedIntegrationPolicy,
    minCompletedWorkItems: 6,
    maxAutoRounds: 40
  });
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  let mid = store.get(m.id)!;
  const injectCount = mid.queue.filter((w) => w.title.includes("Reviewer remediation")).length;
  assert.equal(injectCount, 1);
  const structural = queueStructuralFingerprint(mid);
  assert.ok(mid.events.some((e) => e.source === "reviewer-contract"));
  assert.equal(mid.status, "blocked");

  await orchestrator.resumeMission(m.id);
  mid = store.get(m.id)!;
  assert.equal(queueStructuralFingerprint(mid), structural);
  assert.equal(mid.queue.filter((w) => w.title.includes("Reviewer remediation")).length, 1);

  if (mid.status !== "completed") {
    await orchestrator.runMission(m.id);
    mid = store.get(m.id)!;
  }
  assert.equal(mid.status, "completed");
  assert.equal(mid.validationState, "passed");
  assert.ok(mid.queue.every((w) => w.status === "done" || w.status === "skipped"));
});
