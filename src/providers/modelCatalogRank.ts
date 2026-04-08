/**
 * Latest-first ranking for provider model catalogs using id semantics and optional API metadata.
 * Does not embed a canonical "current models" list — scores are heuristic from strings + timestamps.
 */

export const MODEL_CATALOG_SHORTLIST_MAX = 15;

export type RankCatalogOpts = {
  createdById?: Record<string, number>;
  /** Preserve API ordering bias (e.g. Anthropic lists newest first). */
  apiListOrder?: string[];
};

/** Full catalog sorted newest/relevant-first, plus a bounded shortlist for the UI. */
export function rankFullAndShortlist(providerId: string, ids: string[], opts?: RankCatalogOpts): { modelsAll: string[]; displayShortlist: string[] } {
  const uniq = [...new Set(ids.map((x) => x.trim()).filter(Boolean))];
  if (uniq.length === 0) return { modelsAll: [], displayShortlist: [] };

  const orderIdx = new Map<string, number>();
  if (opts?.apiListOrder?.length) {
    opts.apiListOrder.forEach((id, i) => orderIdx.set(id, i));
  }

  const scored = uniq.map((id) => ({
    id,
    score: baseScore(providerId, id, opts?.createdById?.[id], orderIdx.get(id))
  }));

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (providerId === "openai" || providerId === "openai-compat") {
      const ca = opts?.createdById?.[a.id];
      const cb = opts?.createdById?.[b.id];
      if (ca != null && cb != null && ca !== cb) return cb - ca;
    }
    const oa = orderIdx.get(a.id) ?? 1e9;
    const ob = orderIdx.get(b.id) ?? 1e9;
    if (oa !== ob) return oa - ob;
    return a.id.localeCompare(b.id);
  });

  const modelsAll = scored.map((r) => r.id);
  return {
    modelsAll,
    displayShortlist: modelsAll.slice(0, MODEL_CATALOG_SHORTLIST_MAX)
  };
}

function baseScore(providerId: string, id: string, created?: number, listIndex?: number): number {
  const lower = id.toLowerCase();
  let s = 0;

  if (typeof created === "number" && Number.isFinite(created)) {
    // OpenAI: unix `created` is applied in sort tie-breaks only, so family tier is not overridden by a saturated score.
    if (providerId !== "openai" && providerId !== "openai-compat") {
      s += Math.min(created / 1e6, 500);
    }
  }
  if (typeof listIndex === "number" && listIndex < 500) {
    s += (500 - listIndex) * 0.5;
  }

  if (providerId === "openai" || providerId === "openai-compat") {
    const specialist = /embedding|whisper|tts|audio|realtime|transcribe|moderation|dall-e|davinci|ada|babbage|curie|web-search|search-api|computer-use|computer_use/.test(
      lower
    );
    if (specialist) {
      s -= 220;
    } else {
      // Single generation tier (do not stack — previously gpt-4-turbo matched both +80 and ^gpt-4-, beating gpt-5).
      if (/^gpt-5|gpt-5-/.test(lower)) s += 270;
      else if (/^o4\b|^o3/.test(lower)) s += 255;
      else if (/^o1(-|$|\.)/.test(lower)) s += 230;
      else if (/^chatgpt-4o/.test(lower)) s += 210;
      else if (/gpt-4\.1/.test(lower)) s += 185;
      else if (/gpt-4o/.test(lower)) s += 175;
      else if (/gpt-4-turbo/.test(lower)) s += 165;
      else if (/^gpt-4-|^gpt-4$/.test(lower)) s += 120;
      else if (/gpt-3\.5|gpt-35/.test(lower)) s += 65;
      else if (/^gpt-|^chatgpt-|\bo[0-9]/.test(lower)) s += 48;
    }
    if (/instruct|preview-202|snapshot/.test(lower)) s -= 14;
    // Intentionally no large id-date bonus: dated GPT-4 snapshots must not outrank GPT-5 on string date alone.
    // Within-tier recency uses OpenAI `created` in the sort tie-break when scores match.
  } else if (providerId === "gemini") {
    if (/embedding|text-embedding|gemma-/.test(lower)) {
      s -= 150;
    } else {
      const v = parseGeminiMajorMinor(lower);
      if (v) {
        // Single monotonic score: 3.1 > 3.0 > 2.5 > 2.0 > 1.5 (do not stack legacy +40/+25 bumps — those made 2.5 beat 3.0).
        s += v.major * 1000 + v.minor * 80;
      } else if (
        /\bgemini-(?:pro|flash)-latest\b/.test(lower) ||
        /\bgemini-1\.0\b/.test(lower) ||
        /^gemini-pro$/i.test(lower.trim())
      ) {
        s += 380;
      } else if (/\bgemini/i.test(lower)) {
        s += 520;
      }
      if (/image|imagen|tts|text-to-speech|audio|live|robotics|aqa|deep-research/.test(lower)) s -= 55;
      if (/\b(preview|experimental)\b/i.test(lower)) s -= 22;
      if (/deprecated|legacy|\b001\b|\b002\b/.test(lower)) s -= 18;
    }
  } else if (providerId === "ollama") {
    if (/embed|embedding|bge|nomic|e5-|mxbai|minilm|snowflake|multilingual-e5|instructor-xl|gte-large|rerank|codebert|splade/.test(lower)) {
      s -= 140;
    }
    if (
      /llama3|llama-3|qwen2|qwen3|mixtral|mistral|gemma2|gemma-2|phi3|phi-4|deepseek|command-r|yi-|internlm|vicuna|orca|neural-chat|codellama|starcoder/.test(
        lower
      )
    ) {
      s += 48;
    }
    if (/vision|vl-|mmproj|multimodal/.test(lower)) s += 12;
    if (/\b70b|\b32b|\b27b|\b8x7b\b/i.test(lower)) s += 6;
    s += 22;
  } else if (providerId === "vscode-lm") {
    s += 20;
  } else if (providerId === "anthropic") {
    if (/claude-opus-4|claude-4-opus/.test(lower)) s += 130;
    if (/claude-sonnet-4|claude-4-sonnet/.test(lower)) s += 115;
    if (/claude-haiku-4/.test(lower)) s += 100;
    if (/claude-3-5-opus|claude-3-5-sonnet|claude-3-5-haiku/.test(lower)) s += 90;
    if (/claude-3-opus|claude-3-sonnet|claude-3-haiku/.test(lower)) s += 50;
    if (/claude-2|claude-instant/.test(lower)) s += 10;
    const d = lower.match(/(20\d{2})[-_]?(0[1-9]|1[0-2])[-_]?(0[1-9]|[12]\d|3[01])/);
    if (d) s += 30;
  } else {
    s += 50;
  }

  return s;
}

/** Parse Gemini API-style ids for version-aware ranking (not used for API calls). */
function parseGeminiMajorMinor(lower: string): { major: number; minor: number } | null {
  const dotted = lower.match(/\bgemini-(\d+)\.(\d+)(?:\b|[._-])/);
  if (dotted) {
    return { major: parseInt(dotted[1]!, 10), minor: parseInt(dotted[2]!, 10) };
  }
  const dashed = lower.match(/\bgemini-(\d+)-(\d+)(?:\b|[._-])/);
  if (dashed) {
    return { major: parseInt(dashed[1]!, 10), minor: parseInt(dashed[2]!, 10) };
  }
  const majorOnly = lower.match(/\bgemini-(\d+)-[a-z]/);
  if (majorOnly) {
    const major = parseInt(majorOnly[1]!, 10);
    if (major >= 1 && major <= 9) return { major, minor: 0 };
  }
  return null;
}
