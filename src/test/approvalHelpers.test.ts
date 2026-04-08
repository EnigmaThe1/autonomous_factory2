import test from "node:test";
import assert from "node:assert/strict";
import { pendingApprovalToolResult } from "../tools/approvalHelpers";

test("pendingApprovalToolResult: stable shape", () => {
  const r = pendingApprovalToolResult({
    kind: "terminal",
    summary: "Need OK",
    title: "Run thing",
    details: "echo hi"
  });
  assert.equal(r.ok, false);
  assert.equal(r.summary, "Need OK");
  assert.ok(r.requiresApproval);
  const ra = r.requiresApproval!;
  assert.equal(ra.kind, "terminal");
  assert.equal(ra.title, "Run thing");
  assert.equal(ra.details, "echo hi");
});

test("pendingApprovalToolResult: trims details when detailsMaxChars set", () => {
  const long = "a".repeat(100);
  const r = pendingApprovalToolResult({
    kind: "external_tool",
    summary: "s",
    title: "t",
    details: long,
    detailsMaxChars: 20
  });
  assert.ok(r.requiresApproval);
  const ra = r.requiresApproval!;
  assert.ok(ra.details.length < long.length);
  assert.ok(ra.details.includes("...[truncated"));
});

test("pendingApprovalToolResult: leaves details untouched when detailsMaxChars omitted", () => {
  const long = "b".repeat(5000);
  const r = pendingApprovalToolResult({
    kind: "terminal",
    summary: "s",
    title: "t",
    details: long
  });
  assert.equal(r.requiresApproval!.details, long);
});
