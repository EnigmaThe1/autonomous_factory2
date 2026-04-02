import test from "node:test";
import assert from "node:assert/strict";
import { compactMcpToolDescriptors } from "../tools/mcpToolsListCompact";
import type { McpToolDescriptor } from "../types";

const sample: McpToolDescriptor[] = [
  { server: "a", name: "t1", description: "one", sessionState: "ready", inputSchema: { type: "object", properties: { x: {} } } },
  { server: "b", name: "t2", description: "two", sessionState: "ready" }
];

test("compactMcpToolDescriptors: maxChars 0 passes through including inputSchema", () => {
  const out = compactMcpToolDescriptors(sample, 0);
  assert.equal(out.length, 2);
  assert.ok(out[0].inputSchema);
  assert.equal(out[0].server, "a");
});

test("compactMcpToolDescriptors: maxChars > 0 strips inputSchema", () => {
  const out = compactMcpToolDescriptors(sample, 500_000);
  assert.equal(out.length, 2);
  assert.equal(out[0].inputSchema, undefined);
  assert.equal(out[0].description, "one");
});

test("compactMcpToolDescriptors: tiny budget drops rows and adds sentinel", () => {
  const out = compactMcpToolDescriptors(sample, 80);
  assert.ok(out.length >= 1);
  const last = out[out.length - 1];
  assert.equal(last.server, "__myAi__");
  assert.equal(last.name, "list_budget");
  assert.match(last.description || "", /omitted/);
});
