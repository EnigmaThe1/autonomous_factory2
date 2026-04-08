import type { Mission } from "../../types";
import type { MissionStore } from "../MissionStore";
import type { ImplementerHardStopGateResult } from "../requiredImplementerHardStopGate";

/** Dedupe `saveEvent` when implementer hardStopClass contract is violated. */
export class MissionOrchestratorHardStopTelemetry {
  private readonly lastMalformedHardStopEventSig = new Map<string, string>();

  constructor(private readonly store: MissionStore) {}

  private malformedHardStopEventSignature(mission: Mission, gate: ImplementerHardStopGateResult): string {
    const impl = mission.queue.filter(
      (w) =>
        w.role === "implementer" &&
        (w.status === "blocked" || w.status === "failed") &&
        w.requiredForCompletion !== false
    );
    const kind = gate.malformed ?? "ok";
    return `${kind}:${impl
      .map((w) => `${w.id}:${w.status}:${w.hardStopClass ?? "∅"}`)
      .sort()
      .join("|")}`;
  }

  async noteMalformedImplementerHardStopEvent(
    missionId: string,
    mission: Mission,
    gate: ImplementerHardStopGateResult
  ): Promise<void> {
    if (!gate.malformed) {
      this.lastMalformedHardStopEventSig.delete(missionId);
      return;
    }
    const sig = this.malformedHardStopEventSignature(mission, gate);
    if (this.lastMalformedHardStopEventSig.get(missionId) === sig) return;
    this.lastMalformedHardStopEventSig.set(missionId, sig);
    const message =
      gate.malformed === "missing_hard_stop_class"
        ? "Invariant: required implementer work is blocked or failed but hardStopClass is missing (contract violation). Downstream gating uses safe unknown handling; repair the queue or discard corrupt missions."
        : "Invariant: required implementer work has an invalid hardStopClass value (contract violation). Downstream gating uses safe unknown handling; repair the queue or discard corrupt missions.";
    await this.store.saveEvent(missionId, {
      level: "error",
      source: "orchestrator",
      message
    });
  }
}
