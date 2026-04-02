import * as vscode from "vscode";
import { AiSidebarProvider } from "../ui/AiSidebarProvider";
import { MissionOrchestrator } from "../missions/MissionOrchestrator";
import { MissionStore } from "../missions/MissionStore";
import { resolveModelForProvider } from "../providers/providerModelResolution";
import { presetRoutingFragment } from "../missions/missionRouting";
import { generateMissionReport } from "../missions/missionReport";
import { AgentRole, MissionAgentRouting, MissionPolicy, WorkItem } from "../types";
import { presentResumeMissionOutcome, presentStartMissionOutcome } from "../ui/missionActionOutcomePresentation";
import { presentResumeMissionOutcomeEvent, presentStartMissionOutcomeEvent } from "../missions/missionActionOutcomeEventPresentation";
import { saveOperatorActionMissionEventIfChanged } from "../missions/missionActionOutcomeEventLogging";
import { exportMissionBlueprintToWorkspaceFile } from "../missions/missionBlueprintExportActions";
import { chooseMission, pickWorkItem, workItemQuickLabel } from "./commandHelpers";

/** VS Code quick input supports `multiline` at runtime on recent builds; `@types/vscode` may omit it. */
type InputBoxOptionsMultiline = vscode.InputBoxOptions & { multiline?: boolean };

function parseRoleMap(raw?: string): Record<string, string> {
  return Object.fromEntries((raw || '').split(',').map((p) => p.trim()).filter(Boolean).map((p) => p.split(':').map((x) => x.trim())).filter((parts) => parts.length === 2));
}

async function promptRoutingUpdate(mission: { title: string; routing?: MissionAgentRouting }): Promise<MissionAgentRouting | undefined> {
  const preset = await vscode.window.showQuickPick([
    { label: "default", detail: "Use workspace defaults" },
    { label: "research_heavy", detail: "Prefer stronger research/planning providers" },
    { label: "local_first", detail: "Prefer local providers for all roles" },
    { label: "review_strict", detail: "Prefer stronger reviewer/validator providers" },
    { label: "custom", detail: "Manually edit per-role provider and model maps" }
  ], { placeHolder: `Routing preset for ${mission.title}` });
  if (!preset) return undefined;

  const label = preset.label as MissionAgentRouting["preset"];
  if (label === "custom") {
    const routing: MissionAgentRouting = { ...(mission.routing || {}), preset: "custom" };
    const providerMap = await vscode.window.showInputBox({ prompt: 'Role->provider map (planner:openai,...)', value: Object.entries(routing.providerPerRole || {}).map(([k, v]) => `${k}:${v}`).join(",") });
    const modelMap = await vscode.window.showInputBox({ prompt: "Role->model map (optional)", value: Object.entries(routing.modelPerRole || {}).map(([k, v]) => `${k}:${v}`).join(",") });
    routing.providerPerRole = parseRoleMap(providerMap) as Partial<Record<AgentRole, string>>;
    routing.modelPerRole = parseRoleMap(modelMap) as Partial<Record<AgentRole, string>>;
    return routing;
  }
  const frag = presetRoutingFragment(label);
  return { preset: label, providerPerRole: { ...frag.providerPerRole }, modelPerRole: { ...frag.modelPerRole } };
}

function missionDependencyGraphMarkdown(mission: ReturnType<MissionStore["get"]>): string {
  if (!mission) return '# Mission graph\n\nMission not found.';
  const nodes = mission.queue.map((w) => `  ${w.id}["${w.role}: ${w.title.replace(/"/g, "'")}"]`);
  const edges = mission.queue.flatMap((w) => (w.dependsOn || []).map((d) => `  ${d} --> ${w.id}`));
  const isolated = mission.queue
    .filter((w) => !(w.dependsOn || []).length)
    .map((w) => `- ${w.role}: ${w.title} (${w.status})`)
    .join("\n");
  return [
    `# Mission dependency graph`,
    '',
    `Mission: ${mission.title}`,
    `Status: ${mission.status}`,
    '',
    '```mermaid',
    'flowchart TD',
    ...(nodes.length ? nodes : ['  empty["No work items"]']),
    ...edges,
    '```',
    '',
    `## Isolated / root tasks`,
    isolated || '- none',
    '',
    `## Status counts`,
    ...["todo", "running", "done", "skipped", "blocked", "failed"].map(
      (status) => `- ${status}: ${mission.queue.filter((w) => w.status === status).length}`
    )
  ].join("\n");
}

export async function editAgentRoutingForMission(store: MissionStore, missionId: string): Promise<void> {
  const mission = store.get(missionId);
  if (!mission) return;
  const routing = await promptRoutingUpdate(mission);
  if (!routing) return;
  await store.updateMission(mission.id, { routing });
  await vscode.window.showInformationMessage(`Updated routing for ${mission.title}`);
}

export async function editMissionPolicyForMission(store: MissionStore, missionId: string): Promise<void> {
  const mission = store.get(missionId);
  if (!mission) return;
  const preset = await vscode.window.showQuickPick([
    { label: "light", detail: "Faster closure, lighter gates" },
    { label: "balanced", detail: "Balanced autonomy and validation" },
    { label: "strict", detail: "Stricter closure and evidence gates" },
    { label: "custom", detail: "Manually edit mission policy fields" }
  ], { placeHolder: `Policy preset for ${mission.title}` });
  if (!preset) return;

  const current = { ...mission.policy };
  if (preset.label !== 'custom') {
    const policy: MissionPolicy = {
      ...current,
      policyPreset: preset.label as MissionPolicy['policyPreset'],
      closureRequired: true,
      requireImplementerBeforeComplete: true,
      requireReviewerBeforeComplete: preset.label !== 'light',
      requireValidatorBeforeComplete: true,
      requireValidationEvidence: preset.label !== 'light',
      minCompletedWorkItems: preset.label === 'strict' ? 6 : preset.label === 'balanced' ? 4 : 2,
      maxAutoRounds: preset.label === 'strict' ? 40 : preset.label === 'balanced' ? 24 : 12,
      stallReplanThreshold: preset.label === 'strict' ? 4 : preset.label === 'balanced' ? 3 : 2,
      autoContinue: true,
    };
    await store.updateMission(mission.id, { policy });
    await vscode.window.showInformationMessage(`Updated policy for ${mission.title}`);
    return;
  }

  const minCompletedWorkItems = await vscode.window.showInputBox({ prompt: 'Minimum completed work items before closure', value: String(current.minCompletedWorkItems) });
  const maxAutoRounds = await vscode.window.showInputBox({ prompt: 'Maximum autonomous rounds', value: String(current.maxAutoRounds) });
  const requireEvidence = await vscode.window.showQuickPick([{ label: 'yes' }, { label: 'no' }], { placeHolder: 'Require validation evidence before closure?' });
  const policy: MissionPolicy = {
    ...current,
    policyPreset: 'custom',
    minCompletedWorkItems: Number(minCompletedWorkItems || current.minCompletedWorkItems),
    maxAutoRounds: Number(maxAutoRounds || current.maxAutoRounds),
    requireValidationEvidence: requireEvidence ? requireEvidence.label === 'yes' : current.requireValidationEvidence,
    autoContinue: true,
  };
  await store.updateMission(mission.id, { policy });
  await vscode.window.showInformationMessage(`Updated policy for ${mission.title}`);
}

export async function editMissionDagForMission(store: MissionStore, missionId: string): Promise<void> {
  const mission = store.get(missionId);
  if (!mission) return;

  const action = await vscode.window.showQuickPick([
    { label: 'add_work_item', detail: 'Create a new DAG node/work item' },
    { label: 'edit_dependencies', detail: 'Change dependencies for an existing work item' },
    { label: 'remove_work_item', detail: 'Remove a work item from the DAG' },
    { label: 'reset_blocked_to_todo', detail: 'Reset blocked/failed work items to todo' }
  ], { placeHolder: `Edit mission DAG for ${mission.title}` });
  if (!action) return;

  if (action.label === 'add_work_item') {
    const title = await vscode.window.showInputBox({ prompt: 'Work item title' });
    if (!title) return;
    const rolePick = await vscode.window.showQuickPick(['planner', 'researcher', 'implementer', 'reviewer', 'validator'], { placeHolder: 'Role for the new work item' });
    if (!rolePick) return;
    const prompt = await vscode.window.showInputBox({ prompt: 'Work item prompt/instructions' });
    if (!prompt) return;
    const depPicks = await vscode.window.showQuickPick(mission.queue.map((w) => ({ label: workItemQuickLabel(w), picked: false, workId: w.id })), { canPickMany: true, placeHolder: 'Optional dependencies for the new work item' });
    const work: WorkItem = { id: `work_${Date.now().toString(36)}`, title, role: rolePick as AgentRole, status: 'todo', prompt, dependsOn: depPicks?.map((x) => x.workId) || [] };
    await store.enqueue(mission.id, [work]);
    await store.saveEvent(mission.id, { level: 'info', source: 'dag-editor', message: `Added work item: ${title}` });
    return;
  }

  if (action.label === 'edit_dependencies') {
    const picked = await pickWorkItem(mission, 'Select a work item to edit dependencies');
    if (!picked) return;
    const work = mission.queue.find((w) => w.id === picked.workId);
    if (!work) return;
    const depPicks = await vscode.window.showQuickPick(mission.queue.filter((w) => w.id !== work.id).map((w) => ({ label: workItemQuickLabel(w), picked: (work.dependsOn || []).includes(w.id), workId: w.id })), { canPickMany: true, placeHolder: `Dependencies for ${work.title}` });
    const queue = mission.queue.map((w) => w.id === work.id ? { ...w, dependsOn: depPicks?.map((x) => x.workId) || [] } : w);
    await store.updateMission(mission.id, { queue });
    await store.saveEvent(mission.id, { level: 'info', source: 'dag-editor', message: `Updated dependencies for ${work.title}` });
    return;
  }

  if (action.label === 'remove_work_item') {
    const picked = await pickWorkItem(mission, 'Select a work item to remove');
    if (!picked) return;
    const queue = mission.queue.filter((w) => w.id !== picked.workId).map((w) => ({ ...w, dependsOn: (w.dependsOn || []).filter((d) => d !== picked.workId) }));
    await store.updateMission(mission.id, { queue });
    await store.saveEvent(mission.id, { level: 'warn', source: 'dag-editor', message: `Removed work item ${picked.label}` });
    return;
  }

  if (action.label === 'reset_blocked_to_todo') {
    const queue = mission.queue.map((w) => (w.status === 'blocked' || w.status === 'failed') ? { ...w, status: 'todo' as const } : w);
    await store.updateMission(mission.id, { queue, blocker: undefined, blockReasonCode: undefined, status: 'queued' });
    await store.saveEvent(mission.id, { level: 'info', source: 'dag-editor', message: 'Reset blocked/failed work items back to todo.' });
    return;
  }
}

export function registerMissionCommands(
  sidebar: AiSidebarProvider,
  orchestrator: MissionOrchestrator,
  store: MissionStore
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  disposables.push(
    vscode.commands.registerCommand("myAi.startMission", async () => {
      const title = await vscode.window.showInputBox({ prompt: "Mission title" });
      if (!title) return;
      const prompt = await vscode.window.showInputBox({ prompt: "Mission prompt" });
      if (!prompt) return;
      const cfg = vscode.workspace.getConfiguration();
      const providerId = cfg.get<string>("myAi.defaultProvider", "ollama");
      const model = resolveModelForProvider(providerId, undefined, (k, d) => cfg.get(k, d));
      const started = await orchestrator.startMission(title, prompt, providerId, model);
      const { mission } = started;
      sidebar.reveal();
      sidebar.focusMission(mission.id);
      void vscode.window.setStatusBarMessage(presentStartMissionOutcome(started), 4000);
      await saveOperatorActionMissionEventIfChanged({ store, missionId: mission.id, message: presentStartMissionOutcomeEvent(started) });
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.resumeMission", async () => {
      const picked = await chooseMission(store, "Select a mission to resume", (s) => ["queued", "running", "blocked", "awaiting_input"].includes(s));
      if (!picked) return;
      const out = await orchestrator.resumeMission(picked.missionId);
      sidebar.reveal();
      sidebar.focusMission(picked.missionId);
      void vscode.window.setStatusBarMessage(presentResumeMissionOutcome(out), 4000);
      const evt = presentResumeMissionOutcomeEvent(out);
      if (evt) {
        await saveOperatorActionMissionEventIfChanged({ store, missionId: picked.missionId, message: evt });
      }
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.listMissions", async () => {
      const picked = await chooseMission(store, "Select a mission to open");
      if (!picked) return;
      sidebar.reveal();
      sidebar.focusMission(picked.missionId);
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.approveMissionBlueprint", async () => {
      const missions = store.listVisible(false).filter((m) => m.blueprint?.status === "awaiting_approval");
      const picked = await vscode.window.showQuickPick(
        missions.map((m) => ({ label: m.title, missionId: m.id, detail: m.status })),
        { placeHolder: "Select mission whose blueprint to approve" }
      );
      if (!picked) return;
      const out = await orchestrator.approveMissionBlueprint(picked.missionId);
      void vscode.window.showInformationMessage(out.message);
      sidebar.reveal();
      sidebar.focusMission(picked.missionId);
      void sidebar.refreshDashboard(undefined, { source: "blueprint_approve" });
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.rejectMissionBlueprint", async () => {
      const missions = store.listVisible(false).filter((m) => m.blueprint?.status === "awaiting_approval");
      const picked = await vscode.window.showQuickPick(
        missions.map((m) => ({ label: m.title, missionId: m.id, detail: m.status })),
        { placeHolder: "Select mission whose blueprint to reject" }
      );
      if (!picked) return;
      const ok = await vscode.window.showWarningMessage("Reject blueprint and cancel this mission?", { modal: true }, "Reject");
      if (ok !== "Reject") return;
      const out = await orchestrator.rejectMissionBlueprint(picked.missionId);
      void vscode.window.showInformationMessage(out.message);
      void sidebar.refreshDashboard(undefined, { source: "blueprint_reject" });
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.requestMissionBlueprintRevision", async () => {
      const missions = store.listVisible(false).filter((m) => m.blueprint?.status === "awaiting_approval");
      const picked = await vscode.window.showQuickPick(
        missions.map((m) => ({ label: m.title, missionId: m.id, detail: m.status })),
        { placeHolder: "Select mission to revise blueprint" }
      );
      if (!picked) return;
      const note = await vscode.window.showInputBox({ prompt: "What should change in the blueprint?" });
      if (!note?.trim()) return;
      const out = await orchestrator.requestMissionBlueprintRevision(picked.missionId, note.trim());
      void vscode.window.showInformationMessage(out.message);
      void sidebar.refreshDashboard(undefined, { source: "blueprint_revise" });
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.submitPreBlueprintClarification", async () => {
      const missions = store
        .listVisible(false)
        .filter((m) => m.blockReasonCode === "awaiting_pre_blueprint_answers");
      const picked = await vscode.window.showQuickPick(
        missions.map((m) => ({ label: m.title, missionId: m.id, detail: m.status })),
        { placeHolder: "Select mission waiting for pre-blueprint answers" }
      );
      if (!picked) return;
      const inputOpts: InputBoxOptionsMultiline = {
        title: "Pre-blueprint answers",
        prompt:
          "Answer the mission’s clarification questions. On recent VS Code, Shift+Enter adds a line; otherwise use the Missions inspector textarea.",
        placeHolder: "Free-form answers to the listed questions",
        ignoreFocusOut: true,
        multiline: true
      };
      const answers = await vscode.window.showInputBox(inputOpts);
      if (answers === undefined) return;
      const out = await orchestrator.submitPreBlueprintClarificationAnswers(picked.missionId, answers);
      void vscode.window.showInformationMessage(out.message);
      sidebar.reveal();
      sidebar.focusMission(picked.missionId);
      void sidebar.refreshDashboard(undefined, { source: "pre_blueprint_submit" });
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.exportMissionBlueprint", async () => {
      const missions = store.listVisible(false).filter((m) => m.blueprint);
      const picked = await vscode.window.showQuickPick(
        missions.map((m) => ({ label: m.title, missionId: m.id, detail: m.blueprint?.status })),
        { placeHolder: "Select mission whose blueprint to export as markdown" }
      );
      if (!picked) return;
      const mission = store.get(picked.missionId);
      if (!mission) return;
      const out = await exportMissionBlueprintToWorkspaceFile(mission);
      if (out.ok) {
        void vscode.window.showInformationMessage(out.message);
        void vscode.window.showTextDocument(out.exportedUri);
      } else if (out.message !== "Export cancelled.") {
        void vscode.window.showWarningMessage(out.message);
      }
      sidebar.reveal();
      sidebar.focusMission(picked.missionId);
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.archiveMission", async () => {
      const picked = await chooseMission(store, "Select a mission to archive");
      if (!picked) return;
      const ok = await vscode.window.showWarningMessage("Archive this mission? It will be hidden from default dashboard lists.", { modal: true }, "Archive");
      if (ok !== "Archive") return;
      await store.archiveMission(picked.missionId);
      void vscode.window.showInformationMessage("Mission archived.");
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.deleteMission", async () => {
      const picked = await chooseMission(store, "Select a mission to delete permanently");
      if (!picked) return;
      const ok = await vscode.window.showWarningMessage("Delete this mission permanently from mission persistence?", { modal: true }, "Delete");
      if (ok !== "Delete") return;
      await store.deleteMission(picked.missionId);
      void vscode.window.showInformationMessage("Mission deleted.");
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.bulkArchiveCompletedMissions", async () => {
      const ok = await vscode.window.showWarningMessage("Archive all completed (non-archived) missions?", { modal: true }, "Archive completed");
      if (ok !== "Archive completed") return;
      const n = await store.bulkArchiveCompletedMissions();
      void vscode.window.showInformationMessage(`Archived ${n} completed mission(s).`);
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.bulkDeleteFailedTestMissions", async () => {
      const ok = await vscode.window.showWarningMessage("Delete failed test missions permanently?", { modal: true }, "Delete failed tests");
      if (ok !== "Delete failed tests") return;
      const { deleted, skipped } = await store.bulkDeleteFailedTestMissions();
      void vscode.window.showInformationMessage(
        deleted || skipped
          ? `Deleted ${deleted} failed test mission(s)${skipped ? `; ${skipped} skipped` : ""}.`
          : "No matching failed test missions to delete."
      );
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.bulkDeleteBlockedTestMissions", async () => {
      const ok = await vscode.window.showWarningMessage("Delete blocked test missions permanently?", { modal: true }, "Delete blocked tests");
      if (ok !== "Delete blocked tests") return;
      const { deleted, skipped } = await store.bulkDeleteBlockedTestMissions();
      void vscode.window.showInformationMessage(
        deleted || skipped
          ? `Deleted ${deleted} blocked test mission(s)${skipped ? `; ${skipped} skipped` : ""}.`
          : "No matching blocked test missions to delete."
      );
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.editMissionPolicy", async () => {
      const picked = await chooseMission(store, "Select a mission to edit policy");
      if (!picked) return;
      await editMissionPolicyForMission(store, picked.missionId);
      sidebar.focusMission(picked.missionId);
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.editAgentRouting", async () => {
      const picked = await chooseMission(store, "Select a mission to edit agent routing");
      if (!picked) return;
      await editAgentRoutingForMission(store, picked.missionId);
      sidebar.focusMission(picked.missionId);
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.editMissionDag", async () => {
      const picked = await chooseMission(store, "Select a mission to edit the DAG");
      if (!picked) return;
      await editMissionDagForMission(store, picked.missionId);
      sidebar.focusMission(picked.missionId);
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.viewMissionDependencyGraph", async () => {
      const picked = await chooseMission(store, "Select a mission to graph");
      if (!picked) return;
      const mission = store.get(picked.missionId);
      const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: missionDependencyGraphMarkdown(mission) });
      await vscode.window.showTextDocument(doc, { preview: false });
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.showMissionMemory", async () => {
      const picked = await chooseMission(store, "Select a mission to inspect memory");
      if (!picked) return;
      const mission = store.get(picked.missionId);
      if (!mission) return;
      const content = [`# ${mission.title}`, '', ...mission.memory.map((m) => `- ${new Date(m.ts).toLocaleString()} [${m.kind}] ${m.text}`)].join("\n");
      const doc = await vscode.workspace.openTextDocument({ language: "markdown", content });
      await vscode.window.showTextDocument(doc, { preview: false });
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.exportMissionBundle", async () => {
      const picked = await chooseMission(store, "Select a mission to export");
      if (!picked) return;
      const mission = store.get(picked.missionId);
      if (!mission) return;
      const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(`${mission.title.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}__bundle.json`) });
      if (!target) return;
      await vscode.workspace.fs.writeFile(target, Buffer.from(JSON.stringify(mission, null, 2), "utf8"));
      void vscode.window.showInformationMessage(`Exported mission bundle to ${target.fsPath}`);
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.viewMissionReport", async () => {
      const picked = await chooseMission(store, "Select a mission to generate report for");
      if (!picked) return;
      const mission = store.get(picked.missionId);
      if (!mission) return;
      const report = generateMissionReport(mission);
      const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: report.markdown });
      await vscode.window.showTextDocument(doc, { preview: false });
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.exportMissionReport", async () => {
      const picked = await chooseMission(store, "Select a mission to export report for");
      if (!picked) return;
      const mission = store.get(picked.missionId);
      if (!mission) return;
      const report = generateMissionReport(mission);
      const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`${mission.title.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}__report.md`),
        filters: { "Markdown": ["md"], "JSON": ["json"] }
      });
      if (!target) return;
      const isJson = target.fsPath.endsWith(".json");
      const content = isJson
        ? JSON.stringify({ ...report, markdown: undefined }, null, 2)
        : report.markdown;
      await vscode.workspace.fs.writeFile(target, Buffer.from(content, "utf8"));
      void vscode.window.showInformationMessage(`Mission report saved to ${target.fsPath}`);
    })
  );

  return disposables;
}
