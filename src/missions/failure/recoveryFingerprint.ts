import { createHash } from "node:crypto";
import type { StructuredFailure } from "./structuredFailureTypes";

export interface RecoveryFingerprintInput {
  missionId: string;
  workItemId: string;
  failure: StructuredFailure;
  /** Queue length + validation state detect meaningful mission state change between attempts. */
  missionQueueLength: number;
  missionValidationState?: string;
}

/**
 * Fingerprint for deduplicating recovery attempts on the same underlying failure.
 * Including queue length / validation state avoids counting a genuinely new mission state as a blind retry of the old failure.
 */
export function computeRecoveryFingerprint(input: RecoveryFingerprintInput): string {
  const payload = {
    m: input.missionId,
    w: input.workItemId,
    d: input.failure.domain,
    c: input.failure.code,
    t: input.failure.tool ?? "",
    msg: input.failure.message.slice(0, 400),
    q: input.missionQueueLength,
    v: input.missionValidationState ?? ""
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32);
}

export function nextRecoveryStreakState(
  previousFingerprint: string | undefined,
  previousStreak: number,
  nextFingerprint: string
): { fingerprint: string; streak: number } {
  if (previousFingerprint === nextFingerprint) {
    return { fingerprint: nextFingerprint, streak: previousStreak + 1 };
  }
  return { fingerprint: nextFingerprint, streak: 1 };
}
