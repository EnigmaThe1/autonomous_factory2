import type { Mission } from "../types";
import type { MissionStore } from "../missions/MissionStore";
import type { GlobalMemoryStore } from "../memory/GlobalMemoryStore";
import type { SidebarSnapshot } from "./protocol";

export function cloneSnapshotWithoutFastRefreshKind(base: SidebarSnapshot): SidebarSnapshot {
  const { fastRefreshKind: _drop, ...rest } = base;
  return rest as SidebarSnapshot;
}

/**
 * One `MissionStore.list()` (full normalize + sort); `missions` matches `listVisible(includeArchived)`.
 */
export function missionAllAndVisibleForFingerprint(
  missionStore: MissionStore,
  includeArchived: boolean
): { allMissions: Mission[]; missions: Mission[] } {
  const allMissions = missionStore.list();
  const missions = includeArchived ? allMissions : allMissions.filter((m) => !m.archivedAt);
  return { allMissions, missions };
}

/**
 * Authoritative global-memory head slice (recent items for Memory tab global list).
 */
export function buildGlobalMemoryContextHostSlice(globalMemory: GlobalMemoryStore): {
  globalMemoryRecent: SidebarSnapshot["globalMemoryRecent"];
} {
  return {
    globalMemoryRecent: globalMemory
      .list()
      .slice(0, 10)
      .map((item) => ({ id: item.id, ts: item.ts, kind: item.kind, text: item.text }))
  };
}
