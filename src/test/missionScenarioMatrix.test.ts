import test from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import type { ToolCall } from "../types";
import {
  balancedIntegrationPolicy,
  buildStandardNextQueue,
  createOrchestrator,
  createOrchestratorWithAbortSupport,
  roleScript,
  type VscodeTestApi
} from "./missionOrchestratorTestHarness";

const noopTool = async () => ({ ok: true, summary: "noop" });

test("matrix: missing readFile deliverable is non-fatal; follow-up can create and proceed", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 8);

  // Minimal in-memory file map for tool stub.
  const files = new Map<string, string>();
  const target = "AUDIT_REPORT.md";

  const tool = async (_mid: string, call: ToolCall) => {
    if (call.tool === "readFile") {
      const p = String(call.args.path || "");
      const rel = p.startsWith("/") ? p : p.replace(/^\.?\/*/, "");
      if (!files.has(rel)) {
        return {
          ok: false,
          summary: `readFile failed: Error: ENOENT: no such file or directory, open '${p}'`,
          data: { code: "FileNotFound", detail: "ENOENT", suggestedPaths: [] }
        };
      }
      return { ok: true, summary: `Read ${p}`, data: files.get(rel)! };
    }
    if (call.tool === "writeFile") {
      const p = String(call.args.path || "");
      const content = String(call.args.content || "");
      files.set(p.replace(/^\.?\/*/, ""), content);
      return { ok: true, summary: `Wrote ${p}` };
    }
    return { ok: true, summary: `noop:${call.tool}` };
  };

  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [
      {
        summary: "Need to write audit report; if missing, create it with content and re-read.",
        toolCalls: [
          { tool: "readFile", args: { path: target } },
          { tool: "writeFile", args: { path: target, content: "# Audit Report\n\n## Summary\n\n- Draft.\n" } },
          { tool: "readFile", args: { path: target } }
        ]
      }
    ],
    reviewer: [{ summary: "R", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });

  const { orchestrator, store } = await createOrchestrator(agent, tool);
  const m = await store.create("matrix-missing-readfile", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [{ id: "p0", title: "Plan", role: "planner", status: "todo", prompt: "Plan." }]);

  await orchestrator.runMission(m.id);
  const fin = store.get(m.id)!;
  // Should not be blocked on tool_failure just because the first readFile was missing.
  assert.notEqual(fin.blockReasonCode, "tool_failure");
  assert.ok(files.has(target));
});

test("matrix: failure investigation can enqueue recovery wave instead of terminal tool_failure block", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.failureInvestigation.enabled", true);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.failureInvestigation.maxWavesPerMission", 2);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 20);
  try {
    let writeFileCalls = 0;
    const tool = async (_mid: string, call: ToolCall) => {
      if (call.tool === "writeFile") {
        writeFileCalls += 1;
        if (writeFileCalls === 1) return { ok: false, summary: "writeFile failed hard" };
        return { ok: true, summary: "Wrote file" };
      }
      return { ok: true, summary: "ok" };
    };
    const agent = roleScript({
      planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
      implementer: [
        { summary: "Try write", toolCalls: [{ tool: "writeFile", args: { path: "x.txt", content: "y" } }] },
        { summary: "Retry write", toolCalls: [{ tool: "writeFile", args: { path: "x.txt", content: "y" } }] }
      ],
      researcher: [{ summary: "MEMORY:finding: root cause is test stub.", toolCalls: [] }],
      reviewer: [{ summary: "R", toolCalls: [] }],
      validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
    });
    const { orchestrator, store } = await createOrchestrator(agent, tool);
    const m = await store.create("matrix-failure-investigation", "p", "ollama", undefined, balancedIntegrationPolicy);
    await store.enqueue(m.id, [{ id: "p0", title: "Plan", role: "planner", status: "todo", prompt: "Plan." }]);
    await orchestrator.runMission(m.id);
    const fin = store.get(m.id)!;
    assert.ok(fin.events.some((e) => String(e.message || "").includes("Failure investigation wave enqueued")));
    assert.equal(fin.runtime?.failureInvestigationWavesUsed, 1);
    assert.notEqual(fin.blockReasonCode, "tool_failure");
    assert.ok(fin.queue.some((w) => w.workItemPurpose === "failure_investigation_diagnose"));
    assert.ok(fin.queue.some((w) => w.workItemPurpose === "failure_recovery_retry"));
  } finally {
    (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.failureInvestigation.enabled", false);
    (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 8);
  }
});

test("matrix: non-readFile tool failure still blocks mission (safety)", async () => {
  const tool = async (_mid: string, call: ToolCall) => {
    // writeFile is mutating; failures should still block the mission.
    if (call.tool === "writeFile") return { ok: false, summary: "writeFile failed hard" };
    return { ok: true, summary: "ok" };
  };
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "Try write", toolCalls: [{ tool: "writeFile", args: { path: "x.txt", content: "y" } }] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, tool);
  const m = await store.create("matrix-block-on-tool", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [{ id: "p0", title: "Plan", role: "planner", status: "todo", prompt: "Plan." }]);
  await orchestrator.runMission(m.id);
  const fin = store.get(m.id)!;
  assert.equal(fin.status, "blocked");
  assert.equal(fin.blockReasonCode, "tool_failure");
});

test("matrix: approval-required tool pauses awaiting_input", async () => {
  const tool = async () => ({ ok: false, summary: "n", requiresApproval: { kind: "write_file" as const, title: "A", details: "d" } });
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "Write", toolCalls: [{ tool: "writeFile", args: { path: "x.txt", content: "y" } }] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, tool as any);
  const m = await store.create("matrix-approval", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [{ id: "p0", title: "Plan", role: "planner", status: "todo", prompt: "Plan." }]);
  await orchestrator.runMission(m.id);
  const fin = store.get(m.id)!;
  assert.equal(fin.status, "awaiting_input");
  assert.equal(fin.blockReasonCode, "approval_pending");
  assert.ok(fin.approvals.some((a) => a.status === "pending"));
});

test("matrix: blockedByPolicy tool result pauses blocked with policy_blocked", async () => {
  const tool = async () => ({ ok: false, summary: "Denied by policy", blockedByPolicy: true });
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "Try terminal", toolCalls: [{ tool: "runCommand", args: { command: "echo hi" } }] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, tool as any);
  const m = await store.create("matrix-policy-block", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [{ id: "p0", title: "Plan", role: "planner", status: "todo", prompt: "Plan." }]);
  await orchestrator.runMission(m.id);
  const fin = store.get(m.id)!;
  assert.equal(fin.status, "blocked");
  assert.equal(fin.blockReasonCode, "policy_blocked");
});

test("matrix: tool throws is treated as tool_failure and blocks mission", async () => {
  const tool = async () => {
    throw new Error("tool crashed unexpectedly");
  };
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "Write", toolCalls: [{ tool: "writeFile", args: { path: "x.txt", content: "y" } }] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, tool as any);
  const m = await store.create("matrix-tool-throws", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [{ id: "p0", title: "Plan", role: "planner", status: "todo", prompt: "Plan." }]);
  await orchestrator.runMission(m.id);
  const fin = store.get(m.id)!;
  assert.equal(fin.status, "blocked");
  assert.equal(fin.blockReasonCode, "tool_failure");
  assert.ok(fin.events.some((e) => String(e.message || "").includes("threw (unexpected)")));
});

test("matrix: approval_gate_stale can be resumed and reconciles queue", async () => {
  const agent = roleScript({
    planner: [{ summary: "noop", nextWorkItems: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, noopTool);
  const m = await store.create("matrix-approval-gate-stale", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: "p0", title: "Plan", role: "planner", status: "done", prompt: "Plan." },
    {
      id: "i0",
      title: "Impl blocked",
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
  const r = await orchestrator.resumeMission(m.id);
  assert.notEqual(r.kind, "gated_awaiting_input");
  const after = store.get(m.id)!;
  assert.ok(after.events.some((e) => String(e.message || "").includes("Reconciled approval_gate_stale")));
});

test("matrix: operator abort blocks mission and requires explicit resume", async () => {
  const tool = async () => ({ ok: true, summary: "noop" });
  const turns = {
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: ["abort_operator" as const]
  };
  const { orchestrator, store } = await createOrchestratorWithAbortSupport(turns, tool as any);
  const m = await store.create("matrix-operator-abort", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [{ id: "p0", title: "Plan", role: "planner", status: "todo", prompt: "Plan." }]);
  await orchestrator.runMission(m.id);
  const mid = store.get(m.id)!;
  assert.equal(mid.status, "blocked");
  assert.equal(mid.blockReasonCode, "operator_stream_abort");
});

test("matrix: timeout abort fails work item but mission continues (recovery path)", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 8);
  const tool = async () => ({ ok: true, summary: "noop" });
  const turns = {
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: ["abort_timeout" as const, { summary: "Recovered.", toolCalls: [] }],
    reviewer: [{ summary: "R", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete" as const, toolCalls: [] }]
  };
  const { orchestrator, store } = await createOrchestratorWithAbortSupport(turns, tool as any);
  const m = await store.create("matrix-timeout-abort", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [{ id: "p0", title: "Plan", role: "planner", status: "todo", prompt: "Plan." }]);
  await orchestrator.runMission(m.id);
  const fin = store.get(m.id)!;
  // Not blocked on operator abort. Timeout is treated as failed item + continue.
  assert.notEqual(fin.blockReasonCode, "operator_stream_abort");
  assert.ok(fin.events.some((e) => String(e.message || "").includes("cancelled (timeout)")));
});

test("matrix: transient mutating tool failure can be treated as recoverable (bounded)", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxToolFollowUpsWhenTestHarness", 5);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 16);
  let n = 0;
  try {
    const tool = async (_mid: string, call: ToolCall) => {
      if (call.tool === "runCommand") {
        n += 1;
        if (n === 1) return { ok: false, summary: "ETIMEDOUT: request timed out" };
        return { ok: true, summary: "Command succeeded (1ms): echo ok", data: { exitCode: 0, timedOut: false, durationMs: 1 } };
      }
      return { ok: true, summary: "ok" };
    };
    const agent = roleScript({
      planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
      implementer: [
        { summary: "Run command", toolCalls: [{ tool: "runCommand", args: { command: "echo hi" } }] },
        { summary: "Retry", toolCalls: [{ tool: "runCommand", args: { command: "echo ok" } }] },
        { summary: "Done impl", toolCalls: [] }
      ],
      reviewer: [{ summary: "R", toolCalls: [] }],
      validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
    });
    const { orchestrator, store } = await createOrchestrator(agent, tool as any);
    const m = await store.create("matrix-transient-mutating", "p", "ollama", undefined, balancedIntegrationPolicy);
    await store.enqueue(m.id, [{ id: "p0", title: "Plan", role: "planner", status: "todo", prompt: "Plan." }]);
    await orchestrator.runMission(m.id);
    const fin = store.get(m.id)!;
    assert.notEqual(fin.blockReasonCode, "tool_failure");
    assert.ok(fin.events.some((e) => e.telemetryKind === "recovery_attempt"));
    assert.equal(n, 2);
  } finally {
    (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxToolFollowUpsWhenTestHarness", 0);
  }
});

test("matrix: dryRun skips mutating tool calls without blocking mission", async () => {
  const tool = async () => ({ ok: true, summary: "noop" });
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "Would write", toolCalls: [{ tool: "writeFile", args: { path: "x.txt", content: "y" } }] }],
    reviewer: [{ summary: "R", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, tool as any);
  const m = await store.create("matrix-dry-run", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.updateMission(m.id, { dryRun: true } as any);
  await store.enqueue(m.id, [{ id: "p0", title: "Plan", role: "planner", status: "todo", prompt: "Plan." }]);
  await orchestrator.runMission(m.id);
  const fin = store.get(m.id)!;
  assert.notEqual(fin.blockReasonCode, "tool_failure");
  assert.ok(fin.events.some((e) => String(e.message || "").includes("[DRY-RUN]")));
});

test("matrix: runCommand recoverable failure + tool follow-up in harness completes without tool_failure", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxToolFollowUpsWhenTestHarness", 5);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 16);
  let runCommandCalls = 0;
  try {
    const tool = async (_mid: string, call: ToolCall) => {
      if (call.tool === "runCommand") {
        runCommandCalls += 1;
        if (runCommandCalls === 1) {
          return {
            ok: false,
            summary: "Command failed (exit 2, 7ms): bad",
            data: {
              exitCode: 2,
              stderr: "bash: syntax error near unexpected token",
              stdout: "",
              timedOut: false,
              durationMs: 7
            }
          };
        }
        return {
          ok: true,
          summary: "Command succeeded (1ms): echo ok",
          data: { exitCode: 0, stderr: "", stdout: "ok\n", timedOut: false, durationMs: 1 }
        };
      }
      return { ok: true, summary: "ok" };
    };
    const agent = roleScript({
      planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
      implementer: [
        { summary: "Try shell", toolCalls: [{ tool: "runCommand", args: { command: "bad" } }] },
        { summary: "Retry", toolCalls: [{ tool: "runCommand", args: { command: "echo ok" } }] },
        { summary: "Done impl", toolCalls: [] }
      ],
      reviewer: [{ summary: "R", toolCalls: [] }],
      validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
    });
    const { orchestrator, store } = await createOrchestrator(agent, tool as any);
    const m = await store.create("matrix-runcommand-agent-retry", "p", "ollama", undefined, balancedIntegrationPolicy);
    await store.enqueue(m.id, [{ id: "p0", title: "Plan", role: "planner", status: "todo", prompt: "Plan." }]);
    await orchestrator.runMission(m.id);
    const fin = store.get(m.id)!;
    assert.notEqual(fin.blockReasonCode, "tool_failure", `status=${fin.status} blocker=${fin.blocker}`);
    assert.equal(runCommandCalls, 2);
    assert.ok(
      fin.events.some(
        (e) =>
          e.telemetryKind === "recovery_attempt" &&
          (e.data as { category?: string } | undefined)?.category === "run_command_agent_retry"
      )
    );
  } finally {
    (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxToolFollowUpsWhenTestHarness", 0);
  }
});

test("matrix: writeFile recoverable failure + tool follow-up in harness completes without tool_failure", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxToolFollowUpsWhenTestHarness", 5);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 16);
  let writeFileCalls = 0;
  try {
    const tool = async (_mid: string, call: ToolCall) => {
      if (call.tool === "writeFile") {
        writeFileCalls += 1;
        if (writeFileCalls === 1) return { ok: false, summary: "writeFile rejected: simulated failure" };
        return { ok: true, summary: "Wrote x.txt" };
      }
      return { ok: true, summary: "ok" };
    };
    const agent = roleScript({
      planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
      implementer: [
        { summary: "Try write", toolCalls: [{ tool: "writeFile", args: { path: "x.txt", content: "a" } }] },
        { summary: "Retry write", toolCalls: [{ tool: "writeFile", args: { path: "x.txt", content: "b" } }] },
        { summary: "Done impl", toolCalls: [] }
      ],
      reviewer: [{ summary: "R", toolCalls: [] }],
      validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
    });
    const { orchestrator, store } = await createOrchestrator(agent, tool as any);
    const m = await store.create("matrix-writefile-agent-retry", "p", "ollama", undefined, balancedIntegrationPolicy);
    await store.enqueue(m.id, [{ id: "p0", title: "Plan", role: "planner", status: "todo", prompt: "Plan." }]);
    await orchestrator.runMission(m.id);
    const fin = store.get(m.id)!;
    assert.notEqual(fin.blockReasonCode, "tool_failure", `status=${fin.status} blocker=${fin.blocker}`);
    assert.equal(writeFileCalls, 2);
    assert.ok(
      fin.events.some(
        (e) =>
          e.telemetryKind === "recovery_attempt" &&
          (e.data as { category?: string } | undefined)?.category === "write_file_agent_retry"
      )
    );
  } finally {
    (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxToolFollowUpsWhenTestHarness", 0);
  }
});

test("matrix: applyPatch recoverable failure + tool follow-up in harness completes without tool_failure", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxToolFollowUpsWhenTestHarness", 5);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 16);
  let patchCalls = 0;
  try {
    const tool = async (_mid: string, call: ToolCall) => {
      if (call.tool === "applyPatch") {
        patchCalls += 1;
        if (patchCalls === 1) return { ok: false, summary: "Search text not found in /w/p.txt" };
        return { ok: true, summary: "Patched p.txt" };
      }
      return { ok: true, summary: "ok" };
    };
    const agent = roleScript({
      planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
      implementer: [
        { summary: "Try patch", toolCalls: [{ tool: "applyPatch", args: { path: "p.txt", search: "x", replace: "y" } }] },
        { summary: "Retry patch", toolCalls: [{ tool: "applyPatch", args: { path: "p.txt", search: "x", replace: "y" } }] },
        { summary: "Done impl", toolCalls: [] }
      ],
      reviewer: [{ summary: "R", toolCalls: [] }],
      validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
    });
    const { orchestrator, store } = await createOrchestrator(agent, tool as any);
    const m = await store.create("matrix-applypatch-agent-retry", "p", "ollama", undefined, balancedIntegrationPolicy);
    await store.enqueue(m.id, [{ id: "p0", title: "Plan", role: "planner", status: "todo", prompt: "Plan." }]);
    await orchestrator.runMission(m.id);
    const fin = store.get(m.id)!;
    assert.notEqual(fin.blockReasonCode, "tool_failure", `status=${fin.status} blocker=${fin.blocker}`);
    assert.equal(patchCalls, 2);
    assert.ok(
      fin.events.some(
        (e) =>
          e.telemetryKind === "recovery_attempt" &&
          (e.data as { category?: string } | undefined)?.category === "apply_patch_agent_retry"
      )
    );
  } finally {
    (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxToolFollowUpsWhenTestHarness", 0);
  }
});

