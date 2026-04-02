/**
 * Regression lock: canonical pre-release ship gate in README must not disappear silently.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(__dirname, "..", "..");

test("README: pre-release ship gate section and minimum manual/automated coverage", () => {
  const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
  const stabilityIdx = readme.indexOf("### Stability and verification");
  const gateIdx = readme.indexOf("#### Pre-release ship gate");
  assert.ok(stabilityIdx !== -1 && gateIdx > stabilityIdx, "ship gate should live under Stability and verification");

  assert.match(readme, /Pre-release ship gate.*VSIX considered releasable/s);

  assert.ok(readme.includes("`npm run ci`"), "README should require npm run ci");
  assert.ok(readme.includes("`npm run package`"), "README should require npm run package");

  const lower = readme.slice(gateIdx).toLowerCase();
  for (const needle of ["start mission", "resume", "approval", "bundle", "timeline", "blocked", "gated"]) {
    assert.ok(lower.includes(needle), `ship gate section should mention ${needle}`);
  }
  assert.ok(
    lower.includes("my_ai_run_http_integration") || lower.includes("test:http-integration"),
    "ship gate should document gated HttpClient / httpbin integration tests"
  );
});
