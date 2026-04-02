import test from "node:test";
import assert from "node:assert/strict";
import { toExternalAdapterPublicSummaries } from "../tools/externalAdapterListSanitize";

test("toExternalAdapterPublicSummaries strips url and headers", () => {
  const out = toExternalAdapterPublicSummaries([
    {
      name: "hook",
      type: "http",
      url: "https://secret.example/webhook",
      method: "POST",
      description: "My hook",
      mutating: true,
      headers: { Authorization: "Bearer x" }
    }
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "hook");
  assert.equal(out[0].description, "My hook");
  assert.equal((out[0] as { url?: string }).url, undefined);
  assert.equal((out[0] as { headers?: unknown }).headers, undefined);
});
