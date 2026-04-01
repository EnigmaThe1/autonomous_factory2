import type { Mission } from "../types";
import type { McpOnboardingState } from "../tools/mcpStarterConfig";
import type { ProviderCredentialStatus, ProviderLiveModelEntry, SidebarSnapshot } from "./protocol";

/** Fingerprint visible mission rows + archive counts; `includeArchived` must match dashboard filter. */
export function missionVisibleListFingerprint(
  missions: Mission[],
  allMissions: Mission[],
  includeArchived: boolean
): string {
  const archivedCount = allMissions.filter((m) => !!m.archivedAt).length;
  const rows = missions
    .map((m) => {
      const ev = m.events || [];
      const lastEvId = ev.length ? ev[ev.length - 1]!.id : "";
      const pend = (m.approvals || [])
        .filter((a) => a.status === "pending")
        .map((a) => a.id)
        .sort()
        .join(",");
      const q = m.queue || [];
      return `${m.id}:${m.updatedAt}:${m.currentStep}:${q.length}:${ev.length}:${lastEvId}:${pend}`;
    })
    .join(";");
  return `${includeArchived ? 1 : 0}|${allMissions.length}|${archivedCount}|${rows}`;
}

export function mcpAuxiliaryFingerprintFromSlice(slice: {
  mcpOnboarding: McpOnboardingState;
  mcpToolCount: number;
  mcpSessionCount: number;
}): string {
  const o = slice.mcpOnboarding;
  return `${slice.mcpToolCount}|${slice.mcpSessionCount}|${o.status}|${o.configuredPath}|${o.resolvedAbsolutePath ?? ""}|${o.hint}`;
}

export function mcpAuxiliaryFingerprintFromSnapshot(snap: SidebarSnapshot): string {
  const o = snap.mcpOnboarding;
  return `${snap.tools.mcpToolCount}|${snap.tools.mcpSessionCount}|${o.status}|${o.configuredPath}|${o.resolvedAbsolutePath ?? ""}|${o.hint}`;
}

/** Fingerprint for the global-memory head (first 10); used in poll baseline and sectional invalidation. */
export function globalMemoryHeadFingerprint(items: SidebarSnapshot["globalMemoryRecent"]): string {
  return items.map((m) => `${m.id}:${m.ts}`).join(",");
}

export function stableSortedJson(obj: Record<string, string>): string {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

export function providerChromeFingerprintPayload(parts: {
  defaultProvider: string;
  defaultModel: string;
  resolvedDefaultModel: string;
  providerCredentialStatus: ProviderCredentialStatus[];
  providerBaseUrls: Record<string, string>;
  providerSavedModels: Record<string, string>;
  providerLiveModelCatalog: Record<string, ProviderLiveModelEntry>;
  lastProviderTest?: SidebarSnapshot["lastProviderTest"];
  providerHealth?: Record<string, { ok: boolean; checkedAt: number }>;
}): string {
  const cred = parts.providerCredentialStatus
    .map((c) => `${c.id}:${c.needsApiKey ? 1 : 0}:${c.configured ? 1 : 0}`)
    .join("|");
  const cat = Object.keys(parts.providerLiveModelCatalog)
    .sort()
    .map((k) => {
      const e = parts.providerLiveModelCatalog[k]!;
      return `${k}:${e.at}:${e.source}:${e.models.length}:${e.modelsDisplay?.length ?? 0}`;
    })
    .join(";");
  const test = parts.lastProviderTest
    ? `${parts.lastProviderTest.providerId}:${parts.lastProviderTest.at}:${parts.lastProviderTest.ok ? 1 : 0}`
    : "";
  const health = parts.providerHealth
    ? Object.keys(parts.providerHealth)
        .sort()
        .map((k) => `${k}:${parts.providerHealth![k].ok ? 1 : 0}:${parts.providerHealth![k].checkedAt}`)
        .join(";")
    : "";
  return `${parts.defaultProvider}|${parts.defaultModel}|${parts.resolvedDefaultModel}|${cred}|${stableSortedJson(parts.providerBaseUrls)}|${stableSortedJson(parts.providerSavedModels)}|${cat}|${test}|${health}`;
}

/** Stable fingerprint for provider/settings chrome from a posted snapshot. */
export function providerChromeFpFromSnapshot(snapshot: SidebarSnapshot): string {
  return providerChromeFingerprintPayload({
    defaultProvider: snapshot.defaultProvider,
    defaultModel: snapshot.defaultModel,
    resolvedDefaultModel: snapshot.resolvedDefaultModel,
    providerCredentialStatus: snapshot.providerCredentialStatus,
    providerBaseUrls: snapshot.providerBaseUrls,
    providerSavedModels: snapshot.providerSavedModels,
    providerLiveModelCatalog: snapshot.providerLiveModelCatalog,
    lastProviderTest: snapshot.lastProviderTest,
    providerHealth: snapshot.providerHealth
  });
}

/** Concatenated stable fingerprints for major sidebar axes (missions / memory / provider / MCP aux). */
export function materialFingerprintCombined(
  missionFp: string,
  memFp: string,
  providerFp: string,
  auxFp: string
): string {
  return `${missionFp}§${memFp}§${providerFp}§${auxFp}`;
}
