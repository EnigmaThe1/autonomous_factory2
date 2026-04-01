import { describe, it, before } from "node:test";
import * as assert from "node:assert/strict";
import { runCommand } from "../tools/CommandRunner";

/**
 * Integration tests for git tool functions.
 * Uses runCommand directly with explicit cwd to avoid
 * vscode.workspace.workspaceFolders dependency.
 */
const GIT_CWD = "/srv/autonomous_factory_v2/autonomous_factory";

async function git(args: string): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return runCommand({ command: `git ${args}`, cwd: GIT_CWD, timeoutMs: 10_000 });
}

describe("GitToolProvider (integration)", () => {
  before(async () => {
    const r = await git("rev-parse --is-inside-work-tree");
    assert.equal(r.stdout.trim(), "true", "tests require a git repo at " + GIT_CWD);
  });

  it("git status --porcelain=v2 --branch returns branch info", async () => {
    const r = await git("status --porcelain=v2 --branch");
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes("# branch.head"), "should contain branch header");
  });

  it("git status parses branch name", async () => {
    const r = await git("status --porcelain=v2 --branch");
    const lines = r.stdout.trim().split("\n");
    const branchLine = lines.find((l: string) => l.startsWith("# branch.head "));
    assert.ok(branchLine, "should have a branch.head line");
    const branch = branchLine!.replace("# branch.head ", "");
    assert.ok(branch.length > 0, "branch name should not be empty");
  });

  it("git diff runs without error", async () => {
    const r = await git("diff");
    assert.equal(r.exitCode, 0);
  });

  it("git diff --cached runs without error", async () => {
    const r = await git("diff --cached");
    assert.equal(r.exitCode, 0);
  });

  it("git log --oneline returns commits", async () => {
    const r = await git("log --oneline -5");
    assert.equal(r.exitCode, 0);
    const lines = r.stdout.trim().split("\n").filter(Boolean);
    assert.ok(lines.length > 0, "should have at least 1 commit");
  });

  it("git log clamps count", async () => {
    const count = Math.min(999, 100);
    const r = await git(`log --oneline -${count}`);
    assert.equal(r.exitCode, 0);
  });

  it("git blame on package.json", async () => {
    const r = await git('blame -- "package.json"');
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.length > 0, "should have blame output");
  });

  it("git blame with line range", async () => {
    const r = await git('blame -L 1,5 -- "package.json"');
    assert.equal(r.exitCode, 0);
  });

  it("git blame on nonexistent file fails", async () => {
    const r = await git('blame -- "nonexistent_file_xyz_12345.ts"');
    assert.ok(r.exitCode !== 0, "should fail for nonexistent file");
  });

  it("git show HEAD returns commit info", async () => {
    const r = await git("show --stat HEAD");
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes("commit") || r.stdout.includes("Author") || r.stdout.length > 10);
  });

  it("git show on invalid ref fails", async () => {
    const r = await git("show --stat invalid_ref_xyz_999");
    assert.ok(r.exitCode !== 0, "should fail for invalid ref");
  });

  it("git rev-parse HEAD returns a hash", async () => {
    const r = await git("rev-parse HEAD");
    assert.equal(r.exitCode, 0);
    assert.ok(/^[0-9a-f]{40}$/.test(r.stdout.trim()), "should be a 40-char hex hash");
  });
});
