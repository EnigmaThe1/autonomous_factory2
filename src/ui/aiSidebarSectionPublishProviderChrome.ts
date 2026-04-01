import { cloneSnapshotWithoutFastRefreshKind } from "./aiSidebarSnapshotMisc";
import type { SidebarSnapshot } from "./protocol";
import type { AiSidebarSectionPublishHost } from "./aiSidebarSectionPublishHost";

/**
 * Provider/settings/credential chrome only: merges the authoritative chrome slice into `lastPostedSnapshot`
 * and posts `snapshotSection` (no `snapshotPublishSeq` bump; guarded by `sectionBasePublishSeq` + `sectionSeq`).
 */
export async function postProviderSettingsChromeSectionImmediateForHost(
  host: AiSidebarSectionPublishHost,
  interactionId: string | undefined,
  traceEvent: string,
  extraTrace?: Record<string, unknown>
): Promise<void> {
  if (!host.getWebviewView()?.webview) return;
  const last = host.getLastPostedSnapshot();
  if (!last) return;
  const sectionBasePublishSeq = last.snapshotPublishSeq ?? 0;
  const { slice } = await host.resolveProviderSettingsChromeHostSlice("provider_section");
  const merged: SidebarSnapshot = {
    ...cloneSnapshotWithoutFastRefreshKind(last),
    ...slice
  };
  const sectionSeq = host.bumpProviderChromeSectionSeq();
  host.traceLogger.log({
    level: "info",
    side: "host",
    category: "dashboard",
    event: traceEvent,
    interactionId,
    data: {
      sectionSeq,
      sectionBasePublishSeq,
      defaultProvider: merged.defaultProvider,
      ...extraTrace
    }
  });
  host.postMessage(
    {
      type: "snapshotSection",
      section: "providerChrome",
      snapshot: merged,
      sectionSeq,
      sectionBasePublishSeq
    },
    { interactionId }
  );
}
