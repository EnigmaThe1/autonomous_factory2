import test from "node:test";
import assert from "node:assert/strict";
import {
  explainHttpStatusForProviders,
  formatConnectionTestHttpMessage,
  formatModelListHttpHint,
  formatProviderHttpError
} from "../providers/providerHttpErrors";

test("explainHttpStatusForProviders: 429 mentions rate limit and Resume", () => {
  const h = explainHttpStatusForProviders(429);
  assert.match(h, /rate limit|quota/i);
  assert.match(h, /Resume/i);
});

test("explainHttpStatusForProviders: 401 is about credentials", () => {
  assert.match(explainHttpStatusForProviders(401), /Unauthorized|credentials/i);
});

test("formatProviderHttpError: includes status and explanation", () => {
  const m = formatProviderHttpError({
    providerLabel: "Anthropic",
    operation: "Chat stream",
    status: 503,
    endpoint: "https://api.anthropic.com/v1"
  });
  assert.match(m, /Anthropic/);
  assert.match(m, /503/);
  assert.match(m, /unavailable|maintenance|retry/i);
});

test("formatProviderHttpError: optional providerDetail from API body", () => {
  const m = formatProviderHttpError({
    providerLabel: "Anthropic",
    operation: "Chat stream",
    status: 400,
    endpoint: "https://api.anthropic.com/v1",
    providerDetail: "model: claude-foo not found"
  });
  assert.match(m, /API: model: claude-foo not found/);
  assert.match(m, /400/);
});

test("formatModelListHttpHint: suitable for picker fallback strings", () => {
  const m = formatModelListHttpHint("Gemini", 403, "https://example/v1beta/models");
  assert.match(m, /403/);
  assert.match(m, /Forbidden|access/i);
});

test("formatConnectionTestHttpMessage: providers tab mentioned for 401", () => {
  const m = formatConnectionTestHttpMessage("OpenAI", 401, "https://api.openai.com/v1/models");
  assert.match(m, /401/);
  assert.match(m, /Providers/i);
});
