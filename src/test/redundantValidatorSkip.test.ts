import test from "node:test";
import assert from "node:assert/strict";
import { shouldSkipRedundantValidatorWork } from "../missions/redundantValidatorSkip";
import { Mission, WorkItem } from "../types";

const baseMission = (patch: Partial<Mission>): Mission =>
  ({
    id: "m1",
    title: "t",
    prompt: "p",
    createdAt: 0,
    updatedAt: 0,
    status: "running",
    activeProviderId: "x",
    queue: [],
    memory: [],
    events: [],
    checkpoints: [],
    approvals: [],
    currentStep: 0,
    policy: {} as Mission["policy"],
    ...patch
  }) as Mission;

test("does not skip first validator (pending, none done)", () => {
  const q: WorkItem[] = [{ id: "v1", title: "v", role: "validator", status: "todo", prompt: "p" }];
  const m = baseMission({ validationState: "pending", queue: q });
  assert.equal(shouldSkipRedundantValidatorWork(m, q[0]), false);
});

test("skips second validator when passed and one validator done", () => {
  const q: WorkItem[] = [
    { id: "v1", title: "first", role: "validator", status: "done", prompt: "p" },
    { id: "v2", title: "Required validation before completion", role: "validator", status: "todo", prompt: "p" }
  ];
  const m = baseMission({ validationState: "passed", queue: q });
  assert.equal(shouldSkipRedundantValidatorWork(m, q[1]), true);
});

test("does not skip when passed but no validator done yet", () => {
  const q: WorkItem[] = [{ id: "v1", title: "v", role: "validator", status: "todo", prompt: "p" }];
  const m = baseMission({ validationState: "passed", queue: q });
  assert.equal(shouldSkipRedundantValidatorWork(m, q[0]), false);
});
