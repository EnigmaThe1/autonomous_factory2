import test from "node:test";
import assert from "node:assert/strict";
import { buildListToolsHintEntries, BUILTIN_TOOL_HINTS, EXTRA_TOOL_HINTS } from "../tools/listToolsCatalog";
import { BUILTIN_TOOL_NAMES } from "../tools/builtinToolNames";

test("BUILTIN_TOOL_HINTS covers every builtin name", () => {
  for (const name of BUILTIN_TOOL_NAMES) {
    assert.ok(BUILTIN_TOOL_HINTS[name], `missing hint for ${name}`);
  }
});

test("buildListToolsHintEntries: returns all rows when budget is large", () => {
  const { entries, truncated } = buildListToolsHintEntries(100_000);
  assert.equal(truncated, false);
  assert.equal(entries.length, BUILTIN_TOOL_NAMES.length + EXTRA_TOOL_HINTS.length);
  assert.ok(entries.some((e) => e.tool === "readFile"));
  assert.ok(entries.some((e) => e.tool === "git.status"));
  assert.ok(entries.some((e) => e.tool === "db.query"));
});

test("buildListToolsHintEntries: truncates when budget is tiny", () => {
  const { entries, truncated } = buildListToolsHintEntries(120);
  assert.equal(truncated, true);
  assert.ok(entries.length >= 1);
  assert.ok(entries.length < BUILTIN_TOOL_NAMES.length + EXTRA_TOOL_HINTS.length);
});

test("buildListToolsHintEntries: maxChars < 1 yields empty", () => {
  const { entries, truncated } = buildListToolsHintEntries(0);
  assert.equal(entries.length, 0);
  assert.equal(truncated, false);
});
