import * as vscode from "vscode";
import type { AiSidebarUiDispatchHost } from "./aiSidebarUiDispatchHost";

export async function dispatchUi_openAgentCapabilitiesDoc(_host: AiSidebarUiDispatchHost): Promise<boolean> {
  await vscode.commands.executeCommand("myAi.openAgentCapabilitiesDoc");
  return false;
}

export async function dispatchUi_applyLazyDiscoveryPreset(_host: AiSidebarUiDispatchHost): Promise<boolean> {
  await vscode.commands.executeCommand("myAi.applyLazyDiscoveryPreset");
  return false;
}

export async function dispatchUi_revertLazyDiscoveryPreset(_host: AiSidebarUiDispatchHost): Promise<boolean> {
  await vscode.commands.executeCommand("myAi.revertLazyDiscoveryPreset");
  return false;
}

export async function dispatchUi_openMissionAutonomyBlueprint(_host: AiSidebarUiDispatchHost): Promise<boolean> {
  await vscode.commands.executeCommand("myAi.openMissionAutonomyBlueprint");
  return false;
}
