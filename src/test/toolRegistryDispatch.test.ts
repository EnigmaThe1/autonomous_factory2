import test from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_TOOL_NAMES } from "../tools/ToolRegistry";

test("BUILTIN_TOOL_NAMES is a frozen tuple of known tools", () => {
  assert.ok(Array.isArray(BUILTIN_TOOL_NAMES));
  assert.ok(BUILTIN_TOOL_NAMES.length >= 8, "Expected at least 8 builtin tools");
  for (const name of BUILTIN_TOOL_NAMES) {
    assert.equal(typeof name, "string");
    assert.ok(name.length > 0);
  }
});

test("BUILTIN_TOOL_NAMES contains core tool set", () => {
  const required = ["readFile", "writeFile", "applyPatch", "searchFiles", "listFiles", "getDiagnostics", "runTerminal", "listTools", "listMcpTools"];
  for (const tool of required) {
    assert.ok(
      (BUILTIN_TOOL_NAMES as readonly string[]).includes(tool),
      `Missing expected builtin tool: ${tool}`
    );
  }
});

test("BUILTIN_TOOL_NAMES has no duplicates", () => {
  const unique = new Set(BUILTIN_TOOL_NAMES);
  assert.equal(unique.size, BUILTIN_TOOL_NAMES.length, "BUILTIN_TOOL_NAMES contains duplicates");
});
