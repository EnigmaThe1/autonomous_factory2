import test from "node:test";
import assert from "node:assert/strict";
import { canonicalizeStoredRouting, parseRoleMapString, presetRoutingFragment, routingPresetTemplatesForUi } from "../missions/missionRouting";

test("presetRoutingFragment research_heavy sets mixed providers", () => {
  const r = presetRoutingFragment("research_heavy");
  assert.equal(r.providerPerRole?.implementer, "ollama");
  assert.equal(r.providerPerRole?.planner, "openai");
  assert.equal(r.preset, "research_heavy");
});

test("canonicalizeStoredRouting empty input yields default shape", () => {
  assert.deepEqual(canonicalizeStoredRouting(undefined), {
    preset: "default",
    providerPerRole: {},
    modelPerRole: {}
  });
});

test("canonicalizeStoredRouting preserves mission maps", () => {
  const r = canonicalizeStoredRouting({
    preset: "custom",
    providerPerRole: { planner: "gemini" },
    modelPerRole: { planner: "gemini-1.5-flash" }
  });
  assert.equal(r.providerPerRole?.planner, "gemini");
  assert.equal(r.modelPerRole?.planner, "gemini-1.5-flash");
});

test("parseRoleMapString parses comma pairs", () => {
  const m = parseRoleMapString("planner:openai, implementer:ollama");
  assert.equal(m.planner, "openai");
  assert.equal(m.implementer, "ollama");
});

test("routingPresetTemplatesForUi includes all presets", () => {
  const u = routingPresetTemplatesForUi();
  assert.ok(u.research_heavy.providerPerRole.implementer);
  assert.ok(u.default);
  assert.ok(u.custom);
});
