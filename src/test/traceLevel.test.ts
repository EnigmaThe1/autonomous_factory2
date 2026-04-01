import test from "node:test";
import assert from "node:assert/strict";
import { traceLevelPassesFilter } from "../diagnostics/traceLevel";

test("traceLevelPassesFilter: error-only shows errors", () => {
  assert.equal(traceLevelPassesFilter("error", "error"), true);
  assert.equal(traceLevelPassesFilter("error", "info"), false);
});

test("traceLevelPassesFilter: info shows error and info", () => {
  assert.equal(traceLevelPassesFilter("info", "error"), true);
  assert.equal(traceLevelPassesFilter("info", "info"), true);
  assert.equal(traceLevelPassesFilter("info", "debug"), false);
});

test("traceLevelPassesFilter: trace shows all", () => {
  assert.equal(traceLevelPassesFilter("trace", "trace"), true);
  assert.equal(traceLevelPassesFilter("trace", "debug"), true);
});
