import type { McpToolDescriptor } from "../types";
import { trimText } from "../util";

const SENTINEL_SERVER = "__myAi__";
const SENTINEL_NAME = "list_budget";

function jsonLen(items: McpToolDescriptor[]): number {
  return JSON.stringify(items).length;
}

/**
 * When `maxChars` > 0: drop `inputSchema`, trim descriptions, and drop tools from the end until
 * `JSON.stringify` fits in `maxChars`. Appends a sentinel row if anything was removed.
 * When `maxChars` <= 0: shallow copy of `tools` unchanged (full MCP descriptors).
 */
export function compactMcpToolDescriptors(tools: McpToolDescriptor[], maxChars: number): McpToolDescriptor[] {
  if (maxChars <= 0) {
    return tools.map((t) => ({ ...t }));
  }
  const slim: McpToolDescriptor[] = tools.map((t) => ({
    server: t.server,
    name: t.name,
    description: t.description ? trimText(t.description, 420) : undefined,
    sessionState: t.sessionState
  }));

  const sentinel = (omitted: number): McpToolDescriptor => ({
    server: SENTINEL_SERVER,
    name: SENTINEL_NAME,
    description: trimText(
      `${omitted} MCP tool row(s) omitted (myAi.tools.listMcpToolsSummaryMaxChars=${maxChars}). Set to 0 for full list including inputSchema.`,
      500
    ),
    sessionState: "ready"
  });

  const out = [...slim];
  let omitted = 0;

  while (out.length > 0 && jsonLen(out) > maxChars) {
    out.pop();
    omitted += 1;
  }

  if (omitted === 0) {
    return out;
  }

  for (;;) {
    const candidate = [...out, sentinel(omitted)];
    if (jsonLen(candidate) <= maxChars) {
      return candidate;
    }
    if (out.length === 0) {
      return [sentinel(omitted)];
    }
    out.pop();
    omitted += 1;
  }
}
