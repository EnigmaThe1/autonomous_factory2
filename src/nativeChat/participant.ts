import * as vscode from "vscode";
import { ContextCollector } from "../context/ContextCollector";
import { ProviderRegistry } from "../providers/ProviderRegistry";
import { resolveModelForProvider } from "../providers/providerModelResolution";
import { EXTENSION_CHAT_WORKSPACE_RULES } from "../agents/extensionToolHardRules";

export function registerNativeParticipant(
  context: vscode.ExtensionContext,
  providers: ProviderRegistry,
  collector: ContextCollector
) {
  const anyVscode = vscode as any;
  if (!anyVscode.chat?.createChatParticipant) return;

  const participant = anyVscode.chat.createChatParticipant("my-ai.agent", async (request: any, _chatContext: any, stream: any) => {
    const cfg = vscode.workspace.getConfiguration();
    const defaultPid = cfg.get<string>("myAi.defaultProvider", "ollama");
    const provider = providers.get(defaultPid);
    const model = resolveModelForProvider(defaultPid, undefined, (k, d) => cfg.get(k, d));
    const ideContext = await collector.collect();
    const ac = new AbortController();
    const token = request.cancellationToken as vscode.CancellationToken | undefined;
    const sub = token?.onCancellationRequested(() => ac.abort());
    try {
      for await (const chunk of provider.stream({
        prompt: request.prompt,
        model,
        context: ideContext,
        system: [
          "You are the Autonomous Factory native participant inside VS Code.",
          EXTENSION_CHAT_WORKSPACE_RULES
        ].join("\n\n"),
        signal: ac.signal
      })) {
        stream.markdown(chunk);
      }
    } finally {
      sub?.dispose();
    }
  });

  context.subscriptions.push(participant);
}
