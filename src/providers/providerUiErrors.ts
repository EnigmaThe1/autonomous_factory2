import { explainHttpStatusForProviders } from "./providerHttpErrors";

/** If `message` contains a single `HTTP NNN` and no embedded explanation yet, append a short hint (legacy errors). */
function appendHttpExplainIfMissing(message: string): string {
  const matches = [...message.matchAll(/\bHTTP (\d{3})\b/g)];
  if (matches.length !== 1) return message;
  const status = Number(matches[0]![1]);
  if (!Number.isFinite(status)) return message;
  const hint = explainHttpStatusForProviders(status);
  const hintPrefix = hint.slice(0, Math.min(48, hint.length));
  if (message.includes(hintPrefix)) return message;
  return `${message}\n\n**What this usually means:** ${hint}`;
}

export function formatProviderUserError(err: unknown, providerId: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  const credsHint =
    lower.includes("missing api key") ||
    lower.includes("missing secret") ||
    lower.includes("not configured") ||
    (lower.includes("api key") && lower.includes("configure"));
  if (credsHint) {
    return `**Configure this provider** (${providerId}): ${raw}\n\nOpen the **Providers** tab in this sidebar, save credentials (stored in VS Code secure storage), pick a model, then try again.`;
  }
  const transportHint =
    lower.includes("request failed") ||
    lower.includes("unreachable") ||
    lower.includes("http ") ||
    lower.includes("network") ||
    lower.includes("fetch") ||
    lower.includes("econnrefused");
  if (transportHint) {
    return appendHttpExplainIfMissing(
      `${raw}\n\nIf this persists, use the **Providers** tab to verify base URL, model id, and credentials.`
    );
  }
  return appendHttpExplainIfMissing(raw);
}
