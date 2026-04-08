/**
 * Operator-facing explanations for HTTP status codes from LLM / embedding providers.
 * Used by chat streams, embeddings, model catalog fetches, and connection tests.
 */

/** Short explanation of what the status usually means (no leading/trailing redundancy). */
export function explainHttpStatusForProviders(status: number): string {
  switch (status) {
    case 400:
      return "Bad request — often an invalid model name, malformed JSON, or a parameter the API rejects. Check the model id and provider settings.";
    case 401:
      return "Unauthorized — API key missing, wrong, or expired. Open the Providers tab and update credentials.";
    case 403:
      return "Forbidden — this key may not access that model or endpoint. Check model access and billing in your provider dashboard.";
    case 404:
      return "Not found — wrong URL path or unknown model id. Verify base URL (Providers) and the configured model name.";
    case 408:
      return "Request timeout reported by the server — try again with a smaller prompt or fewer attachments.";
    case 409:
      return "Conflict — the provider rejected the request state (e.g. resource version). Retry or adjust the request.";
    case 413:
      return "Payload too large — shorten context, reduce file content in the prompt, or raise limits if your host allows it.";
    case 422:
      return "Unprocessable entity — the API understood the request but refused it (validation). Check model and message format.";
    case 429:
      return "Rate limited or quota exceeded — wait before retrying, reduce parallel chats/missions, or check usage and billing. For missions, use Resume when limits ease.";
    case 500:
      return "Internal server error on the provider side — usually temporary. Retry later.";
    case 502:
      return "Bad gateway — often a proxy or edge issue between you and the provider. Retry later.";
    case 503:
      return "Service unavailable — provider overloaded or in maintenance. Retry later.";
    case 504:
      return "Gateway timeout — the upstream service did not respond in time. Try a smaller request or retry.";
    default:
      if (status >= 400 && status < 500) {
        return `Client error (HTTP ${status}) — check credentials, model id, base URL, and request size.`;
      }
      if (status >= 500) {
        return `Server error (HTTP ${status}) — provider or network issue; retry later.`;
      }
      return `Unexpected HTTP ${status} — verify endpoint, credentials, and provider status.`;
  }
}

export interface FormatProviderHttpErrorOpts {
  /** e.g. "Anthropic", "Gemini", "Ollama", "OpenAI-compatible" */
  providerLabel: string;
  /** e.g. "Chat stream", "Embedding request" */
  operation: string;
  status: number;
  /** Shown in parentheses — base URL or path hint */
  endpoint: string;
}

/**
 * Full message for thrown errors in provider `stream` / `embed` paths.
 */
export function formatProviderHttpError(opts: FormatProviderHttpErrorOpts): string {
  const { providerLabel, operation, status, endpoint } = opts;
  return `${providerLabel} ${operation} failed: HTTP ${status} (${endpoint}). ${explainHttpStatusForProviders(status)}`;
}

/**
 * Hint string for model-list fallbacks (non-throwing).
 */
export function formatModelListHttpHint(providerLabel: string, status: number, endpoint: string): string {
  return `${providerLabel} model list: HTTP ${status} at ${endpoint}. ${explainHttpStatusForProviders(status)}`;
}

/**
 * Message for testProviderConnection failures.
 */
export function formatConnectionTestHttpMessage(providerLabel: string, status: number, endpoint: string): string {
  return `${providerLabel} connection check failed: HTTP ${status} (${endpoint}). ${explainHttpStatusForProviders(status)}`;
}
