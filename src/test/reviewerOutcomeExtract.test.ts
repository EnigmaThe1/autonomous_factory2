import test from "node:test";
import assert from "node:assert/strict";
import {
  extractReviewerStructuredOutcome,
  reviewerStructuredOutcomeIsExplicitlyApproved,
  reviewerStructuredOutcomeRequiresImplementerFollowUp
} from "../missions/reviewerOutcomeExtract";
import { shouldEnqueueReviewerAutoRemediation } from "../missions/reviewerRemediationPolicy";
import type { WorkItem } from "../types";

test("extractReviewerStructuredOutcome parses lines", () => {
  const t = "Narrative\nREVIEW_OUTCOME: revision_required\nREVIEW_SEVERITY: high\nREVIEW_FINDINGS: missing tests\n";
  const p = extractReviewerStructuredOutcome(t);
  assert.equal(p.outcome, "revision_required");
  assert.equal(p.severity, "high");
  assert.match(p.findings || "", /missing tests/);
});

test("reviewerStructuredOutcomeRequiresImplementerFollowUp respects implementer nextWorkItems", () => {
  assert.equal(
    reviewerStructuredOutcomeRequiresImplementerFollowUp({ outcome: "revision_required" }, "x", [
      { id: "1", title: "t", role: "implementer", status: "todo", prompt: "p" } as WorkItem
    ]),
    false
  );
});

test("shouldEnqueueReviewerAutoRemediation: structured approved skips heuristic defects", () => {
  assert.equal(
    shouldEnqueueReviewerAutoRemediation({
      itemRole: "reviewer",
      skipBecauseAlreadySatisfiedNoTool: false,
      autoCreateFixTasksSetting: true,
      summary: "REVIEW_OUTCOME: approved\nStill mentions defect keyword bug in passing.\n",
      nextWorkItems: []
    }),
    false
  );
});

test("shouldEnqueueReviewerAutoRemediation: structured revision_required triggers", () => {
  assert.equal(
    shouldEnqueueReviewerAutoRemediation({
      itemRole: "reviewer",
      skipBecauseAlreadySatisfiedNoTool: false,
      autoCreateFixTasksSetting: true,
      summary: "REVIEW_OUTCOME: revision_required\nREVIEW_FINDINGS: gap\n",
      nextWorkItems: []
    }),
    true
  );
});
