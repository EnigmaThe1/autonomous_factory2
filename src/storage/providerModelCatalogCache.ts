import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";

const CACHE_FILENAME = "providerModelCatalog.v1.json";

export type CatalogCacheProviderEntryV1 = {
  providerId: string;
  fetchedAt: number;
  source: string;
  modelsAll: string[];
  modelsDisplay: string[];
  hint?: string;
};

export type ProviderModelCatalogFileV1 = {
  version: 1;
  savedAt: number;
  providers: Record<string, CatalogCacheProviderEntryV1>;
};

const PERSISTED_PROVIDERS = new Set(["openai", "gemini", "anthropic", "ollama"]);

export class ProviderModelCatalogCache {
  constructor(private readonly globalStorageUri: vscode.Uri) {}

  private filePath(): string {
    return path.join(this.globalStorageUri.fsPath, CACHE_FILENAME);
  }

  async readAll(): Promise<ProviderModelCatalogFileV1 | undefined> {
    try {
      const raw = await fs.readFile(this.filePath(), "utf8");
      const j = JSON.parse(raw) as ProviderModelCatalogFileV1;
      if (j?.version !== 1 || !j.providers || typeof j.providers !== "object") return undefined;
      return j;
    } catch {
      return undefined;
    }
  }

  async writeMergedProvider(entry: CatalogCacheProviderEntryV1): Promise<void> {
    if (!PERSISTED_PROVIDERS.has(entry.providerId)) return;
    const prev = (await this.readAll()) ?? { version: 1 as const, savedAt: 0, providers: {} };
    prev.providers[entry.providerId] = entry;
    prev.savedAt = Date.now();
    const dir = path.dirname(this.filePath());
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.filePath(), JSON.stringify(prev, null, 2), "utf8");
  }

  getProviderFromSnapshot(file: ProviderModelCatalogFileV1 | undefined, providerId: string): CatalogCacheProviderEntryV1 | undefined {
    if (!file?.providers) return undefined;
    return file.providers[providerId];
  }

  shouldPersistProvider(providerId: string): boolean {
    return PERSISTED_PROVIDERS.has(providerId);
  }
}

export function isPersistedCatalogProvider(providerId: string): boolean {
  return PERSISTED_PROVIDERS.has(providerId);
}
