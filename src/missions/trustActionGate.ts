import type { Mission, ToolCall } from "../types";
import { missionHasVerifiedClaimBasis } from "./claimTrust";

/** Subset of `vscode.WorkspaceConfiguration` for testability without importing vscode. */
export type TrustGateConfigReader = { get<T>(section: string, defaultValue?: T): T };

const DEPENDENCY_COMMAND_RE =
  /\b(npm\s+(install|ci|update|i)\b|yarn\s+(add|install|global\s+add)|pnpm\s+(add|install|update)|pip3?\s+install|poetry\s+add|cargo\s+add|apt-get\b|dnf\s+install|yum\s+install|brew\s+(install|upgrade))\b/i;

export function isDependencyStyleShellCommand(command: string): boolean {
  return DEPENDENCY_COMMAND_RE.test(command || "");
}

export function isLargeApplyPatch(search: string, replace: string, minTotalChars: number): boolean {
  return (search?.length || 0) + (replace?.length || 0) >= minTotalChars;
}

export interface TrustGateEvaluation {
  requiresApproval: true;
  summary: string;
  title: string;
  details: string;
}

/**
 * When trust gates are enabled, high-impact shell edits and very large patches require either
 * operator approval or a recent verified claim in mission memory.
 */
export function evaluateTrustActionGate(args: {
  cfg: TrustGateConfigReader;
  mission: Mission | undefined;
  call: ToolCall;
  commandText?: string;
  applyPatchSearch?: string;
  applyPatchReplace?: string;
  approved: boolean;
}): TrustGateEvaluation | undefined {
  const { cfg, mission, call, commandText, applyPatchSearch, applyPatchReplace, approved } = args;
  if (approved) return undefined;
  if (!cfg.get<boolean>("myAi.missions.trustGates.enabled", false)) return undefined;
  if (!mission) return undefined;
  if (Boolean(call.args?.__trustBypass)) return undefined;

  const basis = missionHasVerifiedClaimBasis(mission.memory);

  if (commandText && isDependencyStyleShellCommand(commandText)) {
    if (!basis) {
      return {
        requiresApproval: true,
        summary: "Trust gate: dependency or package-manager style command requires approval or a verified MEMORY claim.",
        title: "Trust gate: dependency / package command",
        details: [
          "This command looks like it can change dependencies or system packages.",
          "Either approve explicitly, add __trustBypass: true in tests only, or record a verified claim first, e.g.",
          "MEMORY:finding:claim_verified_web- <fact from research> or MEMORY:finding:claim_verified_tool- <fact from a tool>.",
          "",
          "Command:",
          commandText.slice(0, 2000)
        ].join("\n")
      };
    }
  }

  const minChars = cfg.get<number>("myAi.missions.trustGates.largePatchMinChars", 8000);
  if (applyPatchSearch !== undefined && applyPatchReplace !== undefined && isLargeApplyPatch(applyPatchSearch, applyPatchReplace, minChars)) {
    const nFiles = mission.filesModified?.length || 0;
    const manyThreshold = Math.max(1, cfg.get<number>("myAi.missions.trustGates.manyModifiedFilesThreshold", 12));
    if (nFiles >= manyThreshold && !basis) {
      return {
        requiresApproval: true,
        summary: "Trust gate: large patch after many file touches requires approval or a verified claim.",
        title: "Trust gate: broad change-set patch",
        details: [
          `filesModified=${nFiles} (threshold ${manyThreshold}); patch text length ${applyPatchSearch.length + applyPatchReplace.length} (min ${minChars}).`,
          "Approve explicitly or record MEMORY with claim:verified_* tied to review/tool evidence."
        ].join("\n")
      };
    }
  }

  return undefined;
}
