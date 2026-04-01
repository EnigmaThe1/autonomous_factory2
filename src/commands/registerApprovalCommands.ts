import * as vscode from "vscode";
import { AiSidebarProvider } from "../ui/AiSidebarProvider";
import { MissionOrchestrator } from "../missions/MissionOrchestrator";
import { MissionStore } from "../missions/MissionStore";
import { ToolRegistry } from "../tools/ToolRegistry";
import { ApprovalBundle } from "../types";
import { presentBundleOperatorUiFeedback, presentResolveApprovalOutcome } from "../ui/missionActionOutcomePresentation";
import { presentResolveApprovalOutcomeEvent } from "../missions/missionActionOutcomeEventPresentation";
import { saveOperatorActionMissionEventIfChanged } from "../missions/missionActionOutcomeEventLogging";
import { buildApprovalBundles, chooseApprovalBundle, pickPendingApprovals } from "./commandHelpers";

function approvalBundleSummary(store: MissionStore, bundle: ApprovalBundle): string {
  const mission = store.get(bundle.missionId);
  const approvals = mission?.approvals.filter((a) => bundle.approvalIds.includes(a.id)) || [];
  const toolCounts = new Map<string, number>();
  for (const approval of approvals) {
    const key = approval.toolCall.tool;
    toolCounts.set(key, (toolCounts.get(key) || 0) + 1);
  }
  const toolLines = [...toolCounts.entries()].map(([tool, count]) => `- ${tool}: ${count}`).join("\n");
  const pathLines = (bundle.targetPaths || []).slice(0, 20).map((pt) => `- ${pt}`).join("\n");
  return [
    `# Approval bundle`,
    '',
    `Mission: ${mission?.title || bundle.missionId}`,
    `Bundle: ${bundle.title}`,
    `Items: ${bundle.approvalIds.length}`,
    `Kinds: ${bundle.kinds.join(', ')}`,
    '',
    `## Tool summary`,
    toolLines || '- none',
    '',
    `## Target paths`,
    pathLines || '- none',
    '',
    `## Approval titles`,
    ...approvals.map((a) => `- ${a.title}`)
  ].join("\n");
}

function buildBundleDiffSummary(store: MissionStore, bundle: ApprovalBundle): string {
  const mission = store.get(bundle.missionId);
  const approvals = mission?.approvals.filter((a) => bundle.approvalIds.includes(a.id)) || [];
  const targetStats = new Map<string, { approvals: number; hunks: number; beforeLines: number; afterLines: number }>();
  for (const approval of approvals) {
    const path = approval.diffPreview?.targetPath || '(non-file action)';
    const stat = targetStats.get(path) || { approvals: 0, hunks: 0, beforeLines: 0, afterLines: 0 };
    stat.approvals += 1;
    const hunks = approval.diffPreview?.hunks || [];
    stat.hunks += hunks.length;
    for (const h of hunks) {
      stat.beforeLines += h.beforeLines.length;
      stat.afterLines += h.afterLines.length;
    }
    targetStats.set(path, stat);
  }
  return [
    `## Diff impact summary`,
    '',
    ...[...targetStats.entries()].map(([path, stat]) => `- ${path}: approvals=${stat.approvals}, hunks=${stat.hunks}, beforeLines=${stat.beforeLines}, afterLines=${stat.afterLines}`)
  ].join('\n');
}

export async function openApprovalBundleSummaryForMission(store: MissionStore, missionId: string): Promise<void> {
  const bundle = buildApprovalBundles(store).find((b) => b.missionId === missionId);
  if (!bundle) {
    await vscode.window.showInformationMessage('No approval bundle found for this mission.');
    return;
  }
  const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: approvalBundleSummary(store, bundle) + '\n\n' + buildBundleDiffSummary(store, bundle) });
  await vscode.window.showTextDocument(doc, { preview: false });
}

export function registerApprovalCommands(
  sidebar: AiSidebarProvider,
  orchestrator: MissionOrchestrator,
  store: MissionStore,
  tools: ToolRegistry
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  disposables.push(
    vscode.commands.registerCommand("myAi.approvePending", async () => {
      const approvals = pickPendingApprovals(store);
      const picked = await vscode.window.showQuickPick(
        approvals.map(({ mission, approval }) => ({ label: approval.title, detail: `${mission.title} • ${approval.kind}`, missionId: mission.id, approvalId: approval.id })),
        { placeHolder: "Approve pending action" }
      );
      if (!picked) return;
      const mission = store.get(picked.missionId);
      const approval = mission?.approvals.find((a) => a.id === picked.approvalId);
      if (approval?.diffPreview && vscode.workspace.getConfiguration().get<boolean>("myAi.tools.showDiffBeforeApproval", true)) {
        await tools.showApprovalDiff(approval.id, approval.diffPreview);
      }
      const out = await orchestrator.resolveApproval(picked.missionId, picked.approvalId, true);
      sidebar.scheduleMissionSectionAfterHostTruthEdge();
      void vscode.window.setStatusBarMessage(presentResolveApprovalOutcome(out), 4000);
      const evt = presentResolveApprovalOutcomeEvent(out);
      if (evt) {
        await saveOperatorActionMissionEventIfChanged({ store, missionId: picked.missionId, message: evt });
      }
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.rejectPending", async () => {
      const approvals = pickPendingApprovals(store);
      const picked = await vscode.window.showQuickPick(
        approvals.map(({ mission, approval }) => ({ label: approval.title, detail: `${mission.title} • ${approval.kind}`, missionId: mission.id, approvalId: approval.id })),
        { placeHolder: "Reject pending action" }
      );
      if (!picked) return;
      const out = await orchestrator.resolveApproval(picked.missionId, picked.approvalId, false, "Rejected from command palette");
      sidebar.scheduleMissionSectionAfterHostTruthEdge();
      void vscode.window.setStatusBarMessage(presentResolveApprovalOutcome(out), 4000);
      const evt = presentResolveApprovalOutcomeEvent(out);
      if (evt) {
        await saveOperatorActionMissionEventIfChanged({ store, missionId: picked.missionId, message: evt });
      }
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.reviewPendingDiff", async () => {
      const approvals = pickPendingApprovals(store, (a) => !!a.diffPreview);
      const picked = await vscode.window.showQuickPick(
        approvals.map(({ mission, approval }) => ({ label: approval.title, detail: `${mission.title} • ${approval.kind}`, missionId: mission.id, approvalId: approval.id })),
        { placeHolder: "Review pending diff" }
      );
      if (!picked) return;
      const mission = store.get(picked.missionId);
      const approval = mission?.approvals.find((a) => a.id === picked.approvalId);
      if (approval?.diffPreview) await tools.showApprovalDiff(approval.id, approval.diffPreview);
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.reviewPendingHunks", async () => {
      const approvals = pickPendingApprovals(store, (a) => !!(a.diffPreview?.hunks?.length));
      const picked = await vscode.window.showQuickPick(
        approvals.map(({ mission, approval }) => ({ label: approval.title, detail: `${mission.title} • ${approval.kind}`, missionId: mission.id, approvalId: approval.id })),
        { placeHolder: "Review pending change hunks" }
      );
      if (!picked) return;
      const mission = store.get(picked.missionId);
      const approval = mission?.approvals.find((a) => a.id === picked.approvalId);
      if (approval?.diffPreview) await tools.showApprovalHunks(approval.id, approval.diffPreview);
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.reviewNextPendingHunk", async () => {
      const approvals = pickPendingApprovals(store, (a) => !!(a.diffPreview?.hunks?.length));
      if (!approvals.length) {
        void vscode.window.showInformationMessage("No pending approval hunks found.");
        return;
      }
      const picked = await vscode.window.showQuickPick(
        approvals.map(({ mission, approval }) => ({ label: approval.title, detail: `${mission.title} • ${approval.diffPreview?.hunks?.length || 0} hunk(s)`, missionId: mission.id, approvalId: approval.id })),
        { placeHolder: "Select an approval to step through hunks" }
      );
      if (!picked) return;
      const mission = store.get(picked.missionId);
      const approval = mission?.approvals.find((a) => a.id === picked.approvalId);
      if (!approval?.diffPreview?.hunks?.length) return;
      const options = approval.diffPreview.hunks.map((h, idx) => ({ label: `Hunk ${idx + 1}`, detail: h.header, index: idx }));
      const chosen = await vscode.window.showQuickPick(options, { placeHolder: "Select a hunk to review" });
      if (!chosen) return;
      await tools.showApprovalHunkAtIndex(approval.id, approval.diffPreview, chosen.index);
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.listApprovalBundles", async () => {
      const picked = await chooseApprovalBundle(store, "Select an approval bundle to inspect");
      if (!picked) return;
      const bundle = buildApprovalBundles(store).find((b) => b.id === picked.bundleId);
      if (!bundle) return;
      const mission = store.get(bundle.missionId);
      const approvals = mission?.approvals.filter((a) => bundle.approvalIds.includes(a.id)) || [];
      const content = [
        `# Approval bundle`,
        '',
        `Mission: ${mission?.title || bundle.missionId}`,
        `Items: ${bundle.approvalIds.length}`,
        '',
        ...approvals.map((a, idx) => `${idx + 1}. [${a.kind}] ${a.title}${a.diffPreview?.targetPath ? `\n   Target: ${a.diffPreview.targetPath}` : ''}`)
      ].join("\n");
      const doc = await vscode.workspace.openTextDocument({ language: "markdown", content });
      await vscode.window.showTextDocument(doc, { preview: false });
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.approveApprovalBundle", async () => {
      const picked = await chooseApprovalBundle(store, "Select an approval bundle to approve");
      if (!picked) return;
      const bundle = buildApprovalBundles(store).find((b) => b.id === picked.bundleId);
      if (!bundle) return;
      const mission = store.get(bundle.missionId);
      if (!mission) return;
      let anyResolved = false;
      for (const approvalId of bundle.approvalIds) {
        const approval = mission.approvals.find((a) => a.id === approvalId);
        if (approval?.diffPreview && vscode.workspace.getConfiguration().get<boolean>("myAi.tools.showDiffBeforeApproval", true)) {
          await tools.showApprovalDiff(approval.id, approval.diffPreview);
        }
        const out = await orchestrator.resolveApproval(bundle.missionId, approvalId, true, "Approved via bundle");
        if (out?.kind && out.kind !== "noop_unknown_approval") anyResolved = true;
      }
      sidebar.scheduleMissionSectionAfterHostTruthEdge();
      void vscode.window.showInformationMessage(presentBundleOperatorUiFeedback({ approved: true, itemCount: bundle.approvalIds.length, anyResolved }));
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.rejectApprovalBundle", async () => {
      const picked = await chooseApprovalBundle(store, "Select an approval bundle to reject");
      if (!picked) return;
      const bundle = buildApprovalBundles(store).find((b) => b.id === picked.bundleId);
      if (!bundle) return;
      let anyResolved = false;
      for (const approvalId of bundle.approvalIds) {
        const out = await orchestrator.resolveApproval(bundle.missionId, approvalId, false, "Rejected via bundle");
        if (out?.kind && out.kind !== "noop_unknown_approval") anyResolved = true;
      }
      sidebar.scheduleMissionSectionAfterHostTruthEdge();
      void vscode.window.showInformationMessage(presentBundleOperatorUiFeedback({ approved: false, itemCount: bundle.approvalIds.length, anyResolved }));
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.reviewApprovalBundleSummary", async () => {
      const picked = await chooseApprovalBundle(store, "Select an approval bundle summary");
      if (!picked) return;
      const bundle = buildApprovalBundles(store).find((b) => b.id === picked.bundleId);
      if (!bundle) return;
      const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: approvalBundleSummary(store, bundle) + "\n\n" + buildBundleDiffSummary(store, bundle) });
      await vscode.window.showTextDocument(doc, { preview: false });
    })
  );

  return disposables;
}
