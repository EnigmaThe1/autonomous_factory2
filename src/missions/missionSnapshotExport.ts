import type { Mission, WorkItem } from "../types";
import { findDuplicateQueryResearchContradictions } from "./researchContradiction";

function compactWorkItem(w: WorkItem) {
  return {
    id: w.id,
    title: w.title,
    role: w.role,
    status: w.status,
    requiredForCompletion: w.requiredForCompletion,
    hardStopClass: w.hardStopClass,
    deadLetter: w.deadLetter,
    blueprintStepId: w.blueprintStepId,
    workItemPurpose: w.workItemPurpose,
    dependsOn: w.dependsOn,
    outputPreview: w.output ? String(w.output).slice(0, 400) : undefined
  };
}

/**
 * Single JSON-friendly diagnostic snapshot for operators, support, and tests (P8-T-002).
 */
export function buildMissionDiagnosticSnapshot(mission: Mission): Record<string, unknown> {
  const pendingApprovals = (mission.approvals || []).filter((a) => a.status === "pending");
  const researchContradictions = findDuplicateQueryResearchContradictions(mission.memory || []);

  return {
    schema: "myAi.missionDiagnosticSnapshot/v1",
    exportedAt: new Date().toISOString(),
    mission: {
      id: mission.id,
      title: mission.title,
      status: mission.status,
      blockReasonCode: mission.blockReasonCode,
      blocker: mission.blocker,
      failureReasonCode: mission.failureReasonCode,
      validationState: mission.validationState,
      completionReason: mission.completionReason,
      dryRun: mission.dryRun,
      activeProviderId: mission.activeProviderId,
      activeModel: mission.activeModel,
      routing: mission.routing,
      roundsCompleted: mission.roundsCompleted,
      runtime: mission.runtime,
      filesModified: mission.filesModified,
      blueprintStatus: mission.blueprint?.status,
      blueprintStepCount: mission.blueprint?.steps?.length
    },
    queue: mission.queue.map(compactWorkItem),
    pendingApprovals: pendingApprovals.map((a) => ({
      id: a.id,
      kind: a.kind,
      title: a.title,
      status: a.status,
      workItemId: a.workItemId
    })),
    recentEvents: (mission.events || []).slice(-24).map((e) => ({
      ts: e.ts,
      level: e.level,
      source: e.source,
      message: e.message,
      telemetryKind: e.telemetryKind
    })),
    memoryHead: (mission.memory || []).slice(-12).map((m) => ({
      id: m.id,
      ts: m.ts,
      kind: m.kind,
      tags: m.tags,
      textPreview: m.text.slice(0, 240)
    })),
    researchContradictionWarnings: researchContradictions
  };
}
