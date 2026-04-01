import { ChatRequest } from "../types";
import { IModelProvider } from "./IModelProvider";
import * as vscode from "vscode";
import { resolveModelForProvider } from "./providerModelResolution";

export class VsCodeLmProvider implements IModelProvider {
  readonly id = "vscode-lm";

  async *stream(req: ChatRequest): AsyncIterable<string> {
    const vscodeAny = await import("vscode") as any;
    if (!vscodeAny.lm?.selectChatModels) {
      throw new Error("VS Code Language Model API is not available in this environment.");
    }

    const cfg = vscode.workspace.getConfiguration();
    const want = resolveModelForProvider(this.id, req.model, (k, d) => cfg.get(k, d)).trim();

    const models = await vscodeAny.lm.selectChatModels();
    let model = models?.[0];
    if (want && models?.length) {
      const match = models.find(
        (m: any) =>
          m.id === want ||
          m.name === want ||
          (typeof m.family === "string" && m.family === want) ||
          (m.vendor && `${m.vendor}/${m.family || m.id}` === want)
      );
      if (match) model = match;
    }
    if (!model) throw new Error("No VS Code chat model available. Configure Copilot or another LM extension, or pick another provider.");

    const fallback = new AbortController();
    const signal = req.signal ?? fallback.signal;
    const messages: unknown[] = [];
    if (req.history?.length) {
      for (const turn of req.history) {
        if (turn.role === "user") messages.push(vscodeAny.LanguageModelChatMessage.User(turn.content));
        else messages.push(vscodeAny.LanguageModelChatMessage.Assistant(turn.content));
      }
    }
    messages.push(
      vscodeAny.LanguageModelChatMessage.User([
        req.context.selection ? `Selection:\n${req.context.selection}\n\n` : "",
        req.context.activeFileText ? `Active file:\n${req.context.activeFileText}\n\n` : "",
        `User request:\n${req.prompt}`
      ].join(""))
    );
    const response = await model.sendRequest(messages, {}, signal);

    for await (const fragment of response.text) {
      if (signal.aborted) return;
      yield String(fragment);
    }
  }
}
