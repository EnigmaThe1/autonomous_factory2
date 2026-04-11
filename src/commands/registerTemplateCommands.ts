import * as vscode from "vscode";
import { MissionTemplateStore } from "../missions/MissionTemplateStore";
import { MissionStore } from "../missions/MissionStore";
import { MissionOrchestrator } from "../missions/MissionOrchestrator";
import { AiSidebarProvider } from "../ui/AiSidebarProvider";
import { MissionTemplate } from "../types";
import { presentStartMissionOutcome } from "../ui/missionActionOutcomePresentation";
import { chooseMission } from "./commandHelpers";

async function chooseTemplate(templates: MissionTemplateStore, placeHolder: string): Promise<MissionTemplate | undefined> {
  const items = templates.list();
  if (!items.length) {
    vscode.window.showInformationMessage("No mission templates saved yet.");
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(
    items.map((t) => ({ label: t.name, description: t.description || "", detail: `Prompt: ${t.prompt.slice(0, 80)}…`, template: t })),
    { placeHolder }
  );
  return pick?.template;
}

export function registerTemplateCommands(
  sidebar: AiSidebarProvider,
  orchestrator: MissionOrchestrator,
  missionStore: MissionStore,
  templates: MissionTemplateStore
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("myAi.saveAsTemplate", async () => {
      const pick = await chooseMission(missionStore, "Select a mission to save as template");
      if (!pick) return;
      const mission = missionStore.get(pick.missionId);
      if (!mission) return;
      const name = await vscode.window.showInputBox({
        prompt: "Template name",
        value: mission.title,
        validateInput: (v) => (v.trim() ? null : "Name is required")
      });
      if (!name) return;
      const description = await vscode.window.showInputBox({ prompt: "Description (optional)" });
      await templates.save({
        name: name.trim(),
        description: description?.trim() || undefined,
        prompt: mission.prompt,
        providerId: mission.activeProviderId,
        model: mission.activeModel,
        routing: mission.routing ? { ...mission.routing } : undefined,
        policy: { ...mission.policy }
      });
      vscode.window.showInformationMessage(`Template "${name.trim()}" saved.`);
    }),

    vscode.commands.registerCommand("myAi.startFromTemplate", async () => {
      const template = await chooseTemplate(templates, "Select a template to start mission from");
      if (!template) return;
      const title = await vscode.window.showInputBox({
        prompt: "Mission title",
        value: template.name
      });
      if (!title) return;
      const prompt = await vscode.window.showInputBox({
        prompt: "Mission prompt (edit or press Enter to use template prompt)",
        value: template.prompt
      });
      if (!prompt) return;
      const cfg = vscode.workspace.getConfiguration();
      const providerId = template.providerId || cfg.get<string>("myAi.defaultProvider", "ollama");
      const result = await orchestrator.startMission(title.trim(), prompt.trim(), providerId, template.model);
      const mission = result.mission;
      const patch: Record<string, unknown> = {};
      if (template.routing) patch.routing = template.routing;
      if (template.policy) patch.policy = template.policy;
      if (Object.keys(patch).length) {
        await missionStore.updateMission(mission.id, patch);
      }
      vscode.window.showInformationMessage(presentStartMissionOutcome(result));
      sidebar.reveal();
      sidebar.focusMission(mission.id);
    }),

    vscode.commands.registerCommand("myAi.listTemplates", async () => {
      const items = templates.list();
      if (!items.length) {
        vscode.window.showInformationMessage("No mission templates saved yet. Use 'Save Mission as Template' to create one.");
        return;
      }
      const pick = await vscode.window.showQuickPick(
        items.map((t) => ({
          label: t.name,
          description: t.description || "",
          detail: `Created: ${new Date(t.createdAt).toLocaleDateString()} • Prompt: ${t.prompt.slice(0, 60)}…`,
          template: t
        })),
        { placeHolder: "Select a template to manage" }
      );
      if (!pick) return;
      const action = await vscode.window.showQuickPick(
        [
          { label: "Start Mission", value: "start" },
          { label: "Delete Template", value: "delete" }
        ],
        { placeHolder: `Action for template "${pick.label}"` }
      );
      if (action?.value === "start") {
        await vscode.commands.executeCommand("myAi.startFromTemplate");
      } else if (action?.value === "delete") {
        await templates.delete(pick.template.id);
        vscode.window.showInformationMessage(`Template "${pick.label}" deleted.`);
      }
    })
  ];
}
