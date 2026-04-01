import type { SidebarSnapshot } from "./protocol";

/**
 * Cheap, allocation-free-ish estimate of dominant snapshot JSON weight for host→webview posts.
 * Used for low-noise instrumentation only (no full JSON.stringify of the whole snapshot).
 */
export function roughWebviewSnapshotPayloadBytes(snap: SidebarSnapshot): number {
  let b = 12_000;
  for (const m of snap.missions || []) {
    b += 280;
    b += (m.events?.length ?? 0) * 90;
    b += (m.memory?.length ?? 0) * 160;
    b += (m.queue?.length ?? 0) * 110;
    b += (m.approvals?.length ?? 0) * 400;
  }
  const f = snap.focusedMission;
  if (f) {
    b += 600;
    b += (f.events?.length ?? 0) * 90;
    b += (f.memory?.length ?? 0) * 160;
    b += (f.queue?.length ?? 0) * 110;
  }
  const cat = snap.providerLiveModelCatalog;
  if (cat) {
    for (const pid of Object.keys(cat)) {
      const e = cat[pid];
      if (!e) continue;
      b += 120 + (e.models?.length ?? 0) * 48 + (e.modelsDisplay?.length ?? 0) * 48;
    }
  }
  b += (snap.pendingApprovals?.length ?? 0) * 2500;
  b += (snap.timeline?.length ?? 0) * 120;
  b += (snap.globalMemoryRecent?.length ?? 0) * 200;
  b += (snap.agentLive?.length ?? 0) * 300;
  return b;
}
