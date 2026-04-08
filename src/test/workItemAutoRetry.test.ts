import test from "node:test";
import assert from "node:assert/strict";
import { shouldAutoRetry, createRetryWorkItem, shouldMarkWorkItemDeadLetter } from "../missions/workItemAutoRetry";
import type { WorkItem } from "../types";

function makeItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "w-1",
    title: "Test task",
    role: "implementer",
    status: "failed",
    prompt: "Do the thing",
    output: "Error: ENOENT no such file or directory",
    ...overrides,
  };
}

// shouldAutoRetry tests
test("shouldAutoRetry: retries failed item within limit", () => {
  const decision = shouldAutoRetry(makeItem(), 2);
  assert.equal(decision.shouldRetry, true);
  assert.ok(decision.reason.includes("1/2"));
});

test("shouldAutoRetry: retries on second attempt", () => {
  const decision = shouldAutoRetry(makeItem({ retryCount: 1 }), 2);
  assert.equal(decision.shouldRetry, true);
  assert.ok(decision.reason.includes("2/2"));
});

test("shouldAutoRetry: rejects when max retries reached", () => {
  const decision = shouldAutoRetry(makeItem({ retryCount: 2 }), 2);
  assert.equal(decision.shouldRetry, false);
  assert.ok(decision.reason.includes("Max retries"));
});

test("shouldAutoRetry: rejects non-failed items", () => {
  const decision = shouldAutoRetry(makeItem({ status: "done" }), 2);
  assert.equal(decision.shouldRetry, false);
});

test("shouldAutoRetry: rejects approval_pending hard-stop", () => {
  const decision = shouldAutoRetry(makeItem({ hardStopClass: "approval_pending" }), 2);
  assert.equal(decision.shouldRetry, false);
  assert.ok(decision.reason.includes("human intervention"));
});

test("shouldAutoRetry: rejects approval_rejected hard-stop", () => {
  const decision = shouldAutoRetry(makeItem({ hardStopClass: "approval_rejected" }), 2);
  assert.equal(decision.shouldRetry, false);
});

test("shouldAutoRetry: rejects operator_abort hard-stop", () => {
  const decision = shouldAutoRetry(makeItem({ hardStopClass: "operator_abort" }), 2);
  assert.equal(decision.shouldRetry, false);
});

test("shouldAutoRetry: rejects policy_blocked hard-stop", () => {
  const decision = shouldAutoRetry(makeItem({ hardStopClass: "policy_blocked" }), 2);
  assert.equal(decision.shouldRetry, false);
});

test("shouldAutoRetry: allows timeout_or_system_abort retry", () => {
  const decision = shouldAutoRetry(makeItem({ hardStopClass: "timeout_or_system_abort" }), 2);
  assert.equal(decision.shouldRetry, true);
});

test("shouldAutoRetry: allows tool_failure retry", () => {
  const decision = shouldAutoRetry(makeItem({ hardStopClass: "tool_failure" }), 2);
  assert.equal(decision.shouldRetry, true);
});

test("shouldAutoRetry: rejects with active mutating tool call", () => {
  const decision = shouldAutoRetry(makeItem({
    activeMutatingToolCall: { tool: "writeFile", startedAt: Date.now() }
  }), 2);
  assert.equal(decision.shouldRetry, false);
  assert.ok(decision.reason.includes("mutating"));
});

test("shouldAutoRetry: rejects with 0 max retries", () => {
  const decision = shouldAutoRetry(makeItem(), 0);
  assert.equal(decision.shouldRetry, false);
});

test("shouldMarkWorkItemDeadLetter: true when max retries reached", () => {
  const d = shouldAutoRetry(makeItem({ retryCount: 2 }), 2);
  assert.equal(shouldMarkWorkItemDeadLetter(makeItem({ retryCount: 2 }), d), true);
});

test("shouldMarkWorkItemDeadLetter: true when max retries is 0", () => {
  const d = shouldAutoRetry(makeItem(), 0);
  assert.equal(shouldMarkWorkItemDeadLetter(makeItem(), d), true);
});

test("shouldMarkWorkItemDeadLetter: false for hard-stop (no retry budget semantics)", () => {
  const d = shouldAutoRetry(makeItem({ hardStopClass: "approval_pending" }), 2);
  assert.equal(shouldMarkWorkItemDeadLetter(makeItem({ hardStopClass: "approval_pending" }), d), false);
});

test("shouldMarkWorkItemDeadLetter: false when still retryable", () => {
  const d = shouldAutoRetry(makeItem(), 2);
  assert.equal(shouldMarkWorkItemDeadLetter(makeItem(), d), false);
});

test("shouldMarkWorkItemDeadLetter: false if already dead letter", () => {
  const d = shouldAutoRetry(makeItem({ retryCount: 2, deadLetter: true }), 2);
  assert.equal(shouldMarkWorkItemDeadLetter(makeItem({ retryCount: 2, deadLetter: true }), d), false);
});

test("shouldMarkWorkItemDeadLetter: false with active mutating tool call", () => {
  const d = shouldAutoRetry(
    makeItem({ activeMutatingToolCall: { tool: "writeFile", startedAt: 1 } }),
    2
  );
  assert.equal(
    shouldMarkWorkItemDeadLetter(
      makeItem({ activeMutatingToolCall: { tool: "writeFile", startedAt: 1 } }),
      d
    ),
    false
  );
});

// createRetryWorkItem tests
test("createRetryWorkItem: creates correct retry clone", () => {
  const item = makeItem({ retryCount: 0 });
  const retry = createRetryWorkItem(item);
  assert.equal(retry.status, "todo");
  assert.equal(retry.retryCount, 1);
  assert.ok(retry.title.includes("(retry 1)"));
  assert.ok(retry.prompt.includes("[RETRY 1]"));
  assert.ok(retry.prompt.includes("ENOENT"));
  assert.equal(retry.role, "implementer");
  assert.notEqual(retry.id, item.id);
});

test("createRetryWorkItem: increments retry count", () => {
  const item = makeItem({ retryCount: 2 });
  const retry = createRetryWorkItem(item);
  assert.equal(retry.retryCount, 3);
  assert.ok(retry.title.includes("(retry 3)"));
});

test("createRetryWorkItem: preserves dependencies", () => {
  const item = makeItem({ dependsOn: ["dep-1", "dep-2"] });
  const retry = createRetryWorkItem(item);
  assert.deepEqual(retry.dependsOn, ["dep-1", "dep-2"]);
});

test("createRetryWorkItem: stores previous error", () => {
  const item = makeItem({ output: "Fatal: module not found" });
  const retry = createRetryWorkItem(item);
  assert.equal(retry.previousError, "Fatal: module not found");
});

test("createRetryWorkItem: truncates long errors", () => {
  const item = makeItem({ output: "x".repeat(5000) });
  const retry = createRetryWorkItem(item);
  assert.ok(retry.previousError!.length <= 2000);
});

test("createRetryWorkItem: handles no output", () => {
  const item = makeItem({ output: undefined });
  const retry = createRetryWorkItem(item);
  assert.ok(retry.prompt.includes("Previous attempt failed"));
  assert.equal(retry.previousError, undefined);
});
