import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

test("ToolRegistry resolves relative file paths from workspace root", () => {
  const p = path.join(__dirname, "..", "..", "src", "tools", "ToolRegistry.ts");
  const src = fs.readFileSync(p, "utf8");
  assert.match(src, /private resolveWorkspacePath\(inputPath: string\): string/);
  assert.match(src, /return root \? path\.join\(root, inputPath\) : path\.resolve\(inputPath\);/);
  assert.match(src, /decide\(\{ action: "write_file", targetPath: resolvedPath \}\)/);
  assert.match(src, /decide\(\{ action: "read_file", targetPath: resolvedPath \}\)/);
});

test("MissionOrchestrator blocks mission on non-approval tool failure", () => {
  const p = path.join(__dirname, "..", "..", "src", "missions", "MissionOrchestrator.ts");
  const src = fs.readFileSync(p, "utf8");
  assert.match(src, /if \(!toolResult\.ok && !toolResult\.requiresApproval\)/);
  assert.match(src, /Mission halted after tool failure/);
  assert.match(src, /Mission paused: tool call failed/);
});
