import test from "node:test";
import assert from "node:assert/strict";
import { reconcileStaleApprovalPendingHardStops } from "../missions/missionApprovalGateReconcile";
import type { ApprovalRequest, WorkItem } from "../types";

test("reconcileStaleApprovalPendingHardStops: clears blocked item when no pending approval for workItemId", () => {
  const queue: WorkItem[] = [
    {
      id: "i1",
      title: "Impl",
      role: "implementer",
      status: "blocked",
      prompt: "p",
      hardStopClass: "approval_pending",
      output: "was stuck"
    }
  ];
  const approvals: ApprovalRequest[] = [];
  const { queue: q2, changedIds } = reconcileStaleApprovalPendingHardStops(queue, approvals);
  assert.deepEqual(changedIds, ["i1"]);
  assert.equal(q2[0]!.status, "todo");
  assert.equal(q2[0]!.hardStopClass, undefined);
  assert.match(q2[0]!.output || "", /stale approval_pending/i);
});

test("reconcileStaleApprovalPendingHardStops: keeps item when pending approval references workItemId", () => {
  const queue: WorkItem[] = [
    {
      id: "i1",
      title: "Impl",
      role: "implementer",
      status: "blocked",
      prompt: "p",
      hardStopClass: "approval_pending"
    }
  ];
  const approvals: ApprovalRequest[] = [
    {
      id: "a1",
      createdAt: 1,
      missionId: "m",
      kind: "terminal",
      title: "t",
      details: "d",
      toolCall: { tool: "runCommand", args: {} },
      status: "pending",
      workItemId: "i1"
    }
  ];
  const { queue: q2, changedIds } = reconcileStaleApprovalPendingHardStops(queue, approvals);
  assert.equal(changedIds.length, 0);
  assert.equal(q2[0]!.status, "blocked");
  assert.equal(q2[0]!.hardStopClass, "approval_pending");
});
