import test from "node:test";
import assert from "node:assert/strict";
import {
  canTransitionWorkItemStatus,
  displayLabelForWorkItemStatus,
  normalizeWorkItem,
  resolveActiveStatusForWorkItem
} from "../missions/workItemLifecycle";
import type { WorkItem } from "../types";

test("normalizeWorkItem: running → in_progress", () => {
  const w = normalizeWorkItem({
    id: "a",
    title: "t",
    role: "planner",
    status: "running",
    prompt: "p"
  });
  assert.equal(w.status, "in_progress");
});

test("normalizeWorkItem: deadLetter flag upgrades failed to dead_letter", () => {
  const w = normalizeWorkItem({
    id: "a",
    title: "t",
    role: "implementer",
    status: "failed",
    prompt: "p",
    deadLetter: true
  });
  assert.equal(w.status, "dead_letter");
});

test("resolveActiveStatusForWorkItem: diagnosis and retry purposes", () => {
  const diag: WorkItem = {
    id: "1",
    title: "d",
    role: "researcher",
    status: "todo",
    prompt: "p",
    workItemPurpose: "failure_investigation_diagnose"
  };
  assert.equal(resolveActiveStatusForWorkItem(diag), "diagnosing");
  const retry: WorkItem = {
    id: "2",
    title: "r",
    role: "implementer",
    status: "retry_ready",
    prompt: "p",
    workItemPurpose: "failure_recovery_retry"
  };
  assert.equal(resolveActiveStatusForWorkItem(retry), "repairing");
  const plain: WorkItem = {
    id: "3",
    title: "x",
    role: "implementer",
    status: "todo",
    prompt: "p"
  };
  assert.equal(resolveActiveStatusForWorkItem(plain), "in_progress");
});

test("canTransitionWorkItemStatus: todo → in_progress and to terminal", () => {
  assert.ok(canTransitionWorkItemStatus("todo", "in_progress"));
  assert.ok(canTransitionWorkItemStatus("in_progress", "done"));
  assert.ok(canTransitionWorkItemStatus("in_progress", "failed"));
  assert.ok(canTransitionWorkItemStatus("awaiting_approval", "blocked"));
  assert.ok(canTransitionWorkItemStatus("awaiting_approval", "todo"));
});

test("canTransitionWorkItemStatus: recovery queue states reach actives", () => {
  assert.ok(canTransitionWorkItemStatus("retry_ready", "repairing"));
  assert.ok(canTransitionWorkItemStatus("repairing", "done"));
  assert.ok(canTransitionWorkItemStatus("review_pending", "in_progress"));
});

test("displayLabelForWorkItemStatus: recovery labels", () => {
  assert.equal(displayLabelForWorkItemStatus("diagnosing"), "Diagnosing");
  assert.equal(displayLabelForWorkItemStatus("repairing"), "Repairing");
  assert.equal(displayLabelForWorkItemStatus("awaiting_approval"), "Awaiting approval");
});
