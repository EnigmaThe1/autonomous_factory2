/**
 * Throttled bridge between MissionOrchestrator agent stream callbacks
 * and the sidebar webview, batching rapid token chunks into fewer
 * postMessage calls.
 */
export interface StreamThrottleTarget {
  forwardToWebview(msg:
    | { type: "agentStreamChunk"; missionId: string; workItemId: string; role: string; text: string }
    | { type: "agentStreamDone"; missionId: string; workItemId: string }
  ): void;
}

export function wireAgentStreamThrottle(
  orchestrator: {
    onAgentStreamChunk?: (missionId: string, workItemId: string, role: string, text: string) => void;
    onAgentStreamDone?: (missionId: string, workItemId: string) => void;
  },
  target: StreamThrottleTarget,
  throttleMs = 50
): void {
  let buf = { missionId: "", workItemId: "", role: "", text: "" };
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    if (buf.text) {
      target.forwardToWebview({ type: "agentStreamChunk", ...buf });
      buf = { missionId: "", workItemId: "", role: "", text: "" };
    }
    timer = undefined;
  };

  orchestrator.onAgentStreamChunk = (missionId, workItemId, role, text) => {
    if (buf.workItemId !== workItemId) flush();
    buf = { missionId, workItemId, role, text: buf.text + text };
    if (!timer) timer = setTimeout(flush, throttleMs);
  };

  orchestrator.onAgentStreamDone = (missionId, workItemId) => {
    flush();
    target.forwardToWebview({ type: "agentStreamDone", missionId, workItemId });
  };
}
