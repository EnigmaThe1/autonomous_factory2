import test from "node:test";
import assert from "node:assert/strict";
import { applyValidatorStructuredOutcomeToTurn } from "../missions/validatorOutcomeRouting";
import type { WorkItem } from "../types";

const validatorItem: WorkItem = {
  id: "v0",
  title: "Validate",
  role: "validator",
  status: "in_progress",
  prompt: "p"
};

test("applyValidatorStructuredOutcomeToTurn: pass forces complete", () => {
  const r = applyValidatorStructuredOutcomeToTurn(
    validatorItem,
    { outcome: "pass" },
    { summary: "x", decision: "needs_followup", nextWorkItems: [{ id: "w", title: "t", role: "implementer", status: "todo", prompt: "p" }] }
  );
  assert.equal(r.decision, "complete");
  assert.equal((r.nextWorkItems || []).length, 0);
});

test("applyValidatorStructuredOutcomeToTurn: fail adds remediation tail", () => {
  const r = applyValidatorStructuredOutcomeToTurn(validatorItem, { outcome: "fail" }, { summary: "bad" });
  assert.equal(r.decision, "needs_followup");
  const roles = (r.nextWorkItems || []).map((w) => w.role);
  assert.ok(roles.includes("implementer"));
  assert.ok(roles.includes("reviewer"));
  assert.ok(roles.includes("validator"));
});

test("applyValidatorStructuredOutcomeToTurn: inconclusive adds researcher and planner", () => {
  const r = applyValidatorStructuredOutcomeToTurn(
    validatorItem,
    { outcome: "inconclusive", suspectedClass: "code" },
    { summary: "unclear" }
  );
  const titles = (r.nextWorkItems || []).map((w) => w.title).join(" ");
  assert.match(titles, /inconclusive/i);
  assert.ok((r.nextWorkItems || []).some((w) => w.role === "researcher"));
  assert.ok((r.nextWorkItems || []).some((w) => w.role === "planner"));
});
