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

test("matrix: optional reviewer git probe failure degrades and review continues on artifact evidence", async () => {
  const policy = {
    ...balancedIntegrationPolicy,
    minCompletedWorkItems: 2,
    requireImplementerBeforeComplete: false
  };
  const tool = async (_mid: string, call: ToolCall) => {
    if (call.tool === "git.status") {
      return { ok: false, summary: "fatal: not a git repository (or any of the parent directories): .git" };
    }
    if (call.tool === "listFiles") {
      return { ok: true, summary: "Listed mission-root files.", data: ["docs/run_optional/phase_outputs/phase2/04_current_phase_review.md"] };
    }
    if (call.tool === "readFile") {
      return {
        ok: true,
        summary: `Read ${String(call.args.path || "")}`,
        data: "# Current phase review\n\nOnly phase 0-2 artifacts were inspected.\n"
      };
    }
    return { ok: true, summary: `noop:${call.tool}` };
  };
  const agent = roleScript({
    reviewer: [
      {
        summary: "Reviewed current-phase artifact after optional git probe failed.",
        toolCalls: [
          { tool: "git.status", args: {} },
          { tool: "listFiles", args: { glob: "docs/run_optional/**/*" } },
          { tool: "readFile", args: { path: "docs/run_optional/phase_outputs/phase2/04_current_phase_review.md" } }
        ]
      }
    ],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, tool as any);
  const m = await store.create(
    "matrix-optional-review-probe",
    [
      "Phase-scoped document review mission.",
      "Only review docs/run_optional/phase_outputs/phase2/04_current_phase_review.md.",
      "Do not depend on git unless the task explicitly requires repo state."
    ].join("\n"),
    "ollama",
    undefined,
    policy
  );
  await store.updateRuntime(m.id, { resolvedArtifactRootRelative: "docs/run_optional" });
  await store.enqueue(m.id, [
    {
      id: "rev0",
      title: "Review current phase artifacts",
      role: "reviewer",
      status: "todo",
      prompt: "Review only docs/run_optional/phase_outputs/phase2/04_current_phase_review.md and stay inside the current mission root."
    },
    {
      id: "val0",
      title: "Validate review closure",
      role: "validator",
      status: "todo",
      prompt: "Validate the document review."
    }
  ]);
  await orchestrator.runMission(m.id);
  const fin = store.get(m.id)!;
  assert.equal(fin.status, "completed");
  assert.notEqual(fin.blockReasonCode, "tool_failure");
  assert.ok(fin.events.some((e) => {
    const d = e.data as { category?: string } | undefined;
    return d?.category === "optional_probe_degraded";
  }));
});

test("matrix: optional diagnostics probe failure also degrades when artifact evidence remains", async () => {
  const policy = {
    ...balancedIntegrationPolicy,
    minCompletedWorkItems: 2,
    requireImplementerBeforeComplete: false
  };
  const tool = async (_mid: string, call: ToolCall) => {
    if (call.tool === "getDiagnostics") {
      return { ok: false, summary: "Diagnostics provider unavailable" };
    }
    if (call.tool === "listFiles") {
      return { ok: true, summary: "Listed mission-root files.", data: ["docs/run_optional/phase_outputs/phase2/04_current_phase_review.md"] };
    }
    if (call.tool === "readFile") {
      return {
        ok: true,
        summary: `Read ${String(call.args.path || "")}`,
        data: "# Current phase review\n\nScoped artifact evidence was available.\n"
      };
    }
    return { ok: true, summary: `noop:${call.tool}` };
  };
  const agent = roleScript({
    reviewer: [
      {
        summary: "Reviewed scoped artifact after diagnostics probe failed.",
        toolCalls: [
          { tool: "getDiagnostics", args: {} },
          { tool: "listFiles", args: { glob: "docs/run_optional/**/*" } },
          { tool: "readFile", args: { path: "docs/run_optional/phase_outputs/phase2/04_current_phase_review.md" } }
        ]
      }
    ],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, tool as any);
  const m = await store.create(
    "matrix-optional-diagnostics-probe",
    [
      "Phase-scoped document review mission.",
      "Only review docs/run_optional/phase_outputs/phase2/04_current_phase_review.md.",
      "Prefer artifact evidence over workspace diagnostics."
    ].join("\n"),
    "ollama",
    undefined,
    policy
  );
  await store.updateRuntime(m.id, { resolvedArtifactRootRelative: "docs/run_optional" });
  await store.enqueue(m.id, [
    {
      id: "rev0",
      title: "Review current phase artifacts",
      role: "reviewer",
      status: "todo",
      prompt: "Review only docs/run_optional/phase_outputs/phase2/04_current_phase_review.md and stay inside the current mission root."
    },
    {
      id: "val0",
      title: "Validate review closure",
      role: "validator",
      status: "todo",
      prompt: "Validate the document review."
    }
  ]);
  await orchestrator.runMission(m.id);
  const fin = store.get(m.id)!;
  assert.equal(fin.status, "completed");
  assert.notEqual(fin.blockReasonCode, "tool_failure");
  assert.ok(fin.events.some((e) => {
    const d = e.data as { category?: string; evidenceSourceKind?: string } | undefined;
    return d?.category === "optional_probe_degraded" && d?.evidenceSourceKind === "diagnostics";
  }));
});

test("matrix: explicit git-required reviewer probe failure still blocks", async () => {
  const policy = {
    ...balancedIntegrationPolicy,
    minCompletedWorkItems: 1,
    requireImplementerBeforeComplete: false,
    requireValidatorBeforeComplete: false
  };
  const tool = async (_mid: string, call: ToolCall) => {
    if (call.tool === "git.status") {
      return { ok: false, summary: "fatal: not a git repository (or any of the parent directories): .git" };
    }
    return { ok: true, summary: "ok" };
  };
  const agent = roleScript({
    reviewer: [
      {
        summary: "Tried to confirm repository state.",
        toolCalls: [{ tool: "git.status", args: {} }]
      }
    ]
  });
  const { orchestrator, store } = await createOrchestrator(agent, tool as any);
  const m = await store.create(
    "matrix-required-review-git",
    "Review repository git status and confirm whether the working tree is clean.",
    "ollama",
    undefined,
    policy
  );
  await store.enqueue(m.id, [
    {
      id: "rev0",
      title: "Review repo state",
      role: "reviewer",
      status: "todo",
      prompt: "Use git status to confirm the repository state before approving."
    }
  ]);
  await orchestrator.runMission(m.id);
  const fin = store.get(m.id)!;
  assert.equal(fin.status, "blocked");
  assert.equal(fin.blockReasonCode, "tool_failure");
});

test("matrix: implementer deliverable inference blocks done when required phased files are still missing", async () => {
  const policy = {
    ...balancedIntegrationPolicy,
    minCompletedWorkItems: 1,
    requireReviewerBeforeComplete: false,
    requireValidatorBeforeComplete: false
  };
  const agent = roleScript({
    implementer: [
      {
        summary: [
          "Complete Phase 0 and Phase 1 preparations.",
          "mkdir -p docs/guard_run_17/plans",
          "mkdir -p docs/guard_run_17/phase_outputs/phase1",
          "mkdir -p docs/guard_run_17/logs"
        ].join("\n"),
        toolCalls: []
      }
    ]
  });
  const { orchestrator, store } = await createOrchestrator(agent, noopTool as any);
  const m = await store.create(
    "matrix-deliverable-guard",
    [
      "Phase 0 - Root binding",
      "- <MISSION_ROOT>/00_run_binding.md",
      "- <MISSION_ROOT>/00_scope_guard.md",
      "Phase 1 - Initial outputs",
      "- <MISSION_ROOT>/plans/01_execution_plan.md",
      "- <MISSION_ROOT>/phase_outputs/phase1/01_root_resolution_report.md"
    ].join("\n"),
    "ollama",
    undefined,
    policy
  );
  await store.enqueue(m.id, [
    {
      id: "impl0",
      title: "Implement phased artifacts",
      role: "implementer",
      status: "todo",
      prompt: "Create the required Phase 0 and Phase 1 artifacts."
    }
  ]);
  await orchestrator.runMission(m.id);
  const fin = store.get(m.id)!;
  const impl = fin.queue.find((w) => w.id === "impl0");
  assert.equal(impl?.status, "failed");
  assert.match(String(impl?.output || ""), /DELIVERABLE_GUARD/);
  assert.match(String(impl?.output || ""), /docs\/guard_run_17\/00_run_binding\.md/);
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

test("matrix: host-risk policy denial emits structured hard_deny", async () => {
  const tool = async () => ({
    ok: false,
    summary: "Host-risk command pattern detected (central policy).",
    blockedByPolicy: true
  });
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "Risky", toolCalls: [{ tool: "runCommand", args: { command: "sudo rm -rf /" } }] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, tool as any);
  const m = await store.create("matrix-host-risk-policy", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [{ id: "p0", title: "Plan", role: "planner", status: "todo", prompt: "Plan." }]);
  await orchestrator.runMission(m.id);
  const fin = store.get(m.id)!;
  assert.equal(fin.status, "blocked");
  const hit = fin.events.find((e) => {
    const d = e.data as { structuredFailure?: { class?: string } } | undefined;
    return d?.structuredFailure?.class === "hard_deny";
  });
  assert.ok(hit, "expected structuredFailure.class hard_deny in mission events");
});

test("matrix: post-mutation test failure is repairable and can spawn recovery work", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.failureInvestigation.enabled", true);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.failureInvestigation.maxWavesPerMission", 2);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 32);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.verification.autoRunTestsAfterMutations", true);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.verification.autoRunLinterAfterMutations", true);
  try {
    const tool = async (_mid: string, call: ToolCall) => {
      if (call.tool === "writeFile") return { ok: true, summary: "Wrote file" };
      if (call.tool === "runLinter") return { ok: true, summary: "lint ok" };
      if (call.tool === "runTests") return { ok: false, summary: "Tests failed: exit 1" };
      return { ok: true, summary: "noop" };
    };
    const agent = roleScript({
      planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
      implementer: [
        { summary: "Mutate", toolCalls: [{ tool: "writeFile", args: { path: "t.txt", content: "z" } }] },
        { summary: "Retry after verification failure", toolCalls: [] }
      ],
      researcher: [{ summary: "MEMORY:finding: fix tests", toolCalls: [] }],
      reviewer: [{ summary: "R", toolCalls: [] }],
      validator: [{ summary: "COMPLETE:", decision: "complete" as const, toolCalls: [] }]
    });
    const { orchestrator, store } = await createOrchestrator(agent, tool as any);
    const m = await store.create("matrix-post-verify-recovery", "p", "ollama", undefined, balancedIntegrationPolicy);
    await store.enqueue(m.id, [{ id: "p0", title: "Plan", role: "planner", status: "todo", prompt: "Plan." }]);
    await orchestrator.runMission(m.id);
    const fin = store.get(m.id)!;
    const ev = fin.events.find((e) => {
      const d = e.data as { structuredFailure?: { class?: string; domain?: string }; recoveryRoute?: string } | undefined;
      return d?.structuredFailure?.domain === "validation" && d?.structuredFailure?.class === "repairable";
    });
    assert.ok(ev, "expected validation structuredFailure repairable");
    const d = ev!.data as { recoveryRoute?: string };
    assert.equal(d.recoveryRoute, "spawn_recovery_work");
    assert.ok(fin.events.some((e) => String(e.message || "").includes("Post-mutation verification")));
    assert.ok(fin.queue.some((w) => w.workItemPurpose === "failure_investigation_diagnose"));
  } finally {
    (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.failureInvestigation.enabled", false);
    (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 8);
    (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.verification.autoRunTestsAfterMutations", true);
    (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.verification.autoRunLinterAfterMutations", true);
  }
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
  const to = fin.events.find((e) => {
    const d = e.data as { structuredFailure?: { class?: string }; recoveryRoute?: string } | undefined;
    return d?.structuredFailure?.class === "transient" && d?.recoveryRoute === "retry_direct";
  });
  assert.ok(to, "timeout stream abort should classify as transient with retry_direct route");
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
