import test from "node:test";
import assert from "node:assert/strict";
import {
  anthropicMessagesFromChatRequest,
  normalizeAnthropicMessages,
  parseAnthropicErrorBody
} from "../providers/anthropicMessages";
import type { ChatRequest } from "../types";

function baseReq(prompt: string): ChatRequest {
  return {
    prompt,
    context: { workspaceName: "ws" },
    system: "sys"
  };
}

test("normalizeAnthropicMessages: single user turn unchanged", () => {
  const out = normalizeAnthropicMessages([{ role: "user", content: "hello" }]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.role, "user");
  assert.equal(out[0]!.content, "hello");
});

test("normalizeAnthropicMessages: leading assistant becomes user-wrapped", () => {
  const out = normalizeAnthropicMessages([
    { role: "assistant", content: "prior" },
    { role: "user", content: "next" }
  ]);
  assert.equal(out[0]!.role, "user");
  assert.match(out[0]!.content, /Prior assistant output/);
  assert.match(out[0]!.content, /prior/);
  assert.match(out[0]!.content, /next/);
  assert.equal(out.length, 1);
});

test("normalizeAnthropicMessages: merges consecutive users", () => {
  const out = normalizeAnthropicMessages([
    { role: "user", content: "a" },
    { role: "user", content: "b" },
    { role: "assistant", content: "c" }
  ]);
  assert.equal(out[0]!.role, "user");
  assert.match(out[0]!.content, /a/);
  assert.match(out[0]!.content, /b/);
  assert.equal(out[1]!.role, "assistant");
  assert.equal(out[1]!.content, "c");
});

test("normalizeAnthropicMessages: drops empty turns", () => {
  const out = normalizeAnthropicMessages([
    { role: "user", content: "   " },
    { role: "user", content: "ok" }
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.content, "ok");
});

test("parseAnthropicErrorBody: extracts error.message", () => {
  const d = parseAnthropicErrorBody(JSON.stringify({ error: { type: "invalid_request_error", message: "bad model" } }));
  assert.equal(d, "bad model");
});

test("anthropicMessagesFromChatRequest: history then prompt ends with user context", () => {
  const req = baseReq("do thing");
  req.history = [
    { role: "assistant", content: "hi" },
    { role: "user", content: "go on" }
  ];
  const out = anthropicMessagesFromChatRequest(req);
  assert.equal(out[0]!.role, "user");
  assert.match(out[out.length - 1]!.content, /User request:\s*do thing/);
  assert.match(out[out.length - 1]!.content, /Workspace: ws/);
});
