import test from "node:test";
import assert from "node:assert/strict";
import { geminiCatalogIdsFromListModels } from "../providers/geminiModelCatalogParse";

test("geminiCatalogIdsFromListModels: prefers baseModelId and skips non-generateContent when methods set", () => {
  const ids = geminiCatalogIdsFromListModels([
    {
      name: "models/gemini-2.5-flash-preview-05-20",
      baseModelId: "gemini-2.5-flash-preview-05-20",
      supportedGenerationMethods: ["generateContent"]
    },
    {
      name: "models/text-embedding-004",
      baseModelId: "text-embedding-004",
      supportedGenerationMethods: ["embedContent"]
    },
    { name: "models/gemini-1.5-flash-001", baseModelId: "gemini-1.5-flash", supportedGenerationMethods: ["generateContent"] }
  ]);
  assert.ok(ids.includes("gemini-2.5-flash-preview-05-20"));
  assert.ok(ids.includes("gemini-1.5-flash"));
  assert.ok(!ids.includes("text-embedding-004"));
});

test("geminiCatalogIdsFromListModels: dedupes versioned entries via shared baseModelId", () => {
  const ids = geminiCatalogIdsFromListModels([
    { name: "models/gemini-1.5-flash-002", baseModelId: "gemini-1.5-flash", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-1.5-flash-001", baseModelId: "gemini-1.5-flash", supportedGenerationMethods: ["generateContent"] }
  ]);
  assert.deepEqual(ids, ["gemini-1.5-flash"]);
});

test("geminiCatalogIdsFromListModels: when only non-chat methods declared, uses name heuristics", () => {
  const ids = geminiCatalogIdsFromListModels([
    { name: "models/text-embedding-004", baseModelId: "text-embedding-004", supportedGenerationMethods: ["embedContent"] },
    { name: "models/gemini-2.0-flash-exp", supportedGenerationMethods: ["embedContent"] }
  ]);
  assert.ok(ids.some((id) => id.includes("gemini-2.0-flash")));
});
