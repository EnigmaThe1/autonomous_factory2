import * as vscode from "vscode";
import { MemoryItem } from "../types";
import { tokenise } from "../util";

const LOCAL_DIMENSIONS = 192;

function tokenHash(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

function charNgrams(text: string, n = 3): string[] {
  const cleaned = text.toLowerCase().replace(/\s+/g, " ").trim();
  const grams: string[] = [];
  for (let i = 0; i <= cleaned.length - n; i++) grams.push(cleaned.slice(i, i + n));
  return grams;
}

function localEmbed(text: string, tags?: string[]): number[] {
  const vec = new Array<number>(LOCAL_DIMENSIONS).fill(0);
  const tokens = [...tokenise(text), ...(tags || []).flatMap((t) => tokenise(t))];
  for (const token of tokens) {
    const h = tokenHash(token);
    vec[h % LOCAL_DIMENSIONS] += 1.3;
    vec[(h >> 7) % LOCAL_DIMENSIONS] += 0.85;
    vec[(h >> 13) % LOCAL_DIMENSIONS] += 0.55;
  }
  for (const gram of charNgrams(`${text} ${(tags || []).join(" ")}`)) {
    const h = tokenHash(gram);
    vec[h % LOCAL_DIMENSIONS] += 0.18;
  }
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

function cosine(a: number[], b: number[]): number {
  let total = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) total += a[i] * b[i];
  return total;
}

/** External embedding function provided by a model provider. */
export type EmbedFn = (texts: string[]) => Promise<number[][]>;

export class EmbeddingMemoryIndex {
  private embedFn?: EmbedFn;
  private readonly vectorCache = new Map<string, number[]>();

  /** Attach a real embedding function (from a provider that supports it). */
  setEmbedFn(fn: EmbedFn | undefined): void {
    if (fn !== this.embedFn) {
      this.embedFn = fn;
      this.vectorCache.clear();
    }
  }

  /**
   * Query memory items by semantic similarity.
   * Uses real embeddings when available, falls back to FNV-1a token hashing.
   */
  query(items: MemoryItem[], queryText: string, limit: number): MemoryItem[] {
    const qVec = localEmbed(queryText);
    const qTokens = new Set(tokenise(queryText));
    const threshold = vscode.workspace.getConfiguration().get<number>("myAi.memory.minSemanticScore", 0.11);
    const ranked = items.map((item) => {
      const text = `${item.text}\n${(item.tags || []).join(" ")}`;
      const similarity = cosine(qVec, localEmbed(text, item.tags));
      let overlap = 0;
      for (const t of qTokens) {
        if (text.toLowerCase().includes(t)) overlap += 0.045;
      }
      const ageMs = Date.now() - item.ts;
      const recency = ageMs < 1000 * 60 * 60 * 24 * 3 ? 0.09 : ageMs < 1000 * 60 * 60 * 24 * 14 ? 0.05 : 0.015;
      return { item, score: similarity + overlap + recency };
    });

    return ranked
      .filter((r) => r.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((r) => r.item);
  }

  /**
   * Async query using real provider embeddings when available.
   * Falls back to synchronous local query if embedding function not set or fails.
   */
  async queryAsync(items: MemoryItem[], queryText: string, limit: number): Promise<MemoryItem[]> {
    if (!this.embedFn || !items.length) return this.query(items, queryText, limit);

    try {
      const textsToEmbed: string[] = [];
      const itemIndicesNeedingEmbed: number[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.embedding) {
          this.vectorCache.set(`${item.id}:${item.ts}`, item.embedding);
        } else if (!this.vectorCache.has(`${item.id}:${item.ts}`)) {
          textsToEmbed.push(`${item.text}\n${(item.tags || []).join(" ")}`);
          itemIndicesNeedingEmbed.push(i);
        }
      }

      const queryKey = `__q:${queryText.slice(0, 200)}`;
      const needQueryEmbed = !this.vectorCache.has(queryKey);
      if (needQueryEmbed) {
        textsToEmbed.unshift(queryText);
      }

      if (textsToEmbed.length > 0) {
        const embeddings = await this.embedFn(textsToEmbed);
        let idx = 0;
        if (needQueryEmbed && idx < embeddings.length) {
          this.vectorCache.set(queryKey, embeddings[idx++]);
        }
        for (const itemIdx of itemIndicesNeedingEmbed) {
          if (idx >= embeddings.length) break;
          const item = items[itemIdx];
          const vec = embeddings[idx++];
          this.vectorCache.set(`${item.id}:${item.ts}`, vec);
          item.embedding = vec;
        }
      }

      const qVec = this.vectorCache.get(queryKey);
      if (!qVec) return this.query(items, queryText, limit);

      const threshold = vscode.workspace.getConfiguration().get<number>("myAi.memory.minSemanticScore", 0.11);
      const ranked = items.map((item) => {
        const iVec = this.vectorCache.get(`${item.id}:${item.ts}`) || item.embedding;
        const similarity = iVec ? cosine(qVec, iVec) : 0;
        const ageMs = Date.now() - item.ts;
        const recency = ageMs < 1000 * 60 * 60 * 24 * 3 ? 0.06 : ageMs < 1000 * 60 * 60 * 24 * 14 ? 0.03 : 0.01;
        return { item, score: similarity + recency };
      });

      return ranked
        .filter((r) => r.score >= threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((r) => r.item);
    } catch {
      return this.query(items, queryText, limit);
    }
  }
}
