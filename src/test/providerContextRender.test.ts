import test from "node:test";
import assert from "node:assert/strict";
import { renderChatContext } from "../providers/providerContextRender";
import type { ChatRequest } from "../types";

function makeReq(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    prompt: "Fix the bug",
    context: {},
    ...overrides
  };
}

test("renderChatContext: minimal request includes only prompt", () => {
  const result = renderChatContext(makeReq());
  assert.equal(result, "User request:\nFix the bug");
});

test("renderChatContext: includes all context fields", () => {
  const result = renderChatContext(makeReq({
    context: {
      workspaceName: "my-project",
      fileName: "src/main.ts",
      selection: "const x = 1;",
      activeFileText: "full file text",
      diagnostics: [
        { severity: "error", line: 5, message: "Type mismatch" },
        { severity: "warning", line: 10, message: "Unused variable" }
      ]
    }
  }));
  assert.ok(result.includes("Workspace: my-project"));
  assert.ok(result.includes("File: src/main.ts"));
  assert.ok(result.includes("Selection:\nconst x = 1;"));
  assert.ok(result.includes("Active file:\nfull file text"));
  assert.ok(result.includes("error@5: Type mismatch"));
  assert.ok(result.includes("warning@10: Unused variable"));
  assert.ok(result.includes("User request:\nFix the bug"));
});

test("renderChatContext: uses default double-newline separator", () => {
  const result = renderChatContext(makeReq({
    context: { workspaceName: "proj", fileName: "a.ts" }
  }));
  assert.ok(result.includes("Workspace: proj\n\nFile: a.ts\n\nUser request:"));
});

test("renderChatContext: respects custom separator", () => {
  const result = renderChatContext(makeReq({
    context: { workspaceName: "proj", fileName: "a.ts" }
  }), "\n");
  assert.ok(result.includes("Workspace: proj\nFile: a.ts\nUser request:"));
  assert.ok(!result.includes("\n\n"));
});

test("renderChatContext: omits empty optional fields", () => {
  const result = renderChatContext(makeReq({
    context: { workspaceName: "proj" }
  }));
  assert.ok(!result.includes("File:"));
  assert.ok(!result.includes("Selection:"));
  assert.ok(!result.includes("Active file:"));
  assert.ok(!result.includes("Diagnostics:"));
});

test("renderChatContext: empty diagnostics array is omitted", () => {
  const result = renderChatContext(makeReq({
    context: { diagnostics: [] }
  }));
  assert.ok(!result.includes("Diagnostics:"));
});
