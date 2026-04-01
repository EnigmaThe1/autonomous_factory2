import test from "node:test";
import assert from "node:assert/strict";
import { chooseProviderForRole } from "../providers/providerRouting";

test("selects mapped known provider for role", () => {
  const selected = chooseProviderForRole("planner", "planner:openai,implementer:ollama", ["ollama", "openai"], "ollama");
  assert.equal(selected, "openai");
});

test("falls back when mapped provider is unknown", () => {
  const selected = chooseProviderForRole("planner", "planner:unknown", ["ollama", "openai"], "ollama");
  assert.equal(selected, "ollama");
});

test("falls back when role has no mapping", () => {
  const selected = chooseProviderForRole("validator", "planner:openai", ["ollama", "openai"], "ollama");
  assert.equal(selected, "ollama");
});
