import test from "node:test";
import assert from "node:assert/strict";
import { uid } from "../util";
import { awaitMissionRunLoopIdle, createOrchestrator, roleScript } from "./missionOrchestratorTestHarness";
import * as vscode from "vscode";
import { ToolRegistry } from "../tools/ToolRegistry";
import { ExternalToolAdapterRegistry } from "../tools/ExternalToolAdapterRegistry";
import { McpRegistry } from "../tools/McpRegistry";
import { MissionStore } from "../missions/MissionStore";
import { DiskMissionPersistence } from "../storage/DiskMissionPersistence";
import { WorkspacePaths } from "../storage/WorkspacePaths";
import { SecretStore } from "../storage/SecretStore";
import type { ToolCall } from "../types";
import { memento, type VscodeTestApi } from "./missionOrchestratorTestHarness";

test("Research evidence: webSearch produces a finding memory with freshness tag", async () => {
  const agent = roleScript({
    researcher: [
      {
        summary: "Research.",
        toolCalls: [{ tool: "webSearch", args: { query: "TypeScript satisfies type predicate" } }]
      }
    ]
  });
  const { orchestrator, store } = await createOrchestrator(agent, async (_missionId, call) => {
    if (call.tool !== "webSearch") return { ok: true, summary: "noop" };
    return {
      ok: true,
      summary: "Found results.",
      data: { query: String(call.args?.query || ""), provider: "duckduckgo_instant", excerpt: "Example excerpt.", attribution: "https://example.com" }
    };
  });
  const m = await store.create("Research", "p", "ollama", undefined, {
    minCompletedWorkItems: 1,
    requireReviewerBeforeComplete: false,
    requireValidatorBeforeComplete: false,
    requireImplementerBeforeComplete: false,
    requireValidationEvidence: false,
    closureRequired: true,
    autoContinue: true,
    maxAutoRounds: 6,
    stallReplanThreshold: 2,
    policyPreset: "light"
  });
  await store.enqueue(m.id, [{ id: uid("work"), title: "Research", role: "researcher", status: "todo", prompt: "Research." }]);
  await orchestrator.runMission(m.id);
  await awaitMissionRunLoopIdle(orchestrator, m.id);
  const fin = store.get(m.id)!;
  const evidence = fin.memory.filter((x) => x.kind === "finding" && (x.tags || []).includes("research_evidence"));
  assert.ok(evidence.length >= 1);
  assert.ok((evidence[0].tags || []).some((t) => t.startsWith("freshness:")));
});

test("Research evidence: fetchWebPage produces a finding memory with URL included", async () => {
  const agent = roleScript({
    researcher: [
      {
        summary: "Fetch.",
        toolCalls: [{ tool: "fetchWebPage", args: { url: "https://example.com/docs" } }]
      }
    ]
  });
  const { orchestrator, store } = await createOrchestrator(agent, async (_missionId, call) => {
    if (call.tool !== "fetchWebPage") return { ok: true, summary: "noop" };
    return {
      ok: true,
      summary: "Fetched.",
      data: { url: String(call.args?.url || ""), status: 200, contentType: "text/html", body: "hello world" }
    };
  });
  const m = await store.create("Fetch", "p", "ollama", undefined, {
    minCompletedWorkItems: 1,
    requireReviewerBeforeComplete: false,
    requireValidatorBeforeComplete: false,
    requireImplementerBeforeComplete: false,
    requireValidationEvidence: false,
    closureRequired: true,
    autoContinue: true,
    maxAutoRounds: 6,
    stallReplanThreshold: 2,
    policyPreset: "light"
  });
  await store.enqueue(m.id, [{ id: uid("work"), title: "Fetch", role: "researcher", status: "todo", prompt: "Fetch." }]);
  await orchestrator.runMission(m.id);
  await awaitMissionRunLoopIdle(orchestrator, m.id);
  const fin = store.get(m.id)!;
  const evidence = fin.memory.find((x) => x.kind === "finding" && (x.tags || []).includes("research_evidence"));
  assert.ok(evidence?.text.includes("https://example.com/docs"));
});

test("Web research budget: requires approval after max calls exceeded", async () => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.webResearch.enabled", true);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.webResearch.maxCallsPerMission", 1);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.tools.requireApprovalForHttp", false);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.tools.restrictToWorkspace", false);

  const globalState = memento();
  const workspaceState = memento();
  const disk = new DiskMissionPersistence(new WorkspacePaths());
  const store = new MissionStore(globalState, workspaceState, disk);
  const secretStore = new SecretStore({} as unknown as vscode.SecretStorage);
  const paths = new WorkspacePaths();
  const registry = new ToolRegistry(
    {} as vscode.ExtensionContext,
    store,
    disk,
    new ExternalToolAdapterRegistry(paths),
    new McpRegistry(paths, disk),
    secretStore
  );

  const mission = await store.create("Budget", "p", "ollama");
  await store.enqueue(mission.id, [{ id: "res0", title: "Research", role: "researcher", status: "todo", prompt: "x" }]);
  await store.updateRuntime(mission.id, { webResearchCalls: 1 });

  const call: ToolCall = { tool: "webSearch", args: { query: "q1", __workItemId: "res0" } };
  const res = await registry.execute(mission.id, call);
  assert.equal(res.ok, false);
  assert.ok(res.requiresApproval);
  assert.match(res.requiresApproval!.title, /budget/i);
});

