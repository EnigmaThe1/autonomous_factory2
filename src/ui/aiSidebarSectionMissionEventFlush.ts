import * as fp from "./aiSidebarFingerprints";
import { missionAllAndVisibleForFingerprint } from "./aiSidebarSnapshotMisc";
import type { AiSidebarSectionPublishHost } from "./aiSidebarSectionPublishHost";
import { postMissionDashboardSnapshotImmediateForHost } from "./aiSidebarSectionMissionMerge";

/** True when live visible-mission fingerprint matches the last posted missions list (same archive/total meta). */
export function shouldSkipMissionSectionEventPublishForHost(host: AiSidebarSectionPublishHost): boolean {
  const last = host.getLastPostedSnapshot();
  if (!last) return true;
  const { allMissions: all, missions: visible } = missionAllAndVisibleForFingerprint(
    host.missionStore,
    host.getIncludeArchivedMissions()
  );
  const fpLive = fp.missionVisibleListFingerprint(visible, all, host.getIncludeArchivedMissions());
  const fpPosted = fp.missionVisibleListFingerprint(last.missions, all, host.getIncludeArchivedMissions());
  return fpLive === fpPosted;
}

export function flushMissionSectionFromHostTruthEdgeIfNeededForHost(host: AiSidebarSectionPublishHost): void {
  if (!host.getWebviewView()?.webview) return;
  if (!host.getLastPostedSnapshot()) return;
  if (shouldSkipMissionSectionEventPublishForHost(host)) return;
  host.traceLogger.log({
    level: "debug",
    side: "host",
    category: "dashboard",
    event: "mission_section_host_truth_event_publish"
  });
  postMissionDashboardSnapshotImmediateForHost(host, undefined);
}
