import test from "node:test";
import assert from "node:assert/strict";
import { buildBrowserCaptureCommand, escapeForPosixSingleQuotes } from "../tools/BrowserCapture";

test("escapeForPosixSingleQuotes wraps and escapes quotes", () => {
  assert.equal(escapeForPosixSingleQuotes("hello"), "'hello'");
  assert.equal(escapeForPosixSingleQuotes("a'b"), "'a'\"'\"'b'");
});

test("buildBrowserCaptureCommand: substitutes url and outPath", () => {
  const r = buildBrowserCaptureCommand("npx playwright screenshot {url} {outPath}", "https://ex.com/", "/tmp/out.png");
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.match(r.command, /npx playwright screenshot/);
    assert.match(r.command, /https:\/\/ex\.com\//);
    assert.match(r.command, /\/tmp\/out\.png/);
  }
});

test("buildBrowserCaptureCommand: rejects missing placeholders", () => {
  assert.equal(buildBrowserCaptureCommand("echo hi", "https://x", "/o").ok, false);
  assert.equal(buildBrowserCaptureCommand("x {url}", "https://x", "/o").ok, false);
});
