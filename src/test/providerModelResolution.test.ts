import test from "node:test";
import assert from "node:assert/strict";
import { resolveModelForProvider, modelsConfigKeyForProvider } from "../providers/providerModelResolution";

test("modelsConfigKeyForProvider maps openai-compat to openaiCompat", () => {
  assert.equal(modelsConfigKeyForProvider("openai-compat"), "myAi.models.openaiCompat");
});

test("resolveModelForProvider prefers explicit model", () => {
  const m = resolveModelForProvider("openai", "gpt-4o", () => undefined);
  assert.equal(m, "gpt-4o");
});

test("resolveModelForProvider uses per-provider setting when present", () => {
  const get = (k: string) => (k === "myAi.models.openai" ? "gpt-4.1" : undefined);
  const m = resolveModelForProvider("openai", undefined, get);
  assert.equal(m, "gpt-4.1");
});

test("resolveModelForProvider uses built-in fallback for OpenAI when no per-provider setting", () => {
  const get = () => undefined;
  const m = resolveModelForProvider("openai", undefined, get);
  assert.equal(m, "gpt-4.1-mini");
});

test("resolveModelForProvider does not use llama as OpenAI default when global default is llama", () => {
  const get = (k: string, d?: unknown) => (k === "myAi.defaultModel" ? "llama3.1" : d);
  const m = resolveModelForProvider("openai", undefined, (key, def) => get(key, def));
  assert.equal(m, "gpt-4.1-mini");
});

test("resolveModelForProvider uses legacy global only as last resort for unknown provider ids", () => {
  const get = (k: string) => (k === "myAi.defaultModel" ? "legacy-model" : undefined);
  const m = resolveModelForProvider("custom-unknown", undefined, get);
  assert.equal(m, "legacy-model");
});
