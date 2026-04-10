import test from "node:test";
import assert from "node:assert/strict";
import {
  extractValidationVerdictFromSummary,
  extractValidationStructuredFromSummary,
  validationStructuredToOutcome
} from "../missions/validatorVerdictExtract";

test("extractValidationVerdictFromSummary: both lines", () => {
  const t = "Some narrative.\nVALIDATION_VERDICT: PASS_WITH_LIMITS — smoke only\nVALIDATION_LIMITS: did not run e2e\n";
  const r = extractValidationVerdictFromSummary(t);
  assert.match(r.validationVerdict || "", /PASS_WITH_LIMITS/);
  assert.match(r.validationLimits || "", /e2e/);
});

test("extractValidationVerdictFromSummary: empty", () => {
  assert.deepEqual(extractValidationVerdictFromSummary(""), {});
});

test("extractValidationStructuredFromSummary: outcome and suspected class", () => {
  const t = "VALIDATION_OUTCOME: inconclusive\nVALIDATION_SUSPECTED_CLASS: environment\n";
  const r = extractValidationStructuredFromSummary(t);
  assert.equal(r.validationOutcome, "inconclusive");
  assert.equal(r.validationSuspectedClass, "environment");
  const o = validationStructuredToOutcome(r);
  assert.equal(o?.outcome, "inconclusive");
  assert.equal(o?.suspectedClass, "environment");
});
