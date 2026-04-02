/** SecretStorage key for Brave Search API when `myAi.webSearch.provider` is `brave`. */
export const BRAVE_WEB_SEARCH_SECRET_KEY = "myAi.webSearch.braveApiKey";

/** SecretStorage keys for API keys (never store in workspace settings). */
export const PROVIDER_SECRET_KEYS: Partial<Record<string, string>> = {
  openai: "myAi.openai.apiKey",
  anthropic: "myAi.anthropic.apiKey",
  gemini: "myAi.gemini.apiKey",
  "openai-compat": "myAi.openaiCompat.apiKey"
};

export function providerNeedsApiKey(providerId: string): boolean {
  return !!PROVIDER_SECRET_KEYS[providerId];
}

export function secretKeyForProvider(providerId: string): string | undefined {
  return PROVIDER_SECRET_KEYS[providerId];
}

/** Workspace settings keys for HTTP roots (non-secret). */
export function baseUrlSettingKey(providerId: string): string | undefined {
  switch (providerId) {
    case "openai":
      return "myAi.openai.baseUrl";
    case "ollama":
      return "myAi.ollama.baseUrl";
    case "anthropic":
      return "myAi.anthropic.baseUrl";
    case "gemini":
      return "myAi.gemini.baseUrl";
    case "openai-compat":
      return "myAi.openaiCompat.baseUrl";
    default:
      return undefined;
  }
}

export function defaultBaseUrl(providerId: string): string | undefined {
  switch (providerId) {
    case "openai":
      return "https://api.openai.com/v1";
    case "ollama":
      return "http://127.0.0.1:11434";
    case "anthropic":
      return "https://api.anthropic.com/v1";
    case "gemini":
      return "https://generativelanguage.googleapis.com";
    case "openai-compat":
      return "http://127.0.0.1:8000/v1";
    default:
      return undefined;
  }
}
