import test from "node:test";
import assert from "node:assert/strict";
import { redactSensitiveObject } from "../security/SecretRedaction";

test("redacts sensitive keys recursively", () => {
  const input = {
    Authorization: "Bearer abc",
    nested: {
      apiKey: "xyz",
      safe: "ok"
    },
    headers: {
      "x-token": "t1"
    }
  };
  const out = redactSensitiveObject(input) as any;
  assert.equal(out.Authorization, "<redacted>");
  assert.equal(out.nested.apiKey, "<redacted>");
  assert.equal(out.nested.safe, "ok");
  assert.equal(out.headers["x-token"], "<redacted>");
});

test("redacts typical MCP-style nested tool payload", () => {
  const input = {
    ok: true,
    result: { access_token: "secret-token", body: { apiKey: "k" } }
  };
  const out = redactSensitiveObject(input) as any;
  assert.equal(out.result.access_token, "<redacted>");
  assert.equal(out.result.body.apiKey, "<redacted>");
});
