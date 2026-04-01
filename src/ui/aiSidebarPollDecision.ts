/**
 * Pure poll-routing decision from baseline axis equality (no I/O).
 * Ordering and outcomes mirror `AiSidebarProvider.maybePollDashboardRefresh` branches.
 */
export type PollDashboardRoutePlan =
  | { kind: "auxiliary_section" }
  | { kind: "global_memory_section" }
  | { kind: "missions_section"; reason: "mission_baseline_only_drift" }
  | { kind: "provider_chrome_section"; reason: "poll_baseline_provider_only_drift" }
  | { kind: "multi_section"; reason: "mission_and_global_memory_drift"; sections: ["missions", "globalMemory"] }
  | { kind: "multi_section"; reason: "mission_and_provider_drift"; sections: ["providerChrome", "missions"] }
  | { kind: "multi_section"; reason: "global_memory_and_provider_drift"; sections: ["globalMemory", "providerChrome"] }
  | {
      kind: "multi_section";
      reason: "mission_global_memory_and_provider_drift";
      sections: ["providerChrome", "missions", "globalMemory"];
    }
  | {
      kind: "full_refresh";
      reason: "poll_router_unreachable_axis_combination";
      missionOk: boolean;
      memOk: boolean;
      providerOk: boolean;
    };

export function decidePollDashboardRoute(missionOk: boolean, memOk: boolean, providerOk: boolean): PollDashboardRoutePlan {
  if (missionOk && memOk && providerOk) return { kind: "auxiliary_section" };
  if (missionOk && providerOk && !memOk) return { kind: "global_memory_section" };
  if (!missionOk && providerOk && memOk) return { kind: "missions_section", reason: "mission_baseline_only_drift" };
  if (missionOk && memOk && !providerOk) return { kind: "provider_chrome_section", reason: "poll_baseline_provider_only_drift" };
  if (!missionOk && providerOk && !memOk) {
    return { kind: "multi_section", reason: "mission_and_global_memory_drift", sections: ["missions", "globalMemory"] };
  }
  if (!missionOk && memOk && !providerOk) {
    return { kind: "multi_section", reason: "mission_and_provider_drift", sections: ["providerChrome", "missions"] };
  }
  if (missionOk && !memOk && !providerOk) {
    return { kind: "multi_section", reason: "global_memory_and_provider_drift", sections: ["globalMemory", "providerChrome"] };
  }
  if (!missionOk && !memOk && !providerOk) {
    return {
      kind: "multi_section",
      reason: "mission_global_memory_and_provider_drift",
      sections: ["providerChrome", "missions", "globalMemory"]
    };
  }
  return {
    kind: "full_refresh",
    reason: "poll_router_unreachable_axis_combination",
    missionOk,
    memOk,
    providerOk
  };
}
