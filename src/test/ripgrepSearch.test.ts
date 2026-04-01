import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { ripgrepSearch, fileTree } from "../tools/RipgrepSearch";

describe("ripgrepSearch", () => {
  const toolsSrc = "/srv/autonomous_factory_v2/autonomous_factory/src/tools";

  it("finds matches for a known pattern in the workspace", async () => {
    const result = await ripgrepSearch({
      pattern: "class ToolRegistry",
      cwd: toolsSrc,
      maxResults: 10,
    });
    assert.equal(result.ok, true);
    assert.ok(result.matches.length > 0, "should find at least one match");
    assert.equal(typeof result.matches[0].line, "number");
    assert.equal(typeof result.matches[0].col, "number");
  });

  it("returns empty matches for a pattern that does not exist", async () => {
    const result = await ripgrepSearch({
      pattern: "qqqZZZ999NoMatchEver",
      cwd: toolsSrc,
    });
    assert.equal(result.ok, true);
    assert.equal(result.matches.length, 0);
  });

  it("respects glob filtering", async () => {
    const result = await ripgrepSearch({
      pattern: "import",
      cwd: "/srv/autonomous_factory_v2/autonomous_factory/src",
      glob: "*.ts",
      maxResults: 5,
    });
    assert.equal(result.ok, true);
    for (const m of result.matches) {
      assert.ok(m.file.endsWith(".ts"), `expected .ts file, got ${m.file}`);
    }
  });

  it("handles fixed string search", async () => {
    const result = await ripgrepSearch({
      pattern: "BUILTIN_TOOL_NAMES",
      cwd: toolsSrc,
      fixedString: true,
      maxResults: 5,
    });
    assert.equal(result.ok, true);
    assert.ok(result.matches.length > 0);
  });

  it("caps results at maxResults", async () => {
    const result = await ripgrepSearch({
      pattern: "const",
      cwd: "/srv/autonomous_factory_v2/autonomous_factory/src",
      maxResults: 3,
    });
    assert.equal(result.ok, true);
    assert.ok(result.matches.length <= 3);
  });
});

describe("fileTree", () => {
  it("generates a tree of the workspace", async () => {
    const result = await fileTree({
      cwd: "/srv/autonomous_factory_v2/autonomous_factory/src",
      maxDepth: 2,
      maxFiles: 50,
    });
    assert.equal(result.ok, true);
    assert.ok(result.tree.length > 0);
    assert.ok(result.fileCount > 0);
  });

  it("respects maxDepth limit", async () => {
    const shallow = await fileTree({
      cwd: "/srv/autonomous_factory_v2/autonomous_factory",
      maxDepth: 1,
      maxFiles: 100,
    });
    const deep = await fileTree({
      cwd: "/srv/autonomous_factory_v2/autonomous_factory",
      maxDepth: 3,
      maxFiles: 500,
    });
    assert.equal(shallow.ok, true);
    assert.equal(deep.ok, true);
    assert.ok(deep.fileCount >= shallow.fileCount, "deeper tree should have at least as many files");
  });
});
