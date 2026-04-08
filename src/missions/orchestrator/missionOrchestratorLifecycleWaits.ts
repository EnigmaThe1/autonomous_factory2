import type { MissionStore } from "../MissionStore";
import { isMissionTerminalLifecycleStatus } from "../LifecycleRules";

/**
 * While the run loop is idle, wait for `store` to show a terminal lifecycle status, driven by
 * `MissionStore.subscribeMissionMutation` (no fixed-interval polling).
 */
export function waitForMissionTerminalLifecycleWhileIdle(
  store: MissionStore,
  missionId: string,
  deadline: number,
  originalTimeoutMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    let unsub: (() => void) | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      unsub?.();
      unsub = undefined;
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
    };

    const tryFinish = (): boolean => {
      const m = store.get(missionId);
      if (!m) {
        cleanup();
        reject(new Error(`Mission not found: ${missionId}`));
        return true;
      }
      if (isMissionTerminalLifecycleStatus(m.status)) {
        cleanup();
        resolve();
        return true;
      }
      return false;
    };

    if (tryFinish()) return;

    unsub = store.subscribeMissionMutation(missionId, () => {
      tryFinish();
    });

    if (tryFinish()) return;

    const rem = deadline - Date.now();
    if (rem <= 0) {
      cleanup();
      const m = store.get(missionId);
      reject(
        new Error(
          `whenMissionReachesTerminalLifecycleStatus: timeout after ${originalTimeoutMs}ms for mission ${missionId} (status=${m?.status})`
        )
      );
      return;
    }
    timeoutId = setTimeout(() => {
      cleanup();
      const m = store.get(missionId);
      reject(
        new Error(
          `whenMissionReachesTerminalLifecycleStatus: timeout after ${originalTimeoutMs}ms for mission ${missionId} (status=${m?.status})`
        )
      );
    }, rem);
  });
}
