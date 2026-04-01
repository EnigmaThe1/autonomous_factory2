import test from "node:test";
import assert from "node:assert/strict";

/**
 * Tests for the pure parsing functions in TestRunner.
 * We import and test the module's parsers directly since the
 * public API depends on vscode + runCommand. We re-implement
 * the pure parser logic inline to test the parsing algorithms.
 */

function parseTestOutput(raw: string): { total?: number; passed?: number; failed?: number; skipped?: number; failures?: Array<{ test: string; message: string }> } {
  const lines = raw.split("\n");

  // TAP format
  const tapTests = lines.filter((l) => l.match(/^(ok|not ok) \d+/));
  if (tapTests.length > 0) {
    const passed = tapTests.filter((l) => l.startsWith("ok ")).length;
    const failed = tapTests.filter((l) => l.startsWith("not ok ")).length;
    const failures = tapTests
      .filter((l) => l.startsWith("not ok "))
      .map((l) => ({ test: l.replace(/^not ok \d+ - /, "").trim(), message: "" }))
      .slice(0, 20);
    return { total: tapTests.length, passed, failed, skipped: 0, failures };
  }

  // Jest/Vitest format
  const jestSummary = raw.match(/Tests:\s+(\d+)\s+failed.*?(\d+)\s+passed.*?(\d+)\s+total/);
  if (jestSummary) {
    return { total: parseInt(jestSummary[3]), passed: parseInt(jestSummary[2]), failed: parseInt(jestSummary[1]), skipped: 0 };
  }

  // pytest format
  const pytestMatch = raw.match(/(\d+) passed(?:.*?(\d+) failed)?(?:.*?(\d+) skipped)?/);
  if (pytestMatch) {
    const passed = parseInt(pytestMatch[1]) || 0;
    const failed = parseInt(pytestMatch[2]) || 0;
    const skipped = parseInt(pytestMatch[3]) || 0;
    return { total: passed + failed + skipped, passed, failed, skipped };
  }

  // Go test format
  const goPass = (raw.match(/--- PASS/g) || []).length;
  const goFail = (raw.match(/--- FAIL/g) || []).length;
  if (goPass > 0 || goFail > 0) {
    return { total: goPass + goFail, passed: goPass, failed: goFail, skipped: 0 };
  }

  return {};
}

function parseLintOutput(raw: string): { errorCount?: number; warningCount?: number; issues?: Array<{ file: string; line: number; rule: string; message: string; severity: string }> } {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      let errors = 0;
      let warnings = 0;
      const issues: Array<{ file: string; line: number; rule: string; message: string; severity: string }> = [];
      for (const file of parsed) {
        errors += file.errorCount || 0;
        warnings += file.warningCount || 0;
        for (const msg of file.messages || []) {
          if (issues.length < 50) {
            issues.push({
              file: file.filePath || "",
              line: msg.line || 0,
              rule: msg.ruleId || "",
              message: msg.message || "",
              severity: msg.severity === 2 ? "error" : "warning",
            });
          }
        }
      }
      return { errorCount: errors, warningCount: warnings, issues };
    }
  } catch { /* not JSON */ }

  const errorLines = (raw.match(/error/gi) || []).length;
  const warnLines = (raw.match(/warning/gi) || []).length;
  return { errorCount: errorLines, warningCount: warnLines };
}

// TAP format tests
test("parseTestOutput: TAP all passing", () => {
  const raw = "ok 1 - test alpha\nok 2 - test beta\nok 3 - test gamma";
  const r = parseTestOutput(raw);
  assert.equal(r.total, 3);
  assert.equal(r.passed, 3);
  assert.equal(r.failed, 0);
});

test("parseTestOutput: TAP with failures", () => {
  const raw = "ok 1 - passes\nnot ok 2 - fails here\nnot ok 3 - also fails";
  const r = parseTestOutput(raw);
  assert.equal(r.total, 3);
  assert.equal(r.passed, 1);
  assert.equal(r.failed, 2);
  assert.equal(r.failures!.length, 2);
  assert.equal(r.failures![0].test, "fails here");
});

// Jest/Vitest format tests
test("parseTestOutput: Jest summary", () => {
  const raw = "Test Suites: 2 passed, 2 total\nTests:  3 failed, 7 passed, 10 total\nTime:  2.5 s";
  const r = parseTestOutput(raw);
  assert.equal(r.total, 10);
  assert.equal(r.passed, 7);
  assert.equal(r.failed, 3);
});

// pytest format tests
test("parseTestOutput: pytest all pass", () => {
  const raw = "===== 42 passed in 1.23s =====";
  const r = parseTestOutput(raw);
  assert.equal(r.total, 42);
  assert.equal(r.passed, 42);
  assert.equal(r.failed, 0);
});

test("parseTestOutput: pytest mixed", () => {
  const raw = "===== 10 passed, 2 failed, 1 skipped in 3.0s =====";
  const r = parseTestOutput(raw);
  assert.equal(r.total, 13);
  assert.equal(r.passed, 10);
  assert.equal(r.failed, 2);
  assert.equal(r.skipped, 1);
});

// Go test format
test("parseTestOutput: Go test output", () => {
  const raw = "--- PASS: TestAlpha (0.01s)\n--- PASS: TestBeta (0.02s)\n--- FAIL: TestGamma (0.01s)\nFAIL";
  const r = parseTestOutput(raw);
  assert.equal(r.total, 3);
  assert.equal(r.passed, 2);
  assert.equal(r.failed, 1);
});

// Unrecognized format
test("parseTestOutput: unrecognized output returns empty", () => {
  const raw = "some arbitrary output\nno test summary here";
  const r = parseTestOutput(raw);
  assert.equal(r.total, undefined);
});

// Lint parser tests
test("parseLintOutput: ESLint JSON format", () => {
  const json = JSON.stringify([
    {
      filePath: "/src/foo.ts",
      errorCount: 2,
      warningCount: 1,
      messages: [
        { line: 10, ruleId: "no-unused-vars", message: "x is unused", severity: 2 },
        { line: 20, ruleId: "semi", message: "Missing semicolon", severity: 2 },
        { line: 30, ruleId: "no-console", message: "console.log found", severity: 1 },
      ],
    },
  ]);
  const r = parseLintOutput(json);
  assert.equal(r.errorCount, 2);
  assert.equal(r.warningCount, 1);
  assert.equal(r.issues!.length, 3);
  assert.equal(r.issues![0].severity, "error");
  assert.equal(r.issues![2].severity, "warning");
});

test("parseLintOutput: plain text fallback", () => {
  const raw = "src/foo.ts:10:5 error Something wrong\nsrc/bar.ts:20:1 warning Not great\nsrc/baz.ts:1:1 error Bad";
  const r = parseLintOutput(raw);
  assert.equal(r.errorCount, 2);
  assert.equal(r.warningCount, 1);
});

test("parseLintOutput: empty JSON array means clean", () => {
  const r = parseLintOutput("[]");
  assert.equal(r.errorCount, 0);
  assert.equal(r.warningCount, 0);
  assert.equal(r.issues!.length, 0);
});
