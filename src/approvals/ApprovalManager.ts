import { ApprovalRequest, ToolApproval, ToolCall } from "../types";
import { uid } from "../util";

export class ApprovalManager {
  create(missionId: string, call: ToolCall, approval: ToolApproval, workItemId?: string): ApprovalRequest {
    return {
      id: uid("approval"),
      createdAt: Date.now(),
      missionId,
      kind: approval.kind,
      title: approval.title,
      details: approval.details,
      toolCall: call,
      status: "pending",
      diffPreview: approval.diffPreview,
      ...(workItemId ? { workItemId } : {})
    };
  }
}
