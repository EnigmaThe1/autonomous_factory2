import test from "node:test";
import assert from "node:assert/strict";
import { compactMcpToolDescriptors, extractJsonSchemaPropertyKeys } from "../tools/mcpToolsListCompact";
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

test("compactMcpToolDescriptors: adds inputPropertyNames from schema", () => {
  const out = compactMcpToolDescriptors(sample, 500_000);
  assert.deepEqual(out[0].inputPropertyNames, ["x"]);
  assert.equal(out[1].inputPropertyNames, undefined);
});

test("extractJsonSchemaPropertyKeys: empty without properties", () => {
  assert.equal(extractJsonSchemaPropertyKeys({ type: "object" }), undefined);
  assert.equal(extractJsonSchemaPropertyKeys(null), undefined);
});

test("extractJsonSchemaPropertyKeys: lists keys in order", () => {
  const keys = extractJsonSchemaPropertyKeys({
    properties: { url: {}, depth: {}, foo: {} }
  });
  assert.deepEqual(keys, ["url", "depth", "foo"]);
});

test("compactMcpToolDescriptors: tiny budget drops rows and adds sentinel", () => {
  const out = compactMcpToolDescriptors(sample, 80);
  assert.ok(out.length >= 1);
  const last = out[out.length - 1];
  assert.equal(last.server, "__myAi__");
  assert.equal(last.name, "list_budget");
  assert.match(last.description || "", /omitted/);
});
