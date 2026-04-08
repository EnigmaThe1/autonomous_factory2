/** Maps sidebar/provider id → `myAi.models.<suffix>` configuration key suffix (camelCase). */
const PROVIDER_ID_TO_MODEL_SUFFIX: Record<string, string> = {
  openai: "openai",
  ollama: "ollama",
  anthropic: "anthropic",
  gemini: "gemini",
  "openai-compat": "openaiCompat",
  "vscode-lm": "vscodeLm"
};

/** When no per-provider setting exists, use these (not the legacy global default). */
export const BUILTIN_FALLBACK_MODEL: Record<string, string> = {
  openai: "gpt-4.1-mini",
  ollama: "llama3.1",
  anthropic: "claude-sonnet-4-6",
  gemini: "gemini-1.5-flash",
  "openai-compat": "Qwen/Qwen2.5-7B-Instruct",
  "vscode-lm": ""
};

/** UI model-picker suggestions only — not authoritative server-side catalog. */
export const PROVIDER_MODEL_PRESETS: Record<string, string[]> = {
  openai: ["gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini", "o3-mini"],
  ollama: ["llama3.1", "llama3.2", "mistral", "codellama", "deepseek-coder"],
  anthropic: [
    "claude-sonnet-4-6",
    "claude-opus-4-6",
    "claude-haiku-4-5",
    "claude-sonnet-4-5-20250929",
    "claude-3-5-haiku-20241022"
  ],
  /** Fallback when `models.list` fails — live catalog comes from the Gemini API after Refresh. */
  gemini: ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash"],
  "openai-compat": ["Qwen/Qwen2.5-7B-Instruct", "meta-llama/Llama-3.1-8B-Instruct", "mistralai/Mistral-7B-Instruct-v0.2"],
  "vscode-lm": []
};

export function modelsConfigKeyForProvider(providerId: string): string | undefined {
  const suffix = PROVIDER_ID_TO_MODEL_SUFFIX[providerId];
  if (!suffix) return undefined;
  return `myAi.models.${suffix}`;
}

/**
 * Resolve the model string sent to a provider.
 * Order: explicit → myAi.models.<provider> → built-in fallback → legacy myAi.defaultModel.
 */
export function resolveModelForProvider(
  providerId: string,
  explicitModel: string | undefined,
  get: (key: string, defaultValue?: unknown) => unknown
): string {
  const trimmed = explicitModel?.trim();
  if (trimmed) return trimmed;

  const prop = modelsConfigKeyForProvider(providerId);
  if (prop) {
    const configured = get(prop, undefined);
    if (typeof configured === "string" && configured.trim()) return configured.trim();
  }

  const builtIn = BUILTIN_FALLBACK_MODEL[providerId];
  if (builtIn !== undefined) return builtIn;

  const legacy = get("myAi.defaultModel", "llama3.1");
  return typeof legacy === "string" && legacy.trim() ? legacy : "llama3.1";
}
