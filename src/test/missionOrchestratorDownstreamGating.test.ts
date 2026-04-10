import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import type { ToolCall } from "../types";
import type { ToolResult } from "../tools/ToolRegistry";
import { uid } from "../util";
import {
  balancedIntegrationPolicy,
  buildStandardNextQueue,
  buildTwoImplThenReviewValidateQueue,
  createOrchestrator,
  createOrchestratorWithAbortSupport,
  roleScript,
  type VscodeTestApi
} from "./missionOrchestratorTestHarness";

beforeEach(() => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

afterEach(() => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

const noop = async (): Promise<ToolResult> => ({ ok: true, summary: "noop" });

function statusesByRole(m: { queue: Array<{ role: string; status: string }> }): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const w of m.queue) {
    out[w.role] ||= [];
    out[w.role].push(w.status);
  }
  return out;
}

test("downstream gating: tool failure on required implementer prevents reviewer/validator selection in later pass", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 8);
  let toolCalls = 0;
  const tool = async (_mid: string, _call: ToolCall): Promise<ToolResult> => {
    toolCalls += 1;
    return { ok: false, summary: "tool blew up" };
  };
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildTwoImplThenReviewValidateQueue() }],
    // First implementer turn attempts a tool (fails); second implementer can still run while gated.
    implementer: [
      { summary: "Try write.", toolCalls: [{ tool: "write_file", args: { path: "x.txt", content: "y" } }] },
      { summary: "Follow-up implementation without tools.", toolCalls: [] }
    ],
    reviewer: [{ summary: "R should not run while gated.", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, tool);
  const m = await store.create("gate-tool-fail", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [{ id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }]);

  await orchestrator.runMission(m.id);
  let mid = store.get(m.id)!;
  assert.equal(mid.status, "blocked");
  assert.ok(mid.queue.some((w) => w.role === "implementer" && w.status === "failed"));
  const fpBefore = mid.queue.map((w) => `${w.id}:${w.role}:${w.status}`).join("|");

  await orchestrator.resumeMission(m.id);
  mid = store.get(m.id)!;
  const fpAfter = mid.queue.map((w) => `${w.id}:${w.role}:${w.status}`).join("|");
  assert.ok(fpAfter.length > 0 && fpBefore.length > 0);
  assert.equal(toolCalls >= 1, true);

  const byRole = statusesByRole(mid);
  assert.ok(byRole.implementer?.includes("done"), "late implementer tranche should be allowed to run");
  assert.ok(!(byRole.reviewer || []).includes("done"), "reviewer should not run while gate active");
  assert.ok(!(byRole.validator || []).includes("done"), "validator should not run while gate active");
});

test("downstream gating: policy-blocked tool on implementer prevents reviewer/validator selection", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 8);
  const tool = async (_mid: string, _call: ToolCall): Promise<ToolResult> => {
    return { ok: false, summary: "blocked", blockedByPolicy: true } as ToolResult;
  };
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildTwoImplThenReviewValidateQueue() }],
    implementer: [
      { summary: "Try tool.", toolCalls: [{ tool: "write_file", args: { path: "x.txt", content: "y" } }] },
      { summary: "Late implementer ok.", toolCalls: [] }
    ],
    reviewer: [{ summary: "R should not run.", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, tool);
  const m = await store.create("gate-policy", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [{ id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }]);

  await orchestrator.runMission(m.id);
  let mid = store.get(m.id)!;
  assert.equal(mid.status, "blocked");
  assert.ok(mid.blocker?.includes("Policy blocked"));

  await orchestrator.resumeMission(m.id);
  mid = store.get(m.id)!;
  const byRole = statusesByRole(mid);
  assert.ok(byRole.implementer?.includes("done"));
  assert.ok(!(byRole.reviewer || []).includes("done"));
  assert.ok(!(byRole.validator || []).includes("done"));
});

test("downstream gating: approval pending/rejected gates reviewer/validator until approval resolves", async () => {
  const tool = async (_mid: string, call: ToolCall): Promise<ToolResult> => {
    if (call.args.__approved) return { ok: true, summary: "ok" };
    return { ok: false, summary: "n", requiresApproval: { kind: "write_file" as const, title: "A", details: "d" } };
  };
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [
      { summary: "Needs approval.", toolCalls: [{ tool: "write_file", args: { path: "x.txt", content: "y" } }] },
      { summary: "Late implementer ok.", toolCalls: [] }
    ],
    reviewer: [{ summary: "R after approval.", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, tool);
  const m = await store.create("gate-approval", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [{ id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }]);

  await orchestrator.runMission(m.id);
  let mid = store.get(m.id)!;
  assert.equal(mid.status, "awaiting_input");
  assert.ok(mid.approvals.some((a) => a.status === "pending"));

  // Reject: terminal blocked; downstream should remain gated (no pass runs from resolveApproval rejection).
  const pending = mid.approvals.find((a) => a.status === "pending")!;
  await orchestrator.resolveApproval(m.id, pending.id, false, "no");
  mid = store.get(m.id)!;
  assert.equal(mid.status, "blocked");
  const byRole = statusesByRole(mid);
  assert.ok(!(byRole.reviewer || []).includes("done"));
  assert.ok(!(byRole.validator || []).includes("done"));
});

test("honesty guard: approval rejected + gated + no eligible planner/implementer keeps mission blocked (not queued)", async () => {
  const tool = async (_mid: string, call: ToolCall): Promise<ToolResult> => {
    if (call.args.__approved) return { ok: true, summary: "ok" };
    return { ok: false, summary: "n", requiresApproval: { kind: "write_file" as const, title: "A", details: "d" } };
  };
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "Needs approval.", toolCalls: [{ tool: "write_file", args: { path: "x.txt", content: "y" } }] }],
    reviewer: [{ summary: "R", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, tool);
  const m = await store.create("honesty-reject", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [{ id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }]);

  await orchestrator.runMission(m.id);
  let mid = store.get(m.id)!;
  assert.equal(mid.status, "awaiting_input");
  const pending = mid.approvals.find((a) => a.status === "pending");
  assert.ok(pending);
  await orchestrator.resolveApproval(m.id, pending.id, false, "no");
  mid = store.get(m.id)!;
  assert.equal(mid.status, "blocked");

  await orchestrator.resumeMission(m.id);
  mid = store.get(m.id)!;
  assert.equal(mid.status, "blocked");
});

test("honesty guard: tool failure + gated + no eligible planner/implementer keeps mission blocked (not queued)", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 8);
  const tool = async (_mid: string, _call: ToolCall): Promise<ToolResult> => ({ ok: false, summary: "hard fail" });
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "Try tool.", toolCalls: [{ tool: "write_file", args: { path: "x.txt", content: "y" } }] }],
    reviewer: [{ summary: "R", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, tool);
  const m = await store.create("honesty-tool-fail", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [{ id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }]);

  await orchestrator.runMission(m.id);
  let mid = store.get(m.id)!;
  assert.equal(mid.status, "blocked");
  assert.ok(mid.queue.some((w) => w.role === "implementer" && w.status === "failed"));

  await orchestrator.resumeMission(m.id);
  mid = store.get(m.id)!;
  assert.equal(mid.status, "blocked");
});

test("honesty guard: policy-blocked implementer + gated + no eligible allowed work keeps mission blocked (not queued)", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 8);
  const tool = async (_mid: string, _call: ToolCall): Promise<ToolResult> => {
    return { ok: false, summary: "blocked", blockedByPolicy: true } as ToolResult;
  };
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "Try tool.", toolCalls: [{ tool: "write_file", args: { path: "x.txt", content: "y" } }] }],
    reviewer: [{ summary: "R", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, tool);
  const m = await store.create("honesty-policy", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [{ id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }]);

  await orchestrator.runMission(m.id);
  let mid = store.get(m.id)!;
  assert.equal(mid.status, "blocked");
  assert.ok(mid.blocker?.includes("Policy blocked"));

  await orchestrator.resumeMission(m.id);
  mid = store.get(m.id)!;
  assert.equal(mid.status, "blocked");
});

test("downstream gating: operator-aborted implementer gates reviewer/validator until resume requeues and work runs", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 8);
  const { orchestrator, store } = await createOrchestratorWithAbortSupport(
    {
      planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
      implementer: [
        "abort_operator",
        { summary: "Recovered implementer.", toolCalls: [] }
      ],
      reviewer: [{ summary: "Review after recovery.", toolCalls: [] }],
      validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
    },
    noop
  );
  const m = await store.create("gate-op-abort", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [{ id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }]);

  await orchestrator.runMission(m.id);
  let mid = store.get(m.id)!;
  assert.equal(mid.status, "blocked");
  assert.ok(mid.queue.some((w) => w.role === "implementer" && w.status === "blocked"));
  assert.ok(mid.queue.some((w) => w.role === "reviewer" && w.status === "todo"), "reviewer should be pending at abort");

  await orchestrator.resumeMission(m.id);
  mid = store.get(m.id)!;
  const byRole = statusesByRole(mid);
  assert.ok(byRole.implementer?.includes("done"), "implementer should be allowed after resume requeue");
  // After operator abort recovery requeues the blocked item to todo and it runs to done; gate clears and reviewer can run.
  assert.ok((byRole.reviewer || []).includes("done") || (byRole.reviewer || []).includes("todo"));
});

test("downstream gating: timeout/system abort does NOT gate reviewer/validator (current recovery behavior preserved)", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 8);
  const { orchestrator, store } = await createOrchestratorWithAbortSupport(
    {
      planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
      implementer: ["abort_timeout"],
      reviewer: [{ summary: "Reviewer runs despite timeout.", toolCalls: [] }],
      validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
    },
    noop
  );
  const m = await store.create("gate-timeout", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [{ id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }]);

  await orchestrator.runMission(m.id);
  const mid = store.get(m.id)!;
  assert.ok(mid.queue.some((w) => w.role === "implementer" && w.status === "failed"));
  assert.ok(mid.queue.some((w) => w.role === "reviewer" && w.status === "done"), "reviewer should still run");
});

test("downstream gating: implementer approval_pending without pending approvals row sets approval_gate_stale", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 8);
  const agent = roleScript({
    planner: [{ summary: "Plan done.", nextWorkItems: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, noop);
  const m = await store.create("gate-appr-stale", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("w"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." },
    {
      id: uid("w"),
      title: "Blocked impl",
      role: "implementer",
      status: "blocked",
      prompt: "was waiting",
      hardStopClass: "approval_pending",
      output: "Pending approval (stale)"
    }
  ]);

  await orchestrator.runMission(m.id);
  const mid = store.get(m.id)!;
  assert.equal(mid.status, "awaiting_input");
  assert.equal(mid.blockReasonCode, "approval_gate_stale");
  assert.ok(mid.events.some((e) => typeof e.message === "string" && e.message.includes("approval_gate_stale")));

  const resume = await orchestrator.resumeMission(m.id);
  assert.notEqual(resume.kind, "gated_awaiting_input");
  const after = store.get(m.id)!;
  assert.ok(
    after.events.some((e) => typeof e.message === "string" && e.message.includes("Reconciled approval_gate_stale")),
    "resume should log reconciliation"
  );
  const impl = after.queue.find((w) => w.role === "implementer");
  assert.notEqual(impl?.hardStopClass, "approval_pending", "stale approval_pending should be cleared on resume");
});

