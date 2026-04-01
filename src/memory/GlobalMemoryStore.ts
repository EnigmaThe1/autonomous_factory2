
import * as vscode from "vscode";
import { MemoryItem } from "../types";
import { EmbeddingMemoryIndex } from "./EmbeddingMemoryIndex";
import { DiskMissionPersistence } from "../storage/DiskMissionPersistence";

const GLOBAL_MEMORY_KEY = "myAi.globalMemory";

export class GlobalMemoryStore {
  private readonly index = new EmbeddingMemoryIndex();
  /**
   * Bumps on every `GLOBAL_MEMORY_KEY` persist (`add`, `hydrateFromDisk` merge). Poll routing can reuse a cached
   * global-memory *head* fingerprint when generation is unchanged (same contract as mission store generation).
   */
  private globalMemoryMutationGeneration = 0;
  /**
   * Optional: invoked synchronously after a successful persist from `add` (globalState + disk).
   * Extension wires this to event-driven `globalMemory` snapshotSection refresh; must not throw.
   */
  onAfterPersist?: () => void;
  constructor(
    private readonly globalState: vscode.Memento,
    private readonly disk: DiskMissionPersistence
  ) {}

  /** Monotonic; increments when global memory storage changes. */
  getMutationGeneration(): number {
    return this.globalMemoryMutationGeneration;
  }

  private bumpMutationGeneration(): void {
    this.globalMemoryMutationGeneration += 1;
  }

  list(): MemoryItem[] {
    return this.globalState.get<MemoryItem[]>(GLOBAL_MEMORY_KEY, []).sort((a,b)=> b.ts - a.ts);
  }

  async hydrateFromDisk(): Promise<void> {
    const diskItems = await this.disk.loadGlobalMemory();
    if (!diskItems.length) return;
    const merged = new Map<string, MemoryItem>();
    for (const item of this.list()) merged.set(item.id, item);
    for (const item of diskItems) merged.set(item.id, item);
    await this.globalState.update(GLOBAL_MEMORY_KEY, [...merged.values()].sort((a,b)=> b.ts - a.ts));
    this.bumpMutationGeneration();
  }

  search(query: string, limit?: number): MemoryItem[] {
    const max = limit || vscode.workspace.getConfiguration().get<number>("myAi.memory.globalRecallLimit", 6);
    return this.index.query(this.list(), query, max);
  }

  async add(item: MemoryItem): Promise<void> {
    if (!vscode.workspace.getConfiguration().get<boolean>('myAi.memory.enableGlobalSemanticMemory', true)) return;
    const all = this.list();
    all.push(item);
    const trimmed = all.sort((a,b)=> b.ts - a.ts).slice(0, 1000);
    await this.globalState.update(GLOBAL_MEMORY_KEY, trimmed);
    await this.disk.saveGlobalMemory(trimmed);
    this.bumpMutationGeneration();
    try {
      this.onAfterPersist?.();
    } catch {
      /* persistence already succeeded; never fail the store on UI hook */
    }
  }
}
