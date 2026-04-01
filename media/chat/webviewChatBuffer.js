/** Keep in sync with `CHAT_SIDEBAR_MAX_CHARS` in `src/ui/webviewStabilityConstants.ts`. */
export const CHAT_SIDEBAR_MAX_CHARS = 120000;

/** Maximum number of completed turn pairs to keep in webview conversation history. */
export const CHAT_MAX_HISTORY_TURNS = 50;

/** Tail-only retention for sidebar chat (streaming); avoids unbounded mdToHtml cost. */
export function trimSidebarChatBuffer(text, maxChars = CHAT_SIDEBAR_MAX_CHARS) {
  if (text == null || text === "") return "";
  if (text.length <= maxChars) return text;
  return text.slice(-maxChars);
}

/**
 * Manages the conversation history array.
 * Each entry is { role: "user"|"assistant", content: string }.
 */
export function createChatHistory(maxTurns = CHAT_MAX_HISTORY_TURNS) {
  const entries = [];

  return {
    entries,
    pushUser(content) {
      entries.push({ role: "user", content });
    },
    pushAssistant(content) {
      entries.push({ role: "assistant", content });
      while (entries.length > maxTurns * 2) entries.shift();
    },
    clear() {
      entries.length = 0;
    },
    isEmpty() {
      return entries.length === 0;
    }
  };
}
