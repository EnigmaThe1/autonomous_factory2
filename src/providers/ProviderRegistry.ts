import * as vscode from "vscode";
import { SecretStore } from "../storage/SecretStore";
import { AgentRole } from "../types";
import { IModelProvider } from "./IModelProvider";
import { OllamaProvider } from "./OllamaProvider";
import { OpenAICompatibleProvider, OPENAI_CLOUD_SPEC, OPENAI_COMPAT_LOCAL_SPEC } from "./OpenAICompatibleProvider";
import { AnthropicProvider } from "./AnthropicProvider";
import { GeminiProvider } from "./GeminiProvider";
import { VsCodeLmProvider } from "./VsCodeLmProvider";
import { chooseProviderForRole } from "./providerRouting";

export class ProviderRegistry {
  private readonly providers: Map<string, IModelProvider>;

  constructor(secrets: SecretStore) {
    this.providers = new Map<string, IModelProvider>([
      ["ollama", new OllamaProvider()],
      ["openai", new OpenAICompatibleProvider(secrets, OPENAI_CLOUD_SPEC)],
      ["openai-compat", new OpenAICompatibleProvider(secrets, OPENAI_COMPAT_LOCAL_SPEC)],
      ["anthropic", new AnthropicProvider(secrets)],
      ["gemini", new GeminiProvider(secrets)],
      ["vscode-lm", new VsCodeLmProvider()]
    ]);
  }

  get(id?: string): IModelProvider {
    const key = id || vscode.workspace.getConfiguration().get<string>("myAi.defaultProvider", "ollama");
    const provider = this.providers.get(key);
    if (!provider) throw new Error(`Unknown provider: ${key}`);
    return provider;
  }

  tryGet(id: string): IModelProvider | undefined {
    return this.providers.get(id);
  }

  chooseForRole(role: AgentRole, fallbackId?: string): string {
    const raw = vscode.workspace.getConfiguration().get<string>("myAi.agents.providerMap", "").trim();
    const fallback = fallbackId || vscode.workspace.getConfiguration().get<string>("myAi.defaultProvider", "ollama");
    return chooseProviderForRole(role, raw, Array.from(this.providers.keys()), fallback);
  }

  list(): string[] {
    return Array.from(this.providers.keys());
  }
}
