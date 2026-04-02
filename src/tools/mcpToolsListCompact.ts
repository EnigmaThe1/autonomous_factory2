import type { McpToolDescriptor } from "../types";
import { trimText } from "../util";

const SENTINEL_SERVER = "__myAi__";
const SENTINEL_NAME = "list_budget";

function jsonLen(items: McpToolDescriptor[]): number {
  return JSON.stringify(items).length;
}

const MAX_PROP_KEYS = 36;
const MAX_KEY_LEN = 64;

/**
 * Best-effort: top-level keys from JSON Schema `properties` (MCP tools/list shape).
 */
export function extractJsonSchemaPropertyKeys(schema: unknown): string[] | undefined {
  if (!schema || typeof schema !== "object") return undefined;
  const o = schema as Record<string, unknown>;
  const props = o.properties;
  if (!props || typeof props !== "object") return undefined;
  const keys = Object.keys(props as Record<string, unknown>)
    .map((k) => trimText(k, MAX_KEY_LEN))
    .filter(Boolean)
    .slice(0, MAX_PROP_KEYS);
  return keys.length ? keys : undefined;
}

function slimDescriptor(t: McpToolDescriptor): McpToolDescriptor {
  const inputPropertyNames = extractJsonSchemaPropertyKeys(t.inputSchema);
  const base: McpToolDescriptor = {
    server: t.server,
    name: t.name,
    description: t.description ? trimText(t.description, 420) : undefined,
    sessionState: t.sessionState
  };
  if (inputPropertyNames?.length) {
    base.inputPropertyNames = inputPropertyNames;
  }
  return base;
}

/**
 * When `maxChars` > 0: drop `inputSchema`, trim descriptions, add `inputPropertyNames` when
 * derivable from schema, and drop tools from the end until `JSON.stringify` fits in `maxChars`.
 * Appends a sentinel row if anything was removed.
 * When `maxChars` <= 0: shallow copy of `tools` unchanged (full MCP descriptors).
 */
export function compactMcpToolDescriptors(tools: McpToolDescriptor[], maxChars: number): McpToolDescriptor[] {
  if (maxChars <= 0) {
    return tools.map((t) => ({ ...t }));
  }
  const slim: McpToolDescriptor[] = tools.map((t) => slimDescriptor(t));

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
