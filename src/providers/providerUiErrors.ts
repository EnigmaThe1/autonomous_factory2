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
    return `${raw}\n\nIf this persists, use the **Providers** tab to verify base URL, model id, and credentials.`;
  }
  return raw;
}
