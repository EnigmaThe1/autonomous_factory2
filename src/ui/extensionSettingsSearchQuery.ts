/** Default VS Code Settings UI search when the webview sends no query or an invalid one. */
export const DEFAULT_EXTENSION_SETTINGS_SEARCH = "myAi";

/** Settings search string that surfaces all `myAi.missions.*` keys in the UI. */
export const MISSION_SETTINGS_SEARCH_QUERY = "myAi.missions";

/** Only allow settings keys under our extension namespace (Settings UI search string). */
const EXTENSION_SETTINGS_SEARCH_SAFE = /^myAi(\.[a-zA-Z][a-zA-Z0-9_]*){0,16}$/;

export function sanitizeExtensionSettingsSearchQuery(input: string | undefined): string {
  const raw = typeof input === "string" ? input.trim() : "";
  return raw && EXTENSION_SETTINGS_SEARCH_SAFE.test(raw) ? raw : DEFAULT_EXTENSION_SETTINGS_SEARCH;
}
