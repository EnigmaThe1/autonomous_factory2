import test from "node:test";
import assert from "node:assert/strict";
import { operatorNextActionHint } from "../ui/operatorNextActionHint";
import type { Mission } from "../types";

test("operatorNextActionHint: approval pending", () => {
  const m = {
    status: "awaiting_input",
    blockReasonCode: "approval_pending",
    approvals: [
      {
        id: "a",
        createdAt: 1,
        missionId: "m",
        kind: "write_file",
        title: "t",
        details: "",
        toolCall: { tool: "writeFile", args: {} },
        status: "pending"
      }
    ]
  } as unknown as Mission;
  const h = operatorNextActionHint(m);
  assert.ok(h?.includes("Approvals"));
});

test("operatorNextActionHint: stall limit", () => {
  const m = { status: "blocked", blockReasonCode: "stall_recovery_limit", approvals: [] } as unknown as Mission;
  assert.ok(operatorNextActionHint(m)?.includes("Stall recovery"));
});
