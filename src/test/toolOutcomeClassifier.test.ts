import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyToolOutcome,
  isRunCommandBenignDiscoveryFailure
} from "../missions/orchestrator/toolOutcomeClassifier";
import type { ToolResult } from "../tools/ToolRegistry";

test("isRunCommandBenignDiscoveryFailure: find missing directory (stderr)", () => {
  const r: ToolResult = {
    ok: false,
    summary: "Command failed (exit 1, 7ms): find docs/x -type f",
    data: {
      exitCode: 1,
      stderr: "find: 'docs/x': No such file or directory\n",
      stdout: "",
      timedOut: false,
      durationMs: 7
    }
  };
  assert.equal(isRunCommandBenignDiscoveryFailure(r), true);
});

test("isRunCommandBenignDiscoveryFailure: rejects exit 0", () => {
  assert.equal(
    isRunCommandBenignDiscoveryFailure({
      ok: true,
      summary: "ok",
      data: { exitCode: 0, stderr: "", stdout: "" }
    }),
    false
  );
});

test("isRunCommandBenignDiscoveryFailure: rejects grep no-match style (no path hint)", () => {
  assert.equal(
    isRunCommandBenignDiscoveryFailure({
      ok: false,
      summary: "Command failed (exit 1, 2ms): grep foo bar",
      data: { exitCode: 1, stderr: "", stdout: "", timedOut: false, durationMs: 2 }
    }),
    false
  );
});

test("classifyToolOutcome: runCommand missing-path failure continues when probe budget remains", () => {
  const decision = classifyToolOutcome({
    call: { tool: "runCommand", args: { command: "find x" } },
    result: {
      ok: false,
      summary: "Command failed (exit 1, 7ms): find x",
      data: {
        exitCode: 1,
        stderr: "find: 'x': No such file or directory\n",
        stdout: "",
        timedOut: false,
        durationMs: 7
      }
    },
    isReadonlyTool: false,
    isMutatingTool: true,
    readonlyBudgetRemaining: true,
    isReadFileMissing: false,
    runCommandProbeBudgetRemaining: true
  });
  assert.equal(decision.kind, "continue");
  if (decision.kind === "continue") {
    assert.equal(decision.category, "run_command_probe");
  }
});

test("classifyToolOutcome: runCommand missing-path failure falls through to agent retry when probe exhausted but agent retry budget remains", () => {
  const decision = classifyToolOutcome({
    call: { tool: "runCommand", args: {} },
    result: {
      ok: false,
      summary: "Command failed (exit 1, 7ms): find x",
      data: {
        exitCode: 1,
        stderr: "No such file or directory",
        stdout: ""
      }
    },
    isReadonlyTool: false,
    isMutatingTool: true,
    readonlyBudgetRemaining: true,
    isReadFileMissing: false,
    runCommandProbeBudgetRemaining: false,
    runCommandAgentRetryBudgetRemaining: true
  });
  assert.equal(decision.kind, "continue");
  if (decision.kind === "continue") {
    assert.equal(decision.category, "run_command_agent_retry");
  }
});

test("classifyToolOutcome: runCommand failure blocks when probe and agent retry budgets exhausted", () => {
  const decision = classifyToolOutcome({
    call: { tool: "runCommand", args: {} },
    result: {
      ok: false,
      summary: "Command failed (exit 1, 7ms): find x",
      data: {
        exitCode: 1,
        stderr: "No such file or directory",
        stdout: ""
      }
    },
    isReadonlyTool: false,
    isMutatingTool: true,
    readonlyBudgetRemaining: true,
    isReadFileMissing: false,
    runCommandProbeBudgetRemaining: false,
    runCommandAgentRetryBudgetRemaining: false
  });
  assert.equal(decision.kind, "blocked");
  if (decision.kind === "blocked") {
    assert.equal(decision.category, "tool_failure");
  }
});

test("classifyToolOutcome: runCommand exit 2 / syntax-style failure continues with agent retry budget", () => {
  const decision = classifyToolOutcome({
    call: { tool: "runCommand", args: { command: "function x(){ :; }" } },
    result: {
      ok: false,
      summary: "Command failed (exit 2, 7ms): …",
      data: { exitCode: 2, stderr: "", stdout: "", timedOut: false, durationMs: 7 }
    },
    isReadonlyTool: false,
    isMutatingTool: true,
    readonlyBudgetRemaining: true,
    isReadFileMissing: false,
    runCommandProbeBudgetRemaining: true,
    runCommandAgentRetryBudgetRemaining: true
  });
  assert.equal(decision.kind, "continue");
  if (decision.kind === "continue") {
    assert.equal(decision.category, "run_command_agent_retry");
  }
});

test("classifyToolOutcome: writeFile failure continues with write_file_agent_retry when budget remains", () => {
  const decision = classifyToolOutcome({
    call: { tool: "writeFile", args: { path: "x.txt" } },
    result: { ok: false, summary: "write failed" },
    isReadonlyTool: false,
    isMutatingTool: true,
    readonlyBudgetRemaining: true,
    isReadFileMissing: false,
    runCommandProbeBudgetRemaining: true,
    runCommandAgentRetryBudgetRemaining: true,
    writeFileAgentRetryBudgetRemaining: true,
    applyPatchAgentRetryBudgetRemaining: true
  });
  assert.equal(decision.kind, "continue");
  if (decision.kind === "continue") assert.equal(decision.category, "write_file_agent_retry");
});

test("classifyToolOutcome: writeFile failure blocks when write retry budget exhausted", () => {
  const decision = classifyToolOutcome({
    call: { tool: "writeFile", args: {} },
    result: { ok: false, summary: "write failed" },
    isReadonlyTool: false,
    isMutatingTool: true,
    readonlyBudgetRemaining: true,
    isReadFileMissing: false,
    runCommandProbeBudgetRemaining: true,
    runCommandAgentRetryBudgetRemaining: true,
    writeFileAgentRetryBudgetRemaining: false,
    applyPatchAgentRetryBudgetRemaining: true
  });
  assert.equal(decision.kind, "blocked");
});

test("classifyToolOutcome: applyPatch failure continues with apply_patch_agent_retry when budget remains", () => {
  const decision = classifyToolOutcome({
    call: { tool: "applyPatch", args: { path: "a.ts", search: "old", replace: "new" } },
    result: { ok: false, summary: "Search text not found in /x/a.ts" },
    isReadonlyTool: false,
    isMutatingTool: true,
    readonlyBudgetRemaining: true,
    isReadFileMissing: false,
    runCommandProbeBudgetRemaining: true,
    runCommandAgentRetryBudgetRemaining: true,
    writeFileAgentRetryBudgetRemaining: true,
    applyPatchAgentRetryBudgetRemaining: true
  });
  assert.equal(decision.kind, "continue");
  if (decision.kind === "continue") assert.equal(decision.category, "apply_patch_agent_retry");
});

test("classifyToolOutcome: applyPatch ENOENT in crashed summary continues with apply_patch_agent_retry when budget remains", () => {
  const decision = classifyToolOutcome({
    call: { tool: "applyPatch", args: { path: "logs/inventory_ledger.md" } },
    result: {
      ok: false,
      summary:
        "applyPatch crashed: Error: ENOENT: no such file or directory, open '/srv/.../logs/inventory_ledger.md'"
    },
    isReadonlyTool: false,
    isMutatingTool: true,
    readonlyBudgetRemaining: true,
    isReadFileMissing: false,
    runCommandProbeBudgetRemaining: true,
    runCommandAgentRetryBudgetRemaining: true,
    writeFileAgentRetryBudgetRemaining: true,
    applyPatchAgentRetryBudgetRemaining: true
  });
  assert.equal(decision.kind, "continue");
  if (decision.kind === "continue") assert.equal(decision.category, "apply_patch_agent_retry");
});

test("classifyToolOutcome: applyPatch non-ENOENT crash still blocks", () => {
  const decision = classifyToolOutcome({
    call: { tool: "applyPatch", args: { path: "a.ts" } },
    result: { ok: false, summary: "applyPatch crashed: TypeError: terminated" },
    isReadonlyTool: false,
    isMutatingTool: true,
    readonlyBudgetRemaining: true,
    isReadFileMissing: false,
    runCommandProbeBudgetRemaining: true,
    runCommandAgentRetryBudgetRemaining: true,
    writeFileAgentRetryBudgetRemaining: true,
    applyPatchAgentRetryBudgetRemaining: true
  });
  assert.equal(decision.kind, "blocked");
});

test("classifyToolOutcome: tool executor crash summary blocks (no agent retry)", () => {
  const decision = classifyToolOutcome({
    call: { tool: "writeFile", args: {} },
    result: { ok: false, summary: "writeFile crashed: simulated throw" },
    isReadonlyTool: false,
    isMutatingTool: true,
    readonlyBudgetRemaining: true,
    isReadFileMissing: false,
    writeFileAgentRetryBudgetRemaining: true,
    applyPatchAgentRetryBudgetRemaining: true
  });
  assert.equal(decision.kind, "blocked");
});

test("classifyToolOutcome: transient mutating wins over write_file_agent_retry", () => {
  const decision = classifyToolOutcome({
    call: { tool: "writeFile", args: {} },
    result: { ok: false, summary: "ETIMEDOUT: request timed out" },
    isReadonlyTool: false,
    isMutatingTool: true,
    readonlyBudgetRemaining: true,
    isReadFileMissing: false,
    transientMutatingBudgetRemaining: true,
    runCommandProbeBudgetRemaining: true,
    runCommandAgentRetryBudgetRemaining: true,
    writeFileAgentRetryBudgetRemaining: true,
    applyPatchAgentRetryBudgetRemaining: true
  });
  assert.equal(decision.kind, "continue");
  if (decision.kind === "continue") assert.equal(decision.category, "transient_mutating");
});
