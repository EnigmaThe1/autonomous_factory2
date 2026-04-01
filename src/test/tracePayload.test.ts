import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWebviewTracePayload } from "../diagnostics/tracePayload";

test("normalizeWebviewTracePayload rejects non-objects", () => {
  const r = normalizeWebviewTracePayload(null, "sess-1");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "payload_not_object");
});

test("normalizeWebviewTracePayload rejects missing event", () => {
  const r = normalizeWebviewTracePayload({ level: "info" }, "sess-1");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "missing_event");
});

test("normalizeWebviewTracePayload accepts minimal payload", () => {
  const r = normalizeWebviewTracePayload({ event: "ui_boot_ready", category: "ui", level: "info" }, "sess-1");
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.record.event, "ui_boot_ready");
    assert.equal(r.record.side, "webview");
    assert.equal(r.record.sessionId, "sess-1");
    assert.equal(r.record.level, "info");
  }
});

test("normalizeWebviewTracePayload keeps client sessionId when provided", () => {
  const r = normalizeWebviewTracePayload({ event: "x", sessionId: "client-sid" }, "fallback");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.record.sessionId, "client-sid");
});

test("normalizeWebviewTracePayload rejects non-object data", () => {
  const r = normalizeWebviewTracePayload({ event: "x", data: [1, 2] }, "s");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "invalid_data");
});
