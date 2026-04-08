import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalizeStoredRouting,
  parseRoleMapString,
  presetRoutingFragment,
  resolveProviderIdForWorkItem,
  routingPresetTemplatesForUi
} from "../missions/missionRouting";
import type { Mission, WorkItem } from "../types";

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

test("resolveProviderIdForWorkItem: work item override wins", () => {
  const mission = {
    activeProviderId: "openai",
    routing: { preset: "custom" as const, providerPerRole: { implementer: "ollama" }, modelPerRole: {} }
  } as Mission;
  const item = {
    id: "i",
    title: "t",
    role: "implementer" as const,
    status: "todo" as const,
    prompt: "p",
    providerId: "anthropic"
  } as WorkItem;
  assert.equal(resolveProviderIdForWorkItem(mission, item), "anthropic");
});

test("resolveProviderIdForWorkItem: routing per role then activeProviderId", () => {
  const mission = {
    activeProviderId: "gemini",
    routing: {
      preset: "custom" as const,
      providerPerRole: { planner: "openai", implementer: "ollama" },
      modelPerRole: {}
    }
  } as Mission;
  const impl = { id: "i", title: "t", role: "implementer" as const, status: "todo" as const, prompt: "p" } as WorkItem;
  assert.equal(resolveProviderIdForWorkItem(mission, impl), "ollama");
  assert.equal(resolveProviderIdForWorkItem(mission, undefined), "gemini");
});
