import test from "node:test";
import assert from "node:assert/strict";
import { classifyMcpConfigJson } from "../tools/mcpConfigJson";

test("classifyMcpConfigJson: ready when servers non-empty", () => {
  assert.equal(classifyMcpConfigJson(JSON.stringify({ servers: [{ name: "a" }] })), "ready");
});

test("classifyMcpConfigJson: no_servers when empty or missing", () => {
  assert.equal(classifyMcpConfigJson(JSON.stringify({ servers: [] })), "no_servers");
  assert.equal(classifyMcpConfigJson(JSON.stringify({})), "no_servers");
});

test("classifyMcpConfigJson: invalid_json on bad input", () => {
  assert.equal(classifyMcpConfigJson("{"), "invalid_json");
});
