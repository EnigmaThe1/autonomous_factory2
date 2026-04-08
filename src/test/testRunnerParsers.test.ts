import test from "node:test";
import assert from "node:assert/strict";
import { parseTestOutput, parseLintOutput, lintResultOk } from "../tools/TestRunner";

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
  assert.equal(r.source, "eslint-json");
});

test("parseLintOutput: plain text fallback", () => {
  const raw = "src/foo.ts:10:5 error Something wrong\nsrc/bar.ts:20:1 warning Not great\nsrc/baz.ts:1:1 error Bad";
  const r = parseLintOutput(raw);
  assert.equal(r.errorCount, 2);
  assert.equal(r.warningCount, 1);
  assert.equal(r.source, "heuristic");
});

test("parseLintOutput: empty JSON array means clean", () => {
  const r = parseLintOutput("[]");
  assert.equal(r.errorCount, 0);
  assert.equal(r.warningCount, 0);
  assert.equal(r.issues!.length, 0);
  assert.equal(r.source, "eslint-json");
});

test("lintResultOk: exit 1 with ESLint JSON zero issues treated as pass", () => {
  const parsed = parseLintOutput("[]");
  assert.equal(lintResultOk(1, parsed), true);
  assert.equal(lintResultOk(0, parsed), true);
});

test("lintResultOk: exit 1 with ESLint JSON errors still fails", () => {
  const parsed = parseLintOutput(
    JSON.stringify([{ filePath: "/a.ts", errorCount: 1, warningCount: 0, messages: [] }])
  );
  assert.equal(lintResultOk(1, parsed), false);
});

test("lintResultOk: exit 1 with warnings still fails", () => {
  const parsed = parseLintOutput(
    JSON.stringify([{ filePath: "/a.ts", errorCount: 0, warningCount: 1, messages: [] }])
  );
  assert.equal(lintResultOk(1, parsed), false);
});

test("lintResultOk: heuristic parse does not ignore non-zero exit", () => {
  const parsed = parseLintOutput("some text without json");
  assert.equal(parsed.source, "heuristic");
  assert.equal(lintResultOk(1, parsed), false);
  assert.equal(lintResultOk(0, parsed), true);
});
