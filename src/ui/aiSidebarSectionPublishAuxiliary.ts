import * as fp from "./aiSidebarFingerprints";
import { SIDEBAR_BUILTIN_TOOLS } from "./aiSidebarConstants";
import type { SidebarSnapshot } from "./protocol";
import type { AiSidebarSectionPublishHost } from "./aiSidebarSectionPublishHost";

/**
 * Host-only auxiliary section: MCP list/session counts + onboarding state merged into `lastPostedSnapshot`.
 * Does not run provider credential I/O or mission aggregation.
 */
export async function postAuxiliarySectionImmediateForHost(host: AiSidebarSectionPublishHost): Promise<{
  published: boolean;
  usedWarmAuxiliaryCache: boolean;
  auxiliaryPollStableFpNoop?: boolean;
  auxiliaryPollWarmProbeDeduped?: boolean;
  auxiliarySameTickWarmSliceReuse?: boolean;
}> {
  const last = host.getLastPostedSnapshot();
  if (!last) return { published: false, usedWarmAuxiliaryCache: false };
  const sectionBasePublishSeq = last.snapshotPublishSeq ?? 0;
  const prevFp = fp.mcpAuxiliaryFingerprintFromSnapshot(last);
  const now = Date.now();
  const auxiliaryWarmProbe = host.readMcpAuxiliaryWarmCaches(now);
  const stableTry = host.tryAuxiliaryFingerprintFromStableWarmPollCache(auxiliaryWarmProbe);
  const stableFp = stableTry.fingerprint;
  if (stableFp !== undefined && stableFp === prevFp) {
    host.traceLogger.log({
      level: "debug",
      side: "host",
      category: "dashboard",
      event: "auxiliary_section_noop_skip",
      data: {
        reason: "stable_warm_cache_fingerprint_unchanged",
        mcpToolCount: last.tools.mcpToolCount,
        mcpSessionCount: last.tools.mcpSessionCount
      }
    });
    return { published: false, usedWarmAuxiliaryCache: true, auxiliaryPollStableFpNoop: true };
  }
  const { slice, usedWarmCaches, sameTickWarmSliceReuse } = await host.resolveMcpAuxiliarySlice("dashboard_section", {
    reuseAuxiliaryWarmProbe: auxiliaryWarmProbe,
    reuseSameTickWarmSlice: stableTry.sameTickWarmMaterializedSlice
  });
  const nextFp = fp.mcpAuxiliaryFingerprintFromSlice(slice);
  if (nextFp === prevFp) {
    host.traceLogger.log({
      level: "debug",
      side: "host",
      category: "dashboard",
      event: "auxiliary_section_noop_skip",
      data: {
        reason: "slice_unchanged_vs_last_posted",
        mcpToolCount: slice.mcpToolCount,
        mcpSessionCount: slice.mcpSessionCount
      }
    });
    return {
      published: false,
      usedWarmAuxiliaryCache: usedWarmCaches,
      auxiliaryPollWarmProbeDeduped: true,
      auxiliarySameTickWarmSliceReuse: sameTickWarmSliceReuse === true
    };
  }
  const merged: SidebarSnapshot = {
    ...last,
    mcpOnboarding: slice.mcpOnboarding,
    tools: {
      ...last.tools,
      builtinTools: [...SIDEBAR_BUILTIN_TOOLS],
      mcpToolCount: slice.mcpToolCount,
      mcpSessionCount: slice.mcpSessionCount
    }
  };
  const sectionSeq = host.bumpAuxiliarySectionSeq();
  host.traceLogger.log({
    level: "info",
    side: "host",
    category: "dashboard",
    event: "refresh_dashboard_auxiliary_section_post",
    data: {
      sectionSeq,
      sectionBasePublishSeq,
      mcpToolCount: slice.mcpToolCount,
      mcpSessionCount: slice.mcpSessionCount
    }
  });
  host.postMessage({
    type: "snapshotSection",
    section: "auxiliary",
    snapshot: merged,
    sectionSeq,
    sectionBasePublishSeq
  });
  return {
    published: true,
    usedWarmAuxiliaryCache: usedWarmCaches,
    auxiliaryPollWarmProbeDeduped: true,
    auxiliarySameTickWarmSliceReuse: sameTickWarmSliceReuse === true
  };
}

export async function flushAuxiliarySectionFromEventIfNeededForHost(host: AiSidebarSectionPublishHost): Promise<void> {
  if (!host.getWebviewView()?.webview) return;
  const last = host.getLastPostedSnapshot();
  if (!last) return;
  const { slice } = await host.resolveMcpAuxiliarySlice("dashboard_section");
  const nextFp = fp.mcpAuxiliaryFingerprintFromSlice(slice);
  const prevFp = fp.mcpAuxiliaryFingerprintFromSnapshot(last);
  if (nextFp === prevFp) return;
  host.traceLogger.log({
    level: "debug",
    side: "host",
    category: "dashboard",
    event: "auxiliary_section_event_publish",
    data: { mcpToolCount: slice.mcpToolCount, mcpSessionCount: slice.mcpSessionCount }
  });
  await postAuxiliarySectionImmediateForHost(host);
}
