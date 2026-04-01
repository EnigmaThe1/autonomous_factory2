import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { runCommand } from "../tools/CommandRunner";

describe("CommandRunner", () => {
  it("captures stdout from a simple echo", async () => {
    const result = await runCommand({ command: 'echo "hello world"' });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /hello world/);
    assert.equal(result.timedOut, false);
    assert.equal(typeof result.durationMs, "number");
  });

  it("captures stderr from a failing command", async () => {
    const result = await runCommand({ command: "ls /nonexistent_path_xyz_123 2>&1 >/dev/null || echo fail_marker >&2" });
    assert.notEqual(result.stderr, "");
  });

  it("returns non-zero exit code on failure", async () => {
    const result = await runCommand({ command: "exit 42" });
    assert.equal(result.exitCode, 42);
  });

  it("times out and kills long-running commands", async () => {
    const result = await runCommand({ command: "sleep 60", timeoutMs: 500 });
    assert.equal(result.timedOut, true);
    assert.ok(result.durationMs < 5000, "should not wait for the full sleep");
  });

  it("respects AbortSignal", async () => {
    const ac = new AbortController();
    const p = runCommand({ command: "sleep 60", signal: ac.signal });
    setTimeout(() => ac.abort(), 200);
    const result = await p;
    assert.ok(result.durationMs < 5000, "should abort promptly");
  });

  it("accepts cwd argument", async () => {
    const result = await runCommand({ command: "pwd", cwd: "/tmp" });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout.trim(), /\/tmp/);
  });

  it("passes stdin to command", async () => {
    const result = await runCommand({ command: "cat", stdin: "from_stdin" });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /from_stdin/);
  });

  it("truncates output exceeding maxBytes limit", async () => {
    const result = await runCommand({
      command: 'python3 -c "print(\'A\' * 20000)"',
      timeoutMs: 5000
    });
    assert.equal(result.exitCode, 0);
    assert.ok(
      result.stdout.includes("...[truncated") || result.stdout.length <= 8192 + 100,
      "output should be truncated or within limits"
    );
  });

  it("handles env variables", async () => {
    const result = await runCommand({
      command: "echo $MY_TEST_VAR",
      env: { MY_TEST_VAR: "test_value_42" }
    });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /test_value_42/);
  });
});
