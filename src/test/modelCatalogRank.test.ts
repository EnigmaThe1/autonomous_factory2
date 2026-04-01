import test from "node:test";
import assert from "node:assert/strict";
import { MODEL_CATALOG_SHORTLIST_MAX, rankFullAndShortlist } from "../providers/modelCatalogRank";

test("rankFullAndShortlist: OpenAI uses created timestamps when provided", () => {
  const ids = ["gpt-4o-mini", "gpt-4", "gpt-5-preview"];
  const createdById: Record<string, number> = {
    "gpt-4": 1_600_000_000,
    "gpt-4o-mini": 1_700_000_000,
    "gpt-5-preview": 1_720_000_000
  };
  const { modelsAll, displayShortlist } = rankFullAndShortlist("openai", ids, { createdById });
  assert.equal(modelsAll[0], "gpt-5-preview");
  assert.ok(displayShortlist.length <= MODEL_CATALOG_SHORTLIST_MAX);
  assert.deepEqual(displayShortlist, modelsAll.slice(0, MODEL_CATALOG_SHORTLIST_MAX));
});

test("rankFullAndShortlist: OpenAI GPT-5 ranks above GPT-4-turbo even with older created timestamp", () => {
  const ids = ["gpt-4-turbo-2024-04-09", "gpt-5-mini"];
  const createdById: Record<string, number> = {
    "gpt-4-turbo-2024-04-09": 2_000_000_000,
    "gpt-5-mini": 1_650_000_000
  };
  const { modelsAll } = rankFullAndShortlist("openai", ids, { createdById });
  assert.equal(modelsAll[0], "gpt-5-mini");
});

test("rankFullAndShortlist: OpenAI same-tier ties break on created (newer first)", () => {
  const ids = ["gpt-5-a", "gpt-5-b"];
  const createdById: Record<string, number> = {
    "gpt-5-a": 1_700_000_000,
    "gpt-5-b": 1_800_000_000
  };
  const { modelsAll } = rankFullAndShortlist("openai", ids, { createdById });
  assert.equal(modelsAll[0], "gpt-5-b");
});

test("rankFullAndShortlist: apiListOrder breaks ties when scores match", () => {
  const ids = ["m-a", "m-b", "m-c"];
  const apiListOrder = ["m-c", "m-a", "m-b"];
  const { modelsAll } = rankFullAndShortlist("vscode-lm", ids, { apiListOrder });
  assert.equal(modelsAll[0], "m-c");
});

test("rankFullAndShortlist: Gemini major version ordering", () => {
  const ids = ["gemini-1.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"];
  const { modelsAll } = rankFullAndShortlist("gemini", ids, {});
  assert.equal(modelsAll[0], "gemini-2.5-pro");
});

test("rankFullAndShortlist: Gemini 3.1 > 3.0 > 2.5 > 2.0 > 1.5; legacy *-latest below versioned", () => {
  const ids = [
    "gemini-pro-latest",
    "gemini-flash-latest",
    "gemini-1.5-flash",
    "gemini-2.0-flash",
    "gemini-2.5-pro",
    "gemini-3.0-flash",
    "gemini-3.1-flash"
  ];
  const { modelsAll } = rankFullAndShortlist("gemini", ids, {});
  assert.deepEqual(modelsAll.slice(0, 5), [
    "gemini-3.1-flash",
    "gemini-3.0-flash",
    "gemini-2.5-pro",
    "gemini-2.0-flash",
    "gemini-1.5-flash"
  ]);
  assert.ok(modelsAll.indexOf("gemini-pro-latest") > modelsAll.indexOf("gemini-1.5-flash"));
  assert.ok(modelsAll.indexOf("gemini-flash-latest") > modelsAll.indexOf("gemini-1.5-flash"));
});

test("rankFullAndShortlist: Gemini 3.x without minor ranks above 2.5 (tie-break lexical)", () => {
  const ids = ["gemini-2.5-flash", "gemini-3-pro", "gemini-3-flash"];
  const { modelsAll } = rankFullAndShortlist("gemini", ids, {});
  assert.equal(modelsAll[2], "gemini-2.5-flash");
  assert.ok(modelsAll.slice(0, 2).every((id) => /^gemini-3-/.test(id)));
});

test("rankFullAndShortlist: Ollama demotes embedding-ish names and boosts chat families", () => {
  const ids = ["nomic-embed-text", "llama3.2:latest", "mxbai-embed-large"];
  const { modelsAll } = rankFullAndShortlist("ollama", ids, {});
  assert.equal(modelsAll[0], "llama3.2:latest");
});
