
import * as vscode from "vscode";
import { ContextCollector } from "../context/ContextCollector";
import { EmbeddingMemoryIndex } from "../memory/EmbeddingMemoryIndex";
import { GlobalMemoryStore } from "../memory/GlobalMemoryStore";
import { ProviderRegistry } from "../providers/ProviderRegistry";
import { AgentRole } from "../types";
import { BaseAgent } from "./BaseAgent";
import { ImplementerAgent } from "./ImplementerAgent";
import { PlannerAgent } from "./PlannerAgent";
import { ResearchAgent } from "./ResearchAgent";
import { ReviewerAgent } from "./ReviewerAgent";
import { ValidatorAgent } from "./ValidatorAgent";

export class AgentFactory {
  private readonly memoryIndex = new EmbeddingMemoryIndex();
  private embedFnInitialized = false;

  constructor(
    private readonly providers: ProviderRegistry,
    private readonly globalMemory: GlobalMemoryStore,
    private readonly collector?: ContextCollector
  ) {}

  private tryInitEmbedFn(): void {
    if (this.embedFnInitialized) return;
    this.embedFnInitialized = true;
    const cfg = vscode.workspace.getConfiguration();
    const useReal = cfg.get<boolean>("myAi.embeddings.useRealEmbeddings", false);
    if (!useReal) return;
    const providerId = cfg.get<string>("myAi.embeddings.provider", "openai");
    const provider = this.providers.tryGet(providerId);
    if (provider?.embed) {
      this.memoryIndex.setEmbedFn((texts) => provider.embed!(texts));
    }
  }

  create(role: AgentRole): BaseAgent {
    this.tryInitEmbedFn();
    switch (role) {
      case 'planner': return new PlannerAgent(this.providers, this.globalMemory, this.collector, this.memoryIndex);
      case 'researcher': return new ResearchAgent(this.providers, this.globalMemory, this.collector, this.memoryIndex);
      case 'implementer': return new ImplementerAgent(this.providers, this.globalMemory, this.collector, this.memoryIndex);
      case 'reviewer': return new ReviewerAgent(this.providers, this.globalMemory, this.collector, this.memoryIndex);
      case 'validator': return new ValidatorAgent(this.providers, this.globalMemory, this.collector, this.memoryIndex);
      default: return new ImplementerAgent(this.providers, this.globalMemory, this.collector, this.memoryIndex);
    }
  }
}
