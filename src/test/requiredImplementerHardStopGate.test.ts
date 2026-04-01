import test from "node:test";
import assert from "node:assert/strict";
import type { Mission, WorkItem } from "../types";
import { classifyImplementerHardStopDownstreamGate } from "../missions/requiredImplementerHardStopGate";

const basePolicy = {
  closureRequired: true,
  requireReviewerBeforeComplete: true,
  requireValidatorBeforeComplete: true,
  requireImplementerBeforeComplete: true,
  autoContinue: true,
  maxAutoRounds: 24,
  minCompletedWorkItems: 1,
  stallReplanThreshold: 3
};

function miniMission(queue: WorkItem[], overrides: Partial<Mission> = {}): Mission {
  return {
    id: "m1",
    title: "t",
    prompt: "p",
    createdAt: 1,
    updatedAt: 1,
    status: "blocked",
    activeProviderId: "p",
    currentStep: 0,
    policy: basePolicy,
    queue,
    memory: [],
    events: [],
    checkpoints: [],
    approvals: [],
    validationState: "failed",
    ...overrides
  };
}

function impl(status: WorkItem["status"], hardStopClass: WorkItem["hardStopClass"]): WorkItem {
  return { id: "wi", title: "i", role: "implementer", status, prompt: "x", hardStopClass };
}

test("no required implementer blocked/failed → not gated", () => {
  assert.equal(classifyImplementerHardStopDownstreamGate(miniMission([])).gate, false);
  assert.equal(
    classifyImplementerHardStopDownstreamGate(
      miniMission([{ id: "w1", title: "p", role: "planner", status: "todo", prompt: "p" }])
    ).gate,
    false
  );
});

test("blocked implementer without hardStopClass → gated unknown (contract violation)", () => {
  const r = classifyImplementerHardStopDownstreamGate(
    miniMission([{ id: "wi", title: "i", role: "implementer", status: "blocked", prompt: "x", output: "Tool execution failed: x" }])
  );
  assert.equal(r.gate, true);
  assert.equal(r.failureClass, "unknown");
  assert.equal(r.malformed, "missing_hard_stop_class");
  assert.match(r.reason || "", /without hardStopClass/);
});

test("timeout_or_system_abort → not gated", () => {
  const r = classifyImplementerHardStopDownstreamGate(miniMission([impl("failed", "timeout_or_system_abort")]));
  assert.equal(r.gate, false);
  assert.equal(r.failureClass, "timeout_or_system_abort");
  assert.equal(r.malformed, undefined);
});

test("tool_failure → gated", () => {
  const r = classifyImplementerHardStopDownstreamGate(miniMission([impl("failed", "tool_failure")]));
  assert.equal(r.gate, true);
  assert.equal(r.failureClass, "tool_failure");
  assert.equal(r.malformed, undefined);
});

test("unknown_hard_stop maps to failureClass unknown", () => {
  const r = classifyImplementerHardStopDownstreamGate(miniMission([impl("blocked", "unknown_hard_stop")]));
  assert.equal(r.gate, true);
  assert.equal(r.failureClass, "unknown");
  assert.equal(r.malformed, undefined);
});

test("unrecognized hardStopClass value → gated unknown + malformed", () => {
  const r = classifyImplementerHardStopDownstreamGate(
    miniMission([
      { id: "wi", title: "i", role: "implementer", status: "blocked", prompt: "x", hardStopClass: "not_a_real_enum" as any }
    ])
  );
  assert.equal(r.gate, true);
  assert.equal(r.failureClass, "unknown");
  assert.equal(r.malformed, "unrecognized_hard_stop_class");
  assert.match(r.reason || "", /unrecognized hardStopClass/i);
});

test("empty string hardStopClass is malformed missing", () => {
  const r = classifyImplementerHardStopDownstreamGate(
    miniMission([
      { id: "wi", title: "i", role: "implementer", status: "failed", prompt: "x", hardStopClass: "" as any }
    ])
  );
  assert.equal(r.malformed, "missing_hard_stop_class");
});
