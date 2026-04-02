import * as vscode from "vscode";
import type { AiSidebarUiDispatchHost } from "./aiSidebarUiDispatchHost";

export async function dispatchUi_openAgentCapabilitiesDoc(_host: AiSidebarUiDispatchHost): Promise<boolean> {
  await vscode.commands.executeCommand("myAi.openAgentCapabilitiesDoc");
  return false;
}
