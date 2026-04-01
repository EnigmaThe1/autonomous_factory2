import test from "node:test";
import assert from "node:assert/strict";
import {
  countOperatorStreamAbortRequeues,
  recoverInterruptedQueueItems,
  requeueOperatorStreamAbortedWorkItems
} from "../missions/resumeRecovery";
import { WorkItem } from "../types";

test("recoverInterruptedQueueItems requeues stale running items as todo", () => {
  const queue: WorkItem[] = [
    { id: "w1", title: "A", role: "planner", status: "running", prompt: "p1" },
    { id: "w2", title: "B", role: "implementer", status: "todo", prompt: "p2" }
  ];
  const recovered = recoverInterruptedQueueItems(queue);
  assert.equal(recovered.recoveredCount, 1);
  assert.equal(recovered.replayRiskCount, 0);
  assert.equal(recovered.queue[0].status, "todo");
  assert.match(recovered.queue[0].output || "", /Recovered after host interruption/i);
  assert.equal(recovered.queue[1].status, "todo");
});

test("recoverInterruptedQueueItems keeps non-running items unchanged", () => {
  const queue: WorkItem[] = [
    { id: "w1", title: "A", role: "planner", status: "done", prompt: "p1", output: "ok" },
    { id: "w2", title: "B", role: "implementer", status: "blocked", prompt: "p2", output: "wait" }
  ];
  const recovered = recoverInterruptedQueueItems(queue);
  assert.equal(recovered.recoveredCount, 0);
  assert.equal(recovered.replayRiskCount, 0);
  assert.deepEqual(recovered.queue, queue);
});

test("recoverInterruptedQueueItems blocks replay when interrupted running work has active mutating tool marker", () => {
  const queue: WorkItem[] = [
    {
      id: "w1",
      title: "A",
      role: "implementer",
      status: "running",
      prompt: "p1",
      activeMutatingToolCall: { tool: "writeFile", target: "x.txt", startedAt: 123 }
    }
  ];
  const recovered = recoverInterruptedQueueItems(queue);
  assert.equal(recovered.recoveredCount, 0);
  assert.equal(recovered.replayRiskCount, 1);
  assert.equal(recovered.queue[0].status, "blocked");
  assert.equal(recovered.queue[0].hardStopClass, "unknown_hard_stop");
  assert.match(recovered.queue[0].output || "", /manual review/i);
});

test("requeueOperatorStreamAbortedWorkItems only touches operator stream abort blocked items", () => {
  const before: WorkItem[] = [
    {
      id: "a",
      title: "t",
      role: "implementer",
      status: "blocked",
      prompt: "p",
      hardStopClass: "operator_abort",
      output: "Model stream cancelled (operator abort)."
    },
    {
      id: "b",
      title: "t2",
      role: "implementer",
      status: "blocked",
      prompt: "p",
      hardStopClass: "approval_pending",
      output: "Pending approval: x"
    }
  ];
  const after = requeueOperatorStreamAbortedWorkItems(before);
  assert.equal(after[0].status, "todo");
  assert.match(after[0].output || "", /Re-queued after resume/);
  assert.equal(after[1].status, "blocked");
  assert.equal(countOperatorStreamAbortRequeues(before, after), 1);
});

test("requeueOperatorStreamAbortedWorkItems ignores output marker without hardStopClass", () => {
  const before: WorkItem[] = [
    {
      id: "a",
      title: "t",
      role: "implementer",
      status: "blocked",
      prompt: "p",
      output: "Model stream cancelled (operator abort)."
    }
  ];
  const after = requeueOperatorStreamAbortedWorkItems(before);
  assert.equal(after[0].status, "blocked");
  assert.equal(countOperatorStreamAbortRequeues(before, after), 0);
});
