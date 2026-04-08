import type { ResolveApprovalOutcome } from "../missionActionResult";
import type { Mission, ToolCall, WorkItem } from "../../types";
import type { MissionStore } from "../MissionStore";
import type { MissionOrchestratorWorkItemRunner } from "./missionOrchestratorWorkItemRunner";

export interface ApprovalResolverHost {
  store: MissionStore;
  workItemRunner: MissionOrchestratorWorkItemRunner;
  pendingCompletionReason: Map<string, NonNullable<Mission["completionReason"]>>;
  updateWorkItemWithHardStopInvariant(
    missionId: string,
    itemBeforePatch: WorkItem,
    patch: Partial<WorkItem>
  ): Promise<void>;
  scheduleRunMission(missionId: string): void;
}

export class MissionOrchestratorApprovalResolver {
  constructor(private readonly host: ApprovalResolverHost) {}

  async resolveApproval(
    missionId: string,
    approvalId: string,
    approved: boolean,
    note?: string
  ): Promise<ResolveApprovalOutcome> {
    const approval = await this.host.store.resolveApproval(
      missionId,
      approvalId,
      approved ? "approved" : "rejected",
      note
    );
    if (!approval) {
      return { kind: "noop_unknown_approval", missionId, approvalId };
    }

    await this.host.store.saveEvent(missionId, {
      level: approved ? "info" : "warn",
      source: "approval",
      message: `${approved ? "Approved" : "Rejected"}: ${approval.title}`,
      data: approval
    });

    if (approved) {
      const approvedCall: ToolCall = {
        ...approval.toolCall,
        args: {
          ...approval.toolCall.args,
          __approved: true,
          ...(approval.workItemId && !approval.toolCall.args?.__workItemId ? { __workItemId: approval.workItemId } : {})
        }
      };
      if (approval.workItemId) {
        const m = this.host.store.get(missionId);
        const wi = m?.queue.find((w) => w.id === approval.workItemId);
        if (wi) {
          await this.host.updateWorkItemWithHardStopInvariant(missionId, wi, {
            status: "running",
            hardStopClass: undefined,
            output: `${wi.output || ""}\n\nApproved execution in progress.`.trim()
          });
          await this.host.workItemRunner.markMutatingToolExecutionStarted(missionId, wi, approvedCall);
        }
      }
      await this.host.store.updateMission(missionId, { status: "queued", blocker: undefined, blockReasonCode: undefined });
      const result = await this.host.workItemRunner.executeAndRecordToolCall(missionId, approvedCall, [
        "approval",
        approval.kind
      ]);
      if (approval.workItemId) {
        const m = this.host.store.get(missionId);
        const wi = m?.queue.find((w) => w.id === approval.workItemId);
        if (wi) {
          await this.host.updateWorkItemWithHardStopInvariant(missionId, wi, {
            status: "done",
            hardStopClass: undefined,
            activeMutatingToolCall: undefined,
            output: `${wi.output || ""}\n\nApproved and executed: ${result.summary}`.trim()
          });
        }
      }
      await this.host.store.noteProgress(missionId);
      await this.host.store.updateMission(missionId, { status: "queued", blockReasonCode: undefined });
      this.host.scheduleRunMission(missionId);
      return { kind: "approved_continuation_scheduled", missionId };
    }
    this.host.pendingCompletionReason.delete(missionId);
    if (approval.workItemId) {
      const m = this.host.store.get(missionId);
      const wi = m?.queue.find((w) => w.id === approval.workItemId);
      if (wi) {
        await this.host.updateWorkItemWithHardStopInvariant(missionId, wi, {
          hardStopClass: "approval_rejected"
        });
      }
    }
    await this.host.store.updateMission(missionId, {
      status: "blocked",
      blocker: approval.resolutionNote || "Tool request rejected",
      validationState: "failed",
      blockReasonCode: "approval_rejected"
    });
    return { kind: "rejected_mission_blocked", missionId, statusAfter: "blocked" };
  }
}
