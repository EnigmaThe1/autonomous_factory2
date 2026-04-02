import type { ExternalToolAdapterDefinition, ExternalToolAdapterPublicSummary } from "../types";

/** Strip `url` and `headers` for agent-facing `listTools` payloads. */
export function toExternalAdapterPublicSummaries(
  adapters: ExternalToolAdapterDefinition[]
): ExternalToolAdapterPublicSummary[] {
  return adapters.map((a) => ({
    name: a.name,
    type: "http",
    method: a.method,
    description: a.description,
    mutating: a.mutating
  }));
}
