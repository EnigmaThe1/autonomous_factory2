/** Classify JSON content of an MCP config file (no vscode dependency; unit-testable in Node). */
export function classifyMcpConfigJson(text: string): "invalid_json" | "no_servers" | "ready" {
  try {
    const parsed = JSON.parse(text) as { servers?: unknown };
    const servers = Array.isArray(parsed.servers) ? parsed.servers : [];
    return servers.length ? "ready" : "no_servers";
  } catch {
    return "invalid_json";
  }
}
