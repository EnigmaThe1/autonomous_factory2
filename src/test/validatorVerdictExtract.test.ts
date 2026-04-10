import test from "node:test";
import assert from "node:assert/strict";
import { extractValidationVerdictFromSummary } from "../missions/validatorVerdictExtract";

test("extractValidationVerdictFromSummary: both lines", () => {
  const t = "Some narrative.\nVALIDATION_VERDICT: PASS_WITH_LIMITS — smoke only\nVALIDATION_LIMITS: did not run e2e\n";
  const r = extractValidationVerdictFromSummary(t);
  assert.match(r.validationVerdict || "", /PASS_WITH_LIMITS/);
  assert.match(r.validationLimits || "", /e2e/);
});

test("extractValidationVerdictFromSummary: empty", () => {
  assert.deepEqual(extractValidationVerdictFromSummary(""), {});
});
