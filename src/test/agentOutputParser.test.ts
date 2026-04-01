import test from "node:test";
import assert from "node:assert/strict";
import { parseAgentOutput } from "../agents/agentOutputParser";

test("parseAgentOutput: empty text returns defaults", () => {
  const result = parseAgentOutput("");
  assert.deepEqual(result.toolCalls, []);
  assert.deepEqual(result.workItems, []);
  assert.deepEqual(result.memoryItems, []);
  assert.equal(result.blocked, false);
  assert.equal(result.complete, false);
});

test("parseAgentOutput: extracts TOOL lines as JSON", () => {
  const text = 'Some text\nTOOL:{"tool":"readFile","args":{"path":"foo.ts"}}\nMore text';
  const result = parseAgentOutput(text);
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].tool, "readFile");
  assert.equal(result.toolCalls[0].args.path, "foo.ts");
});

test("parseAgentOutput: skips malformed TOOL JSON gracefully", () => {
  const text = "TOOL:not valid json\nTOOL:{\"tool\":\"listFiles\",\"args\":{}}";
  const result = parseAgentOutput(text);
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].tool, "listFiles");
});

test("parseAgentOutput: extracts WORK lines", () => {
  const text = "WORK:IMPLEMENTER:Build feature - write the code for X\nWORK:REVIEWER:Review code - check quality";
  const result = parseAgentOutput(text);
  assert.equal(result.workItems.length, 2);
  assert.equal(result.workItems[0].title, "Build feature");
  assert.equal(result.workItems[0].prompt, "write the code for X");
  assert.equal(result.workItems[0].status, "todo");
  assert.equal(result.workItems[1].title, "Review code");
  assert.equal(result.workItems[1].prompt, "check quality");
});

test("parseAgentOutput: detects BLOCKER", () => {
  const text = "There is a problem.\nBLOCKER: missing dependency";
  const result = parseAgentOutput(text);
  assert.equal(result.blocked, true);
  assert.equal(result.complete, false);
});

test("parseAgentOutput: detects COMPLETE", () => {
  const text = "All done.\nCOMPLETE: task finished";
  const result = parseAgentOutput(text);
  assert.equal(result.complete, true);
  assert.equal(result.blocked, false);
});

test("parseAgentOutput: extracts MEMORY lines", () => {
  const text = "MEMORY:insight:arch,design - The system uses event sourcing";
  const result = parseAgentOutput(text);
  assert.equal(result.memoryItems.length, 1);
  assert.equal(result.memoryItems[0].kind, "insight");
  assert.deepEqual(result.memoryItems[0].tags, ["arch", "design"]);
  assert.equal(result.memoryItems[0].text, "The system uses event sourcing");
});

test("parseAgentOutput: handles mixed output", () => {
  const text = [
    "Analyzing code...",
    'TOOL:{"tool":"readFile","args":{"path":"src/main.ts"}}',
    "MEMORY:finding:perf - slow query in main loop",
    "WORK:IMPLEMENTER:Optimize query - rewrite the SQL join",
    "COMPLETE: analysis done"
  ].join("\n");
  const result = parseAgentOutput(text);
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.memoryItems.length, 1);
  assert.equal(result.workItems.length, 1);
  assert.equal(result.complete, true);
});

test("parseAgentOutput: BLOCKER + COMPLETE both set", () => {
  const text = "BLOCKER: issue found\nCOMPLETE: done";
  const result = parseAgentOutput(text);
  assert.equal(result.blocked, true);
  assert.equal(result.complete, true);
});
