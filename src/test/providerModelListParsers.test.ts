import test from "node:test";
import assert from "node:assert/strict";
import { parseOpenAiStyleModelsList } from "../providers/providerModelListParsers";

test("parseOpenAiStyleModelsList extracts ids", () => {
  const ids = parseOpenAiStyleModelsList({
    data: [{ id: "gpt-4o" }, { id: "" }, { id: "gpt-4.1-mini" }]
  });
  assert.deepEqual(ids, ["gpt-4o", "gpt-4.1-mini"]);
});
