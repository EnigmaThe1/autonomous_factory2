import { AgentRole } from "../types";

export function chooseProviderForRole(
  role: AgentRole,
  providerMapRaw: string,
  knownProviders: string[],
  fallbackProvider: string
): string {
  const raw = providerMapRaw.trim();
  if (raw) {
    const pairs = raw.split(",").map((p) => p.trim()).filter(Boolean);
    for (const pair of pairs) {
      const [lhs, rhs] = pair.split(":").map((x) => x.trim());
      if (lhs === role && rhs && knownProviders.includes(rhs)) return rhs;
    }
  }
  return fallbackProvider;
}
