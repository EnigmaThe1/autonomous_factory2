import test from "node:test";
import assert from "node:assert/strict";
import {
  reviewerModelOutputSuggestsRemediation,
  shouldEnqueueReviewerAutoRemediation
} from "../missions/reviewerRemediationPolicy";

test("Case 2 — reviewer already_satisfied no-tool: skip flag suppresses auto remediation (no fake follow-up work)", () => {
  assert.equal(
    shouldEnqueueReviewerAutoRemediation({
      itemRole: "reviewer",
      skipBecauseAlreadySatisfiedNoTool: true,
      autoCreateFixTasksSetting: true,
      summary: "[already_satisfied] clean\n\nALREADY_SATISFIED: requirements already met",
      nextWorkItems: []
    }),
    false
  );
});

test("Case 2b — same noisy summary without skip would suggest remediation (heuristic)", () => {
  assert.equal(
    reviewerModelOutputSuggestsRemediation("[already_satisfied] x\n\nCritical defect found", []),
    true
  );
  assert.equal(
    shouldEnqueueReviewerAutoRemediation({
      itemRole: "reviewer",
      skipBecauseAlreadySatisfiedNoTool: false,
      autoCreateFixTasksSetting: true,
      summary: "[already_satisfied] x\n\nCritical defect found",
      nextWorkItems: []
    }),
    true
  );
});

test("non-reviewer role never enqueues reviewer remediation contract", () => {
  assert.equal(
    shouldEnqueueReviewerAutoRemediation({
      itemRole: "implementer",
      skipBecauseAlreadySatisfiedNoTool: false,
      autoCreateFixTasksSetting: true,
      summary: "bug bug bug",
      nextWorkItems: []
    }),
    false
  );
});

test("implementer follow-up in nextWorkItems suppresses remediation signal", () => {
  assert.equal(
    reviewerModelOutputSuggestsRemediation("issues remain", [
      { id: "w", title: "fix", role: "implementer", status: "todo", prompt: "p" }
    ]),
    false
  );
});
