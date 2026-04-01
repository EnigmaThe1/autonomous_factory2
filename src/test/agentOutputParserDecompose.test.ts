import test from "node:test";
import assert from "node:assert/strict";
import { parseAgentOutput } from "../agents/agentOutputParser";

test("DECOMPOSE: parses single sub-item", () => {
  const text = "DECOMPOSE:IMPLEMENTER:Setup DB schema - Create tables for users and roles";
  const result = parseAgentOutput(text);
  assert.equal(result.decompositions.length, 1);
  assert.equal(result.decompositions[0].role, "implementer");
  assert.equal(result.decompositions[0].title, "Setup DB schema");
  assert.equal(result.decompositions[0].prompt, "Create tables for users and roles");
  assert.equal(result.decompositions[0].dependsOn, undefined);
});

test("DECOMPOSE: parses with dependencies", () => {
  const text = "DECOMPOSE:REVIEWER:Review API layer - Check endpoint contracts [depends:setup-db,create-api]";
  const result = parseAgentOutput(text);
  assert.equal(result.decompositions.length, 1);
  assert.equal(result.decompositions[0].role, "reviewer");
  assert.equal(result.decompositions[0].title, "Review API layer");
  assert.deepEqual(result.decompositions[0].dependsOn, ["setup-db", "create-api"]);
});

test("DECOMPOSE: parses multiple sub-items", () => {
  const text = [
    "Planning the refactor:",
    "DECOMPOSE:PLANNER:Phase 1 DB - Plan database migration",
    "DECOMPOSE:IMPLEMENTER:Phase 2 API - Build REST endpoints [depends:Phase 1 DB]",
    "DECOMPOSE:VALIDATOR:Phase 3 Tests - Run integration tests [depends:Phase 2 API]",
  ].join("\n");
  const result = parseAgentOutput(text);
  assert.equal(result.decompositions.length, 3);
  assert.equal(result.decompositions[0].role, "planner");
  assert.equal(result.decompositions[1].role, "implementer");
  assert.equal(result.decompositions[2].role, "validator");
  assert.deepEqual(result.decompositions[2].dependsOn, ["Phase 2 API"]);
});

test("DECOMPOSE: coexists with WORK and TOOL lines", () => {
  const text = [
    'TOOL:{"tool":"readFile","args":{"path":"schema.sql"}}',
    "WORK:IMPLEMENTER:Quick fix - patch the typo",
    "DECOMPOSE:IMPLEMENTER:Refactor module - Split into smaller files",
    "MEMORY:insight:arch - Module is too large",
    "COMPLETE: plan ready",
  ].join("\n");
  const result = parseAgentOutput(text);
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.workItems.length, 1);
  assert.equal(result.decompositions.length, 1);
  assert.equal(result.memoryItems.length, 1);
  assert.equal(result.complete, true);
});

test("DECOMPOSE: case-insensitive role", () => {
  const text = "DECOMPOSE:planner:Plan step - outline the approach";
  const result = parseAgentOutput(text);
  assert.equal(result.decompositions.length, 1);
  assert.equal(result.decompositions[0].role, "planner");
});

test("DECOMPOSE: ignores malformed lines", () => {
  const text = [
    "DECOMPOSE:not a valid format",
    "DECOMPOSE:IMPLEMENTER:No prompt here",
    "DECOMPOSE:IMPLEMENTER:Valid title - valid prompt",
  ].join("\n");
  const result = parseAgentOutput(text);
  assert.equal(result.decompositions.length, 1);
  assert.equal(result.decompositions[0].title, "Valid title");
});

test("DECOMPOSE: single dependency", () => {
  const text = "DECOMPOSE:IMPLEMENTER:Step B - do step B [depends:StepA]";
  const result = parseAgentOutput(text);
  assert.deepEqual(result.decompositions[0].dependsOn, ["StepA"]);
});

test("DECOMPOSE: trims whitespace from deps", () => {
  const text = "DECOMPOSE:IMPLEMENTER:Step C - do step C [depends: X , Y , Z ]";
  const result = parseAgentOutput(text);
  assert.deepEqual(result.decompositions[0].dependsOn, ["X", "Y", "Z"]);
});
