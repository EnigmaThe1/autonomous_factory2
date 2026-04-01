import { MemoryItem } from "../types";
import { tokenise } from "../util";

export class MemoryIndex {
  query(items: MemoryItem[], query: string, limit: number): MemoryItem[] {
    const q = new Set(tokenise(query));
    const scored = items.map((item) => {
      const tokens = new Set([...(item.tags || []), ...tokenise(item.text)]);
      let score = 0;
      for (const t of q) {
        if (tokens.has(t)) score += 2;
        if (item.text.toLowerCase().includes(t)) score += 1;
      }
      score += Math.max(0, (item.ts / 1e13));
      return { item, score };
    });

    return scored
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.item);
  }
}
