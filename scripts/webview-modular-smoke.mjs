/**
 * Post-modularization webview smoke harness (Node ESM, no VS Code webview).
 * Kept as .mjs so dynamic import() loads media/chat/*.js as real ES modules
 * (tsc commonjs would incorrectly emit require() for the same imports).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

function mediaChatUrl(file) {
  return pathToFileURL(join(projectRoot, "media", "chat", file)).href;
}

function mockEl(overrides = {}) {
  return {
    addEventListener: () => {},
    value: "",
    checked: false,
    textContent: "",
    innerHTML: "",
    click: () => {},
    focus: () => {},
    ...overrides
  };
}

function mockChatHistory() {
  const entries = [];
  return {
    entries,
    pushUser(content) { entries.push({ role: "user", content }); },
    pushAssistant(content) { entries.push({ role: "assistant", content }); },
    clear() { entries.length = 0; },
    isEmpty() { return entries.length === 0; }
  };
}

function minimalSidebarSnapshot() {
  return {
    providers: ["openai"],
    defaultProvider: "openai",
    defaultModel: "gpt-4",
    resolvedDefaultModel: "gpt-4",
    providerCredentialStatus: [],
    providerModelPresets: {},
    providerLiveModelCatalog: {},
    providerBaseUrls: {},
    providerSavedModels: {},
    missions: [],
    globalMemoryRecent: [],
    consoleLines: [],
    agents: [],
    tools: {
      builtinTools: ["read"],
      mcpToolCount: 2,
      mcpSessionCount: 1,
      recentToolEvents: [
        {
          missionId: "m1",
          missionTitle: "T",
          ts: Date.now(),
          source: "mcp",
          message: "ok",
          level: "info"
        }
      ]
    },
    settings: {
      defaultTab: "chat",
      defaultProvider: "openai",
      defaultModel: "gpt-4",
      autoResumeOnStartup: false,
      heartbeatSeconds: 8,
      maxStepsPerRun: 128,
      unlimitedStepsPerRun: false,
      allowTerminal: true,
      requireWriteApproval: false,
      requireApprovalForNonImplementerMutations: true,
      autoApproveAllToolRequests: false,
      useNativeChatParticipant: false,
      mcpConfigPath: "",
      autoRevealOnActivation: true,
      missionBlueprintModeEnum: "off",
      missionBlueprintMode: false,
      missionPreBlueprintClarification: false,
      missionRequireBlueprintApproval: true,
      traceAutoRefreshIntervalMs: 10000,
      autonomyMode: "workspace_autonomous",
      autonomyBlueprintPlanning: "off",
      autonomyAutoContinuePasses: true,
      autonomyMaxAutonomousStepCapChains: 2000,
      autonomyAutoApproveWorkspaceWrites: true,
      autonomyAutoApproveWorkspaceDeletes: true,
      autonomyAutoApproveWorkspaceSafeCommands: true,
      autonomyRequireApprovalForProtectedPaths: true,
      autonomyProtectedPathGlobs: [],
      autonomyBlockedPathGlobs: [],
      autonomyExtensionCoreMutationPolicy: "require_approval",
      toolRecoveryAutonomyPreset: "standard",
      retryBudgetMaxRunCommandRecovery: 12,
      retryBudgetMaxWriteFileRecovery: 12,
      retryBudgetMaxApplyPatchRecovery: 12,
      retryBudgetMaxTransientMutating: 4,
      retryBudgetMaxToolFollowUpTurns: 10
    },
    pendingApprovals: [],
    approvalBundles: [],
    agentLive: [],
    timeline: [],
    mcpOnboarding: {
      status: "ready",
      configuredPath: ".mcp.json",
      resolvedAbsolutePath: "/x/.mcp.json",
      canCreateStarter: false,
      hint: "hint",
      starterDestinationRelative: null
    },
    missionList: { includeArchived: false, totalCount: 0, archivedCount: 0 },
    routingPresetTemplates: {},
    traceSessionId: "sess-smoke",
    snapshotPublishSeq: 1
  };
}

test("missionCompletionLabels: known completionReason values map to operator text", async () => {
  const { formatMissionCompletionReason } = await import(mediaChatUrl("missionCompletionLabels.js"));
  assert.equal(
    formatMissionCompletionReason("already_satisfied_no_tool_run"),
    "Already satisfied; no tool run needed"
  );
  assert.equal(
    formatMissionCompletionReason("apply_patch_noop_success"),
    "Patch not needed; desired content already present"
  );
  assert.equal(
    formatMissionCompletionReason("stale_patch_but_goal_already_met"),
    "Patch was stale; goal already validated as met"
  );
});

test("missionCompletionLabels: unknown completionReason degrades to raw string", async () => {
  const { formatMissionCompletionReason } = await import(mediaChatUrl("missionCompletionLabels.js"));
  assert.equal(formatMissionCompletionReason("future_reason_v2"), "future_reason_v2");
  assert.equal(formatMissionCompletionReason(undefined), "");
  assert.equal(formatMissionCompletionReason(""), "");
});

test("missionCompletionLabels: known completionKind values map to operator text", async () => {
  const { formatWorkItemCompletionKind } = await import(mediaChatUrl("missionCompletionLabels.js"));
  assert.equal(formatWorkItemCompletionKind("already_satisfied"), "Already satisfied (no tool run)");
  assert.equal(
    formatWorkItemCompletionKind("apply_patch_noop"),
    "Patch not needed (desired content already present)"
  );
});

test("missionCompletionLabels: unknown completionKind degrades to raw string", async () => {
  const { formatWorkItemCompletionKind } = await import(mediaChatUrl("missionCompletionLabels.js"));
  assert.equal(formatWorkItemCompletionKind("future_kind"), "future_kind");
  assert.equal(formatWorkItemCompletionKind(undefined), "");
});

test("missionCompletionLabels: maxSteps resume hint from recent events only", async () => {
  const { eventIndicatesMaxStepsResume } = await import(mediaChatUrl("missionCompletionLabels.js"));
  assert.equal(eventIndicatesMaxStepsResume([]), false);
  assert.equal(
    eventIndicatesMaxStepsResume([{ message: "Run reached maxStepsPerRun. Mission remains resumable." }]),
    true
  );
  assert.equal(eventIndicatesMaxStepsResume([{ message: "unrelated" }]), false);
});

test("missionCompletionLabels: non-terminal notes for queued + maxSteps event", async () => {
  const { buildNonTerminalMissionNotes } = await import(mediaChatUrl("missionCompletionLabels.js"));
  const notes = buildNonTerminalMissionNotes({
    status: "queued",
    blocker: "",
    events: [{ message: "Run reached maxStepsPerRun. Mission remains resumable." }]
  });
  assert.equal(notes.length, 1);
  assert.match(notes[0].primary, /step limit/i);
});

test("missionCompletionLabels: non-terminal notes skip maxSteps when blocker present", async () => {
  const { buildNonTerminalMissionNotes } = await import(mediaChatUrl("missionCompletionLabels.js"));
  const notes = buildNonTerminalMissionNotes({
    status: "queued",
    blocker: "Stale blocker text",
    events: [{ message: "Run reached maxStepsPerRun. Mission remains resumable." }]
  });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].primary, "Stale blocker text");
});

test("missionCompletionLabels: known blocked blockers map to friendly primary", async () => {
  const { buildNonTerminalMissionNotes } = await import(mediaChatUrl("missionCompletionLabels.js"));
  const n = buildNonTerminalMissionNotes({
    status: "blocked",
    blocker: "Reached maxAutoRounds safety limit",
    approvals: []
  });
  assert.equal(n.length, 1);
  assert.match(n[0].primary, /rounds/i);
  assert.equal(n[0].detail, undefined);
});

test("missionCompletionLabels: awaiting_input shows approval headline + raw detail", async () => {
  const { buildNonTerminalMissionNotes } = await import(mediaChatUrl("missionCompletionLabels.js"));
  const n = buildNonTerminalMissionNotes({
    status: "awaiting_input",
    blocker: "Apply patch to foo.ts",
    approvals: [{ status: "pending" }]
  });
  assert.match(n[0].primary, /awaiting your approval/i);
  assert.equal(n[0].detail, "Apply patch to foo.ts");
});

test("missionCompletionLabels: unknown blocker stays raw single line", async () => {
  const { buildNonTerminalMissionNotes } = await import(mediaChatUrl("missionCompletionLabels.js"));
  const n = buildNonTerminalMissionNotes({ status: "blocked", blocker: "custom_operator_blocker_xyz" });
  assert.equal(n.length, 1);
  assert.equal(n[0].primary, "custom_operator_blocker_xyz");
});

test("missionCompletionLabels: policy and tool-failure prefixes get detail line", async () => {
  const { buildNonTerminalMissionNotes } = await import(mediaChatUrl("missionCompletionLabels.js"));
  const pol = buildNonTerminalMissionNotes({
    status: "blocked",
    blocker: "Policy blocked mission progress (applyPatch: denied)"
  });
  assert.match(pol[0].primary, /policy/i);
  assert.ok(pol[0].detail?.includes("Policy blocked"));
  const tool = buildNonTerminalMissionNotes({
    status: "blocked",
    blocker: "Mission halted after tool failure (applyPatch: oops)"
  });
  assert.match(tool[0].primary, /tool run failed|failed during this step/i);
  assert.ok(tool[0].detail?.includes("Mission halted"));
});

test("missionCompletionLabels: completed missions get no non-terminal notes", async () => {
  const { buildNonTerminalMissionNotes } = await import(mediaChatUrl("missionCompletionLabels.js"));
  assert.deepEqual(buildNonTerminalMissionNotes({ status: "completed", blocker: "weird" }), []);
});

test("missionEventLabels: maxSteps resumable maps with raw detail preserved", async () => {
  const { describeMissionEventMessage } = await import(mediaChatUrl("missionEventLabels.js"));
  const raw = "Run reached maxStepsPerRun. Mission remains resumable.";
  const d = describeMissionEventMessage(raw);
  assert.match(d.primary, /run step limit/i);
  assert.equal(d.detail, raw);
});

test("missionEventLabels: recovered interrupted work pattern", async () => {
  const { describeMissionEventMessage } = await import(mediaChatUrl("missionEventLabels.js"));
  const raw = "Recovered 3 interrupted running work item(s) and re-queued them for resume.";
  const d = describeMissionEventMessage(raw);
  assert.match(d.primary, /interrupted work/i);
  assert.equal(d.detail, raw);
});

test("missionEventLabels: approval required and rejected map to truthful operator copy", async () => {
  const { describeMissionEventMessage } = await import(mediaChatUrl("missionEventLabels.js"));
  const required = describeMissionEventMessage("Approval required: Approve bounded write");
  assert.match(required.primary, /approval required/i);
  assert.equal(required.detail, "Approval required: Approve bounded write");

  const rejected = describeMissionEventMessage("Rejected: Approve bounded write");
  assert.match(rejected.primary, /remains blocked|approval rejected/i);
  assert.equal(rejected.detail, "Rejected: Approve bounded write");
});

test("missionEventLabels: stale patch recovery contains marker", async () => {
  const { describeMissionEventMessage } = await import(mediaChatUrl("missionEventLabels.js"));
  const raw =
    "Stale edit skipped (applyPatch: x); validation already passed — no code change required (stale_patch_but_goal_already_met).";
  const d = describeMissionEventMessage(raw);
  assert.match(d.primary, /Stale patch skipped/i);
  assert.equal(d.detail, raw);
});

test("missionOperatorLabelsCore: event and memory surfaces delegate to same free-text classifier", async () => {
  const { describeOperatorFreeText } = await import(mediaChatUrl("missionOperatorLabelsCore.js"));
  const ev = await import(mediaChatUrl("missionEventLabels.js"));
  const mem = await import(mediaChatUrl("missionMemoryLabels.js"));
  const raw = "Mission paused: tool call failed (applyPatch: x).";
  const core = describeOperatorFreeText(raw);
  assert.deepEqual(ev.describeMissionEventMessage(raw), core);
  assert.deepEqual(mem.describeMissionMemoryText(raw), core);
});

test("missionStatusPresentation: canonical badge labels", async () => {
  const { formatMissionStatusBadgeLabel } = await import(mediaChatUrl("missionStatusPresentation.js"));
  assert.equal(formatMissionStatusBadgeLabel(null), "Unknown");
  assert.equal(
    formatMissionStatusBadgeLabel({ status: "completed", completionReason: "already_satisfied_no_tool_run", queue: [] }),
    "Completed — already satisfied"
  );
  assert.equal(
    formatMissionStatusBadgeLabel({
      status: "queued",
      blocker: "",
      events: [{ message: "Run hit maxStepsPerRun cap; resumable." }],
      queue: []
    }),
    "Queued — resumable"
  );
  assert.equal(
    formatMissionStatusBadgeLabel({ status: "awaiting_input", approvals: [{ status: "pending" }], queue: [] }),
    "Paused — awaiting approval"
  );
  assert.equal(
    formatMissionStatusBadgeLabel({
      status: "blocked",
      blocker: "Policy blocked mission progress (applyPatch: x)",
      queue: []
    }),
    "Needs attention — policy block"
  );
  assert.equal(
    formatMissionStatusBadgeLabel({
      status: "blocked",
      blocker: "Reached maxAutoRounds safety limit",
      queue: []
    }),
    "Paused — max auto rounds"
  );
  assert.equal(
    formatMissionStatusBadgeLabel({ status: "blocked", blocker: "Totally custom orchestrator blocker", queue: [] }),
    "Needs attention"
  );
  assert.equal(formatMissionStatusBadgeLabel({ status: "future_custom_state", queue: [] }), "future custom state");
});

test("mission operator presentation: table-driven badges, notes, completion, archived", async () => {
  const { formatMissionStatusBadgeLabel } = await import(mediaChatUrl("missionStatusPresentation.js"));
  const { buildNonTerminalMissionNotes, formatMissionCompletionReason } = await import(mediaChatUrl("missionCompletionLabels.js"));
  const { MISSION_COMPLETION_REASON_LABELS } = await import(mediaChatUrl("missionOperatorLabelsCore.js"));

  const queueRunning = (role) => [
    { status: "todo", role: "planner" },
    { status: "running", role }
  ];
  for (const role of ["planner", "implementer", "reviewer", "validator"]) {
    const m = { status: "running", queue: queueRunning(role) };
    assert.equal(formatMissionStatusBadgeLabel(m), `Running — ${role}`);
    assert.equal(
      formatMissionStatusBadgeLabel({ ...m, archivedAt: 1 }),
      `Running — ${role} (archived)`
    );
  }

  const awaitingApproval = {
    status: "awaiting_input",
    blocker: "Approve patch to src/a.ts",
    approvals: [{ status: "pending" }],
    queue: []
  };
  assert.equal(formatMissionStatusBadgeLabel(awaitingApproval), "Paused — awaiting approval");
  const notesAppr = buildNonTerminalMissionNotes(awaitingApproval);
  assert.match(notesAppr[0].primary, /awaiting your approval/i);
  assert.equal(notesAppr[0].detail, "Approve patch to src/a.ts");
  assert.equal(
    formatMissionStatusBadgeLabel({ ...awaitingApproval, archivedAt: 9 }),
    "Paused — awaiting approval (archived)"
  );

  const awaitingInputNoPending = {
    status: "awaiting_input",
    blocker: "Waiting on external step",
    approvals: [{ status: "approved" }],
    queue: []
  };
  assert.equal(formatMissionStatusBadgeLabel(awaitingInputNoPending), "Paused — awaiting input");
  const notesNoPend = buildNonTerminalMissionNotes(awaitingInputNoPending);
  assert.match(notesNoPend[0].primary, /operator input/i);
  assert.equal(notesNoPend[0].detail, "Waiting on external step");

  const maxStepEv = [{ message: "Run hit maxStepsPerRun cap; resumable." }];
  assert.equal(
    formatMissionStatusBadgeLabel({ status: "queued", blocker: "", events: maxStepEv, queue: [] }),
    "Queued — resumable"
  );
  assert.equal(formatMissionStatusBadgeLabel({ status: "queued", blocker: "", events: [], queue: [] }), "Queued");
  assert.equal(
    formatMissionStatusBadgeLabel({ status: "queued", blocker: "", events: maxStepEv, queue: [], archivedAt: 3 }),
    "Queued — resumable (archived)"
  );

  /** @type {Array<[string, string, RegExp | null]>} */
  const blockedMatrix = [
    ["Policy blocked mission progress (applyPatch: denied)", "Needs attention — policy block", /blocked by workspace policy|policy/i],
    ["Mission halted after tool failure (applyPatch: oops)", "Paused — tool failure", /tool run failed|failed during this step/i],
    ["Reached maxAutoRounds safety limit", "Paused — max auto rounds", /autonomous rounds|maximum autonomous/i],
    ["Mission exceeded automatic recovery attempts", "Paused — recovery limit", /recovery limit|automatic stall/i],
    [
      "Mission cannot complete while required work items are still todo or running.",
      "Needs attention — work still open",
      /required work items are still todo or running/i
    ],
    ["Closure policy not satisfied", "Needs attention — closure pending", /closure policy is not satisfied/i],
    ["Totally unknown operator blocker zzz", "Needs attention", null]
  ];
  for (const [blocker, wantBadge, noteRe] of blockedMatrix) {
    const mb = { status: "blocked", blocker, queue: [] };
    assert.equal(formatMissionStatusBadgeLabel(mb), wantBadge);
    assert.equal(formatMissionStatusBadgeLabel({ ...mb, archivedAt: 7 }), `${wantBadge} (archived)`);
    const bn = buildNonTerminalMissionNotes(mb);
    assert.equal(bn.length, 1);
    if (noteRe) assert.match(bn[0].primary, noteRe);
    else assert.equal(bn[0].primary, blocker);
  }

  for (const key of Object.keys(MISSION_COMPLETION_REASON_LABELS)) {
    const base = formatMissionStatusBadgeLabel({ status: "completed", completionReason: key, queue: [] });
    assert.ok(base.startsWith("Completed — "), `badge for ${key}`);
    assert.equal(formatMissionCompletionReason(key), MISSION_COMPLETION_REASON_LABELS[key]);
    assert.equal(
      formatMissionStatusBadgeLabel({ status: "completed", completionReason: key, queue: [], archivedAt: 99 }),
      `${base} (archived)`
    );
  }
  assert.equal(
    formatMissionStatusBadgeLabel({ status: "completed", completionReason: "future_unknown_reason", queue: [] }),
    "Completed"
  );
  assert.equal(
    formatMissionStatusBadgeLabel({
      status: "completed",
      completionReason: "future_unknown_reason",
      queue: [],
      archivedAt: 2
    }),
    "Completed (archived)"
  );
  assert.equal(formatMissionCompletionReason("future_unknown_reason"), "future_unknown_reason");
});

test("missionOperatorLabelsCore: blocked badge + notes align with orchestrator blockers", async () => {
  const { formatBlockedMissionBadgeLabel, describeMissionBlocker } = await import(mediaChatUrl("missionOperatorLabelsCore.js"));
  assert.equal(
    formatBlockedMissionBadgeLabel("Policy blocked mission progress (read_file: denied)"),
    "Needs attention — policy block"
  );
  assert.equal(formatBlockedMissionBadgeLabel("Mission halted after tool failure (applyPatch: err)"), "Paused — tool failure");
  assert.equal(formatBlockedMissionBadgeLabel("Reached maxAutoRounds safety limit"), "Paused — max auto rounds");
  assert.equal(formatBlockedMissionBadgeLabel("Mission exceeded automatic recovery attempts"), "Paused — recovery limit");
  assert.equal(
    formatBlockedMissionBadgeLabel("Mission cannot complete while required work items are still todo or running."),
    "Needs attention — work still open"
  );
  assert.equal(formatBlockedMissionBadgeLabel("Closure policy not satisfied"), "Needs attention — closure pending");
  assert.equal(
    formatBlockedMissionBadgeLabel("Model stream cancelled (operator abort). Resume when ready."),
    "Paused — run stopped"
  );
  assert.equal(formatBlockedMissionBadgeLabel("Tool request rejected"), "Needs attention — approval rejected");
  assert.equal(formatBlockedMissionBadgeLabel("Validator reported BLOCKER: fix tests"), "Needs attention");

  assert.equal(describeMissionBlocker("Validator reported BLOCKER: fix tests", "blocked", 0), null);

  const rounds = describeMissionBlocker("Reached maxAutoRounds safety limit", "blocked", 0);
  assert.ok(rounds && rounds.primary.includes("autonomous rounds"));

  const appr = describeMissionBlocker("Approve write to README", "awaiting_input", 1);
  assert.match(appr.primary, /approval/i);
  assert.equal(appr.detail, "Approve write to README");

  const noPend = describeMissionBlocker("Waiting on external step", "awaiting_input", 0);
  assert.match(noPend.primary, /input/i);
  assert.equal(noPend.detail, "Waiting on external step");

  const apprStale = describeMissionBlocker("Awaiting approval", "awaiting_input", 0, "approval_pending");
  assert.match(apprStale.primary, /Approvals tab is empty|stale|nothing is listed/i);
  assert.ok(!/open the Approvals tab to continue/i.test(apprStale.primary));

  assert.equal(
    formatBlockedMissionBadgeLabel("misleading raw blocker text", "policy_blocked"),
    "Needs attention — policy block"
  );
  const noteByCode = describeMissionBlocker("misleading", "blocked", 0, "tool_failure");
  assert.ok(noteByCode && noteByCode.primary.includes("tool run failed"));
  assert.equal(noteByCode.detail, "misleading");
});

test("missionStatusPresentation: blockReasonCode wins over misleading blocker for badge", async () => {
  const { formatMissionStatusBadgeLabel } = await import(mediaChatUrl("missionStatusPresentation.js"));
  assert.equal(
    formatMissionStatusBadgeLabel({
      status: "blocked",
      blocker: "Validator reported BLOCKER: fix tests",
      blockReasonCode: "closure_not_satisfied",
      queue: []
    }),
    "Needs attention — closure pending"
  );
});

test("missionCompletionLabels: buildNonTerminalMissionNotes prefers blockReasonCode", async () => {
  const { buildNonTerminalMissionNotes } = await import(mediaChatUrl("missionCompletionLabels.js"));
  const notes = buildNonTerminalMissionNotes({
    status: "blocked",
    blocker: "custom xyz",
    blockReasonCode: "stall_recovery_limit"
  });
  assert.equal(notes.length, 1);
  assert.match(notes[0].primary, /stall|recovery|automatic/i);
  assert.equal(notes[0].detail, "custom xyz");
});

test("missionListSort: operator display order", async () => {
  const { sortMissionsForOperatorDisplay } = await import(mediaChatUrl("missionListSort.js"));
  const base = { title: "t", queue: [], approvals: [], events: [], checkpoints: [], updatedAt: 0 };
  const mk = (id, overrides) => ({ ...base, id, ...overrides });

  let sorted = sortMissionsForOperatorDisplay([mk("blocked", { status: "blocked" }), mk("running", { status: "running" })]);
  assert.deepEqual(
    sorted.map((m) => m.id),
    ["running", "blocked"]
  );

  sorted = sortMissionsForOperatorDisplay([
    mk("plainQ", { status: "queued", blocker: "" }),
    mk("awaitAp", { status: "awaiting_input", approvals: [{ status: "pending" }] })
  ]);
  assert.deepEqual(
    sorted.map((m) => m.id),
    ["awaitAp", "plainQ"]
  );

  sorted = sortMissionsForOperatorDisplay([
    mk("plainQ", { status: "queued", blocker: "" }),
    mk("resumeQ", {
      status: "queued",
      blocker: "",
      events: [{ message: "Run hit maxStepsPerRun cap; resumable." }]
    })
  ]);
  assert.deepEqual(
    sorted.map((m) => m.id),
    ["resumeQ", "plainQ"]
  );

  sorted = sortMissionsForOperatorDisplay([
    mk("arch", { status: "completed", archivedAt: 100 }),
    mk("done", { status: "completed" })
  ]);
  assert.deepEqual(
    sorted.map((m) => m.id),
    ["done", "arch"]
  );

  sorted = sortMissionsForOperatorDisplay([mk("weird", { status: "weird_future" }), mk("run", { status: "running" })]);
  assert.deepEqual(
    sorted.map((m) => m.id),
    ["run", "weird"]
  );
});

test("missionQuickFilters: definitions and compose with operator sort", async () => {
  const { filterMissionsByQuickFilter, composeMissionsForMissionList } = await import(mediaChatUrl("missionQuickFilters.js"));
  const base = { title: "t", queue: [], approvals: [], events: [], checkpoints: [], updatedAt: 0 };
  const mk = (id, o) => ({ ...base, id, ...o });

  const mixed = [mk("done", { status: "completed" }), mk("run", { status: "running" }), mk("blk", { status: "blocked" })];
  const activeOnly = filterMissionsByQuickFilter(mixed, "active");
  assert.ok(activeOnly.every((m) => m.status !== "completed"));
  assert.ok(activeOnly.some((m) => m.id === "run"));

  const withAppr = [mk("q", { status: "queued" }), mk("ap", { status: "awaiting_input", approvals: [{ status: "pending" }] })];
  const apprFiltered = filterMissionsByQuickFilter(withAppr, "awaiting_approval");
  assert.equal(apprFiltered.length, 1);
  assert.equal(apprFiltered[0].id, "ap");

  const resPair = [
    mk("plainQ", { status: "queued", blocker: "" }),
    mk("resumeQ", {
      status: "queued",
      blocker: "",
      events: [{ message: "Run hit maxStepsPerRun cap; resumable." }]
    })
  ];
  const resFiltered = filterMissionsByQuickFilter(resPair, "resumable");
  assert.equal(resFiltered.length, 1);
  assert.equal(resFiltered[0].id, "resumeQ");

  const abortBlocked = mk("abortBlocked", {
    status: "blocked",
    blocker: "Model stream cancelled (operator abort). Resume when ready.",
    blockReasonCode: "operator_stream_abort"
  });
  const rejectBlocked = mk("rejectBlocked", {
    status: "blocked",
    blocker: "Tool request rejected",
    blockReasonCode: "approval_rejected"
  });
  const resumableBlocked = filterMissionsByQuickFilter([abortBlocked, rejectBlocked], "resumable");
  assert.deepEqual(
    resumableBlocked.map((m) => m.id),
    ["abortBlocked"]
  );
  const needsAttention = filterMissionsByQuickFilter([abortBlocked, rejectBlocked], "needs_attention");
  assert.deepEqual(
    needsAttention.map((m) => m.id),
    ["rejectBlocked"]
  );

  const compArch = [mk("done", { status: "completed" }), mk("old", { status: "completed", archivedAt: 1 })];
  const compFiltered = filterMissionsByQuickFilter(compArch, "completed");
  assert.equal(compFiltered.length, 2);

  const composed = composeMissionsForMissionList(
    [mk("q", { status: "queued" }), mk("r", { status: "running" })],
    "active"
  );
  assert.deepEqual(
    composed.map((m) => m.id),
    ["r", "q"]
  );
});

test("missionInspectorSig: focused hidden by quick filter (fhl)", async () => {
  const {
    composeMissionsForMissionList,
    focusedMissionHiddenFromComposedList,
    getMissionQuickFilterLabel
  } = await import(mediaChatUrl("missionQuickFilters.js"));
  const { missionInspectorSig } = await import(mediaChatUrl("webviewSignatures.js"));

  const mini = (id, status) => ({
    id,
    status,
    title: id,
    queue: [],
    approvals: [],
    events: [],
    checkpoints: [],
    memory: [],
    updatedAt: 1,
    routing: { preset: "default" },
    policy: { policyPreset: "custom" },
    activeProviderId: "p",
    activeModel: "m",
    currentStep: 0,
    validationState: "pending"
  });
  const run = mini("r", "running");
  const done = mini("d", "completed");
  const snap = {
    missions: [run, done],
    focusedMission: run,
    focusedMissionId: "r",
    missionList: { includeArchived: false, totalCount: 2, archivedCount: 0 },
    defaultModel: "dm"
  };

  let composed = composeMissionsForMissionList(snap.missions, "completed");
  assert.equal(focusedMissionHiddenFromComposedList(snap.focusedMission, composed), true);
  let ins = JSON.parse(missionInspectorSig(snap, "completed", composed));
  assert.equal(ins.fhl, true);
  assert.equal(ins.qf, "completed");
  assert.equal(ins.rwh, "");
  assert.equal(ins.dqh, "");
  assert.equal(ins.dgh, "");
  assert.equal(ins.loa, "");
  assert.equal(ins.fls, "");
  assert.equal(ins.oah, "");
  assert.match(getMissionQuickFilterLabel("completed"), /Completed/i);

  composed = composeMissionsForMissionList(snap.missions, "all");
  assert.equal(focusedMissionHiddenFromComposedList(snap.focusedMission, composed), false);
  ins = JSON.parse(missionInspectorSig(snap, "all", composed));
  assert.equal(ins.fhl, false);
  assert.equal(ins.rwh, "");
  assert.equal(ins.dqh, "");
  assert.equal(ins.dgh, "");
  assert.equal(ins.loa, "");
  assert.equal(ins.fls, "");
  assert.equal(ins.oah, "");

  composed = composeMissionsForMissionList(snap.missions, "active");
  assert.equal(focusedMissionHiddenFromComposedList(snap.focusedMission, composed), false);
  ins = JSON.parse(missionInspectorSig(snap, "active", composed));
  assert.equal(ins.fhl, false);
  assert.equal(ins.rwh, "");
  assert.equal(ins.dqh, "");
  assert.equal(ins.dgh, "");
  assert.equal(ins.loa, "");
  assert.equal(ins.fls, "");
  assert.equal(ins.oah, "");
});

test("formatMissionEventRowHtml: headline + raw for mapped operator-action", async () => {
  const { formatMissionEventRowHtml } = await import(mediaChatUrl("missionEventLabels.js"));
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const html = formatMissionEventRowHtml(
    {
      id: "ev1",
      source: "operator-action",
      message: "Resume requested; joined the active run pass."
    },
    { ev1: "Resume: joined active pass" },
    esc
  );
  assert.match(html, /Resume: joined active pass/);
  assert.match(html, /Resume requested; joined the active run pass/);
});

test("missionInspectorSig: operator-action headlines fragment (oah)", async () => {
  const { composeMissionsForMissionList } = await import(mediaChatUrl("missionQuickFilters.js"));
  const { missionInspectorSig } = await import(mediaChatUrl("webviewSignatures.js"));

  const run = {
    id: "r",
    status: "running",
    title: "r",
    queue: [],
    approvals: [],
    events: [
      {
        id: "ev1",
        ts: 1,
        level: "info",
        source: "operator-action",
        message: "Resume requested; joined the active run pass."
      }
    ],
    checkpoints: [],
    memory: [],
    updatedAt: 1,
    routing: { preset: "default" },
    policy: { policyPreset: "custom" },
    activeProviderId: "p",
    activeModel: "m",
    currentStep: 0,
    validationState: "pending"
  };
  const snap = {
    missions: [run],
    focusedMission: run,
    focusedMissionId: "r",
    focusedMissionOperatorActionHeadlines: { ev1: "Resume: joined active pass" },
    missionList: { includeArchived: false, totalCount: 1, archivedCount: 0 },
    defaultModel: "dm"
  };
  const composed = composeMissionsForMissionList(snap.missions, "all");
  const ins = JSON.parse(missionInspectorSig(snap, "all", composed));
  assert.equal(ins.oah, "ev1\tResume: joined active pass");
});

test("missionInspectorSig and missionsListPanelSig: focused lifecycle summary (fls)", async () => {
  const { composeMissionsForMissionList } = await import(mediaChatUrl("missionQuickFilters.js"));
  const { missionInspectorSig, missionsListPanelSig } = await import(mediaChatUrl("webviewSignatures.js"));

  const mini = (id, status) => ({
    id,
    status,
    title: id,
    queue: [{ id: "w1", title: "W", role: "implementer", status: "running", prompt: "p" }],
    approvals: [],
    events: [],
    checkpoints: [],
    memory: [],
    updatedAt: 1,
    routing: { preset: "default" },
    policy: { policyPreset: "custom" },
    activeProviderId: "p",
    activeModel: "m",
    currentStep: 0,
    validationState: "pending"
  });
  const run = mini("r", "running");
  const snap = {
    missions: [run],
    focusedMission: run,
    focusedMissionId: "r",
    focusedMissionLifecycleSummary: "Running now; implementer is active.",
    missionList: { includeArchived: false, totalCount: 1, archivedCount: 0 },
    defaultModel: "dm"
  };
  const composed = composeMissionsForMissionList(snap.missions, "all");
  const ins = JSON.parse(missionInspectorSig(snap, "all", composed));
  assert.equal(ins.fls, "Running now; implementer is active.");
  const list = JSON.parse(missionsListPanelSig(snap, "all", composed));
  assert.equal(list.fls, "Running now; implementer is active.");
});

test("formatDashboardMissionSummaryText", async () => {
  const { formatDashboardMissionSummaryText } = await import(mediaChatUrl("missionProgressDashboard.js"));
  assert.equal(formatDashboardMissionSummaryText(null), "0");
  assert.equal(
    formatDashboardMissionSummaryText({
      missions: [],
      missionList: { totalCount: 5, archivedCount: 0 }
    }),
    "5"
  );
  assert.equal(
    formatDashboardMissionSummaryText({
      missions: [
        { status: "running" },
        { status: "running" },
        { status: "queued" },
        { status: "awaiting_input" }
      ],
      missionList: { totalCount: 10, archivedCount: 0 }
    }),
    "10 • 2 running • 1 queued • 1 awaiting"
  );
});

test("chatPanelSig includes progress + focused title/status", async () => {
  const { chatPanelSig } = await import(mediaChatUrl("webviewSignatures.js"));
  const snap = {
    focusedMissionId: "m1",
    focusedMission: {
      id: "m1",
      title: "Fix bug",
      status: "running",
      memory: []
    },
    missionProgressStats: {
      m1: {
        total: 2,
        done: 0,
        running: 1,
        todo: 1,
        blocked: 0,
        failed: 0,
        skipped: 0,
        completionPercent: 0,
        roundsCompleted: 1,
        maxAutoRounds: 8,
        elapsedMs: 1000,
        avgStepMs: 0,
        estimatedRemainingMs: 0,
        dryRun: false
      }
    }
  };
  const o = JSON.parse(chatPanelSig(snap, "", { entries: [] }, null));
  assert.equal(o.mid, "m1");
  assert.equal(o.ft, "Fix bug");
  assert.equal(o.fs, "running");
  assert.ok(o.pst.startsWith("0|"));
});

test("formatMissionProgressStatsLineHtml and progressStatsFingerprint", async () => {
  const { formatMissionProgressStatsLineHtml } = await import(mediaChatUrl("missionProgressDashboard.js"));
  const { progressStatsFingerprint } = await import(mediaChatUrl("webviewSignatures.js"));
  const esc = (s) => s;
  const stats = {
    total: 4,
    done: 1,
    running: 1,
    todo: 1,
    blocked: 0,
    failed: 0,
    skipped: 1,
    completionPercent: 50,
    roundsCompleted: 2,
    maxAutoRounds: 10,
    elapsedMs: 1000,
    avgStepMs: 5000,
    estimatedRemainingMs: 25000,
    dryRun: false
  };
  const html = formatMissionProgressStatsLineHtml(stats, esc);
  assert.match(html, /50%/);
  assert.match(html, /2\/4 closed/);
  assert.match(html, /1 running/);
  assert.match(html, /pass 2\/10/);
  assert.match(html, /25s est/);
  assert.equal(formatMissionProgressStatsLineHtml(undefined, esc), "");
  assert.equal(formatMissionProgressStatsLineHtml({ total: 0 }, esc), "");
  const dry = { ...stats, dryRun: true, estimatedRemainingMs: 0, avgStepMs: 0 };
  assert.match(formatMissionProgressStatsLineHtml(dry, esc), /dry run/);
  const fp = progressStatsFingerprint("m1", { m1: stats });
  assert.match(fp, /^50\|/);
});

test("missionReportInspectorCacheSig and missionInspectorSig: frs + rmc", async () => {
  const { composeMissionsForMissionList } = await import(mediaChatUrl("missionQuickFilters.js"));
  const { missionInspectorSig, missionReportInspectorCacheSig } = await import(mediaChatUrl("webviewSignatures.js"));
  const run = {
    id: "r",
    status: "running",
    title: "r",
    queue: [{ id: "w1", title: "W", role: "implementer", status: "running", prompt: "p" }],
    approvals: [],
    events: [],
    checkpoints: [],
    memory: [],
    updatedAt: 1,
    routing: { preset: "default" },
    policy: { policyPreset: "custom" },
    activeProviderId: "p",
    activeModel: "m",
    currentStep: 0,
    validationState: "pending"
  };
  const snap = {
    missions: [run],
    focusedMission: run,
    focusedMissionId: "r",
    focusedMissionReportSummary: {
      filesModifiedCount: 2,
      errorPatternCount: 1,
      completionPercent: 50,
      retriedItems: 0,
      deadLetterItems: 0
    },
    missionList: { includeArchived: false, totalCount: 1, archivedCount: 0 },
    defaultModel: "dm"
  };
  const composed = composeMissionsForMissionList(snap.missions, "all");
  const ins0 = JSON.parse(missionInspectorSig(snap, "all", composed, ""));
  assert.equal(ins0.frs, "50|2|1|0|0");
  assert.equal(ins0.rmc, "");
  const rmc = missionReportInspectorCacheSig("r", { missionId: "r", markdown: "abc" });
  assert.equal(rmc, "r:3");
  const ins1 = JSON.parse(missionInspectorSig(snap, "all", composed, rmc));
  assert.equal(ins1.rmc, "r:3");
});

test("missionsListPanelSig: includes per-row downstream gating card hint (dgh)", async () => {
  const { missionsListPanelSig } = await import(mediaChatUrl("webviewSignatures.js"));
  const snap = {
    missions: [
      { id: "m1", title: "m1", status: "blocked", queue: [], approvals: [], events: [], checkpoints: [], memory: [], updatedAt: 1 },
      { id: "m2", title: "m2", status: "running", queue: [], approvals: [], events: [], checkpoints: [], memory: [], updatedAt: 2 }
    ],
    focusedMissionId: "m2",
    missionList: { includeArchived: false, totalCount: 2, archivedCount: 0 },
    missionDownstreamGatingCardHints: { m1: "Implementer blocked: approval required" }
  };
  const sig = JSON.parse(missionsListPanelSig(snap, "all", snap.missions));
  assert.equal(sig.dqh, "");
  assert.equal(sig.fls, "");
  const r1 = sig.rows.find((r) => r.id === "m1");
  const r2 = sig.rows.find((r) => r.id === "m2");
  assert.equal(r1.dgh, "Implementer blocked: approval required");
  assert.equal(r2.dgh, "");
  assert.equal(r1.loah, "");
  assert.equal(r2.loah, "");
});

test("missionsListPanelSig: non-empty loah when snapshot provides list headline map", async () => {
  const { missionsListPanelSig } = await import(mediaChatUrl("webviewSignatures.js"));
  const snap = {
    missions: [
      {
        id: "loah-m1",
        title: "With headline",
        status: "queued",
        queue: [],
        approvals: [],
        events: [],
        checkpoints: [],
        memory: [],
        updatedAt: 1
      },
      {
        id: "loah-m2",
        title: "No headline",
        status: "running",
        queue: [],
        approvals: [],
        events: [],
        checkpoints: [],
        memory: [],
        updatedAt: 2
      }
    ],
    focusedMissionId: "loah-m2",
    missionList: { includeArchived: false, totalCount: 2, archivedCount: 0 },
    missionListLatestOperatorActionHeadlines: { "loah-m1": "Resume: joined active pass" }
  };
  const sig = JSON.parse(missionsListPanelSig(snap, "all", snap.missions));
  const withHeadline = sig.rows.find((r) => r.id === "loah-m1");
  const without = sig.rows.find((r) => r.id === "loah-m2");
  assert.equal(withHeadline.loah, "Resume: joined active pass");
  assert.equal(without.loah, "");
});

test("missionBulkVisibleCandidates: scoped to composed visible list", async () => {
  const { composeMissionsForMissionList } = await import(mediaChatUrl("missionQuickFilters.js"));
  const { computeVisibleBulkMissionCandidates } = await import(mediaChatUrl("missionBulkVisibleCandidates.js"));
  const base = { title: "t", queue: [], approvals: [], events: [], checkpoints: [], updatedAt: 0 };
  const mk = (id, o) => ({ ...base, id, ...o });

  const completedMix = [
    mk("c1", { status: "completed" }),
    mk("c2", { status: "completed", archivedAt: 99 }),
    mk("run", { status: "running" })
  ];
  const compOnly = composeMissionsForMissionList(completedMix, "completed");
  let bulk = computeVisibleBulkMissionCandidates(compOnly);
  assert.deepEqual(bulk.archiveCompletedIds, ["c1"]);
  assert.equal(bulk.counts.archiveCompleted, 1);

  const needs = [
    mk("blk", { status: "blocked" }),
    mk("fail", { status: "failed" }),
    mk("can", { status: "cancelled" })
  ];
  const needsFiltered = composeMissionsForMissionList(needs, "needs_attention");
  bulk = computeVisibleBulkMissionCandidates(needsFiltered);
  assert.deepEqual(bulk.deleteBlockedIds, ["blk"]);
  assert.ok(!bulk.deleteFailedOrCancelledIds.includes("blk"));
  assert.ok(bulk.deleteFailedOrCancelledIds.includes("fail"));
  assert.ok(bulk.deleteFailedOrCancelledIds.includes("can"));

  const fcMix = composeMissionsForMissionList(
    [mk("blk", { status: "blocked" }), mk("fail", { status: "failed" })],
    "needs_attention"
  );
  bulk = computeVisibleBulkMissionCandidates(fcMix);
  assert.ok(!bulk.deleteFailedOrCancelledIds.includes("blk"));

  const activeMix = composeMissionsForMissionList(
    [mk("run", { status: "running" }), mk("q", { status: "queued" }), mk("done", { status: "completed" })],
    "active"
  );
  bulk = computeVisibleBulkMissionCandidates(activeMix);
  assert.equal(bulk.counts.archiveCompleted, 0);
  assert.equal(bulk.counts.deleteFailedOrCancelled, 0);
  assert.equal(bulk.counts.deleteBlocked, 0);

  const composed = composeMissionsForMissionList(
    [mk("b", { status: "blocked" }), mk("f", { status: "failed" })],
    "all"
  );
  bulk = computeVisibleBulkMissionCandidates(composed);
  assert.equal(bulk.counts.deleteBlocked, composed.filter((m) => m.status === "blocked").length);
  assert.equal(
    bulk.counts.deleteFailedOrCancelled,
    composed.filter((m) => m.status === "failed" || m.status === "cancelled").length
  );
});

test("missionEventLabels: unknown message is primary-only (no false detail)", async () => {
  const { describeMissionEventMessage, formatMissionEventMessageHtml } = await import(mediaChatUrl("missionEventLabels.js"));
  const raw = "Totally custom operator message xyz";
  const d = describeMissionEventMessage(raw);
  assert.equal(d.primary, raw);
  assert.equal(d.detail, undefined);
  const html = formatMissionEventMessageHtml(raw, (s) => s);
  assert.ok(html.includes(raw));
  assert.ok(!html.includes("mission-event-raw"));
});

test("missionEventLabels: mapped message HTML includes raw subline", async () => {
  const { formatMissionEventMessageHtml } = await import(mediaChatUrl("missionEventLabels.js"));
  const raw = "Run reached maxStepsPerRun. Mission remains resumable.";
  const html = formatMissionEventMessageHtml(raw, (s) => s);
  assert.ok(html.includes("mission-event-primary"));
  assert.ok(html.includes("mission-event-raw"));
  assert.ok(html.includes(raw));
});

test("missionMemoryLabels: apply_patch_noop prefix maps with raw preserved", async () => {
  const { describeMissionMemoryText, formatMissionMemoryTextHtml } = await import(mediaChatUrl("missionMemoryLabels.js"));
  const raw = "[apply_patch_noop] applyPatch: No-op: search text not found but replace content already present in /x";
  const d = describeMissionMemoryText(raw);
  assert.match(d.primary, /Patch not needed/i);
  assert.equal(d.detail, raw);
  const html = formatMissionMemoryTextHtml(raw, (s) => s);
  assert.ok(html.includes("mission-memory-raw"));
  assert.ok(html.includes(raw));
});

test("missionMemoryLabels: stale patch recovery memory line", async () => {
  const { describeMissionMemoryText } = await import(mediaChatUrl("missionMemoryLabels.js"));
  const { OPERATOR_FREE_TEXT } = await import(mediaChatUrl("missionOperatorLabelsCore.js"));
  const raw =
    "applyPatch: Search text not found in README.md [stale_patch_but_goal_already_met: validation already passed, patch skipped]";
  const d = describeMissionMemoryText(raw);
  assert.equal(d.primary, OPERATOR_FREE_TEXT.stalePatchGoalMet);
  assert.equal(d.detail, raw);
});

test("missionMemoryLabels: already_satisfied prefix", async () => {
  const { describeMissionMemoryText } = await import(mediaChatUrl("missionMemoryLabels.js"));
  const raw = "[already_satisfied] ok\n\nALREADY_SATISFIED: done";
  const d = describeMissionMemoryText(raw);
  assert.match(d.primary, /already satisfied/i);
  assert.equal(d.detail, raw);
});

test("missionMemoryLabels: unknown text is single body, no raw subline", async () => {
  const { describeMissionMemoryText, formatMissionMemoryTextHtml } = await import(mediaChatUrl("missionMemoryLabels.js"));
  const raw = "finding: something idiosyncratic";
  const d = describeMissionMemoryText(raw);
  assert.equal(d.primary, raw);
  assert.equal(d.detail, undefined);
  const html = formatMissionMemoryTextHtml(raw, (s) => s);
  assert.ok(html.includes("mission-memory-body"));
  assert.ok(!html.includes("mission-memory-raw"));
});

test("missionMemoryLabels: delegates maxSteps line to event helper", async () => {
  const { describeMissionMemoryText } = await import(mediaChatUrl("missionMemoryLabels.js"));
  const raw = "Run reached maxStepsPerRun. Mission remains resumable.";
  const d = describeMissionMemoryText(raw);
  assert.match(d.primary, /step limit/i);
  assert.equal(d.detail, raw);
});

test("missionMemoryLabels: policy blocked tool execution substring", async () => {
  const { describeMissionMemoryText } = await import(mediaChatUrl("missionMemoryLabels.js"));
  const raw = "summary\n\nPolicy blocked tool execution: applyPatch: denied";
  const d = describeMissionMemoryText(raw);
  assert.match(d.primary, /policy/i);
  assert.equal(d.detail, raw);
});

test("missionMemoryLabels: tool execution failed substring", async () => {
  const { describeMissionMemoryText } = await import(mediaChatUrl("missionMemoryLabels.js"));
  const raw = "model out\n\nTool execution failed: readFile: ENOENT";
  const d = describeMissionMemoryText(raw);
  assert.match(d.primary, /tool run failed/i);
  assert.equal(d.detail, raw);
});

test("missionQueueProgressSummary: mixed queue counts and card includes special kinds", async () => {
  const {
    computeQueueProgressStats,
    formatMissionCardQueueProgressHtml,
    formatInspectorQueueProgressHtml
  } = await import(mediaChatUrl("missionQueueProgressSummary.js"));
  const queue = [
    { status: "done", completionKind: "already_satisfied" },
    { status: "done", completionKind: "apply_patch_noop" },
    { status: "done" },
    { status: "done" },
    { status: "todo" },
    { status: "running" },
    { status: "skipped" },
    { status: "blocked" }
  ];
  const s = computeQueueProgressStats(queue);
  assert.equal(s.total, 8);
  assert.equal(s.resolved, 5);
  assert.equal(s.pending, 2);
  assert.equal(s.donePlain, 2);
  assert.equal(s.doneAlreadySatisfied, 1);
  assert.equal(s.donePatchNoop, 1);
  assert.equal(s.skipped, 1);
  const card = formatMissionCardQueueProgressHtml(s, (x) => x);
  assert.match(card, /5\/8 resolved/);
  assert.match(card, /2 pending/);
  assert.match(card, /already satisfied/);
  assert.match(card, /patch noop/);
  assert.match(card, /blocked/);
  const ins = formatInspectorQueueProgressHtml(s, (x) => x);
  assert.match(ins, /5 resolved \/ 8 total/);
  assert.match(ins, /2 standard/);
  assert.match(ins, /1 already satisfied/);
  assert.match(ins, /1 patch noop/);
  assert.match(ins, /1 skipped/);
  assert.match(ins, /1 todo/);
  assert.match(ins, /1 running/);
});

test("missionQueueCurrentNext: running item is current", async () => {
  const { describeMissionCurrentNext } = await import(mediaChatUrl("missionQueueCurrentNext.js"));
  const d = describeMissionCurrentNext([
    { id: "x", status: "running", role: "validator", title: "Required validation before completion" }
  ]);
  assert.ok(d?.current);
  assert.equal(d.current.role, "validator");
  assert.match(d.current.title, /validation/i);
});

test("missionQueueCurrentNext: eligible todo is next when nothing running", async () => {
  const { describeMissionCurrentNext } = await import(mediaChatUrl("missionQueueCurrentNext.js"));
  const d = describeMissionCurrentNext([
    { id: "1", status: "done", role: "planner", title: "Plan" },
    { id: "2", status: "todo", role: "reviewer", title: "Review latest implementation" }
  ]);
  assert.ok(d?.next);
  assert.equal(d.next.role, "reviewer");
  assert.equal(d.current, undefined);
});

test("missionQueueCurrentNext: blocked item without running shows paused on, not next", async () => {
  const { describeMissionCurrentNext } = await import(mediaChatUrl("missionQueueCurrentNext.js"));
  const d = describeMissionCurrentNext([
    { id: "1", status: "todo", role: "reviewer", title: "Later" },
    { id: "2", status: "blocked", role: "implementer", title: "Fix remaining diagnostics" }
  ]);
  assert.ok(d?.pausedOn);
  assert.equal(d.pausedOn.role, "implementer");
  assert.equal(d.next, undefined);
});

test("missionQueueCurrentNext: no unresolved work omits describe", async () => {
  const { describeMissionCurrentNext } = await import(mediaChatUrl("missionQueueCurrentNext.js"));
  assert.equal(describeMissionCurrentNext([{ status: "done" }, { status: "skipped" }]), null);
});

test("missionQueueCurrentNext: todo with unsatisfied deps shows note, not false next claim", async () => {
  const { describeMissionCurrentNext } = await import(mediaChatUrl("missionQueueCurrentNext.js"));
  const d = describeMissionCurrentNext([
    { id: "b", status: "todo", role: "implementer", title: "Fix", dependsOn: ["missing-id"] }
  ]);
  assert.equal(d?.next, undefined);
  assert.ok(d?.dependencyBlocked);
  assert.equal(d?.dependencyBlocked?.role, "implementer");
});

test("missionQueueCurrentNext: later runnable todo is shown instead of earlier dependency-blocked todo", async () => {
  const { describeMissionCurrentNext } = await import(mediaChatUrl("missionQueueCurrentNext.js"));
  const d = describeMissionCurrentNext([
    { id: "a", status: "todo", role: "reviewer", title: "Blocked by dependency", dependsOn: ["missing-id"] },
    { id: "b", status: "todo", role: "implementer", title: "Runnable now" }
  ]);
  assert.equal(d?.dependencyBlocked, undefined);
  assert.equal(d?.next?.role, "implementer");
  assert.match(d?.next?.title || "", /Runnable now/);
});

test("missionQueueCurrentNext formatting: dependency-blocked item is not labeled as next", async () => {
  const { formatMissionCardCurrentNextHtml, formatInspectorCurrentNextHtml } = await import(
    mediaChatUrl("missionQueueCurrentNext.js")
  );
  const desc = {
    dependencyBlocked: { role: "reviewer", title: "Review latest implementation", text: "reviewer — Review latest implementation" }
  };
  const card = formatMissionCardCurrentNextHtml(desc, (x) => x);
  const inspector = formatInspectorCurrentNextHtml(desc, (x) => x);
  assert.match(card, /Waiting on dependency:/);
  assert.doesNotMatch(card, /Next:/);
  assert.match(inspector, /Waiting on dependency:/);
  assert.doesNotMatch(inspector, /Next step:/);
});

test("missionQueueProgressSummary: empty queue and no includes line when no special kinds", async () => {
  const { computeQueueProgressStats, formatMissionCardQueueProgressHtml } = await import(mediaChatUrl("missionQueueProgressSummary.js"));
  const s0 = computeQueueProgressStats([]);
  assert.equal(s0.total, 0);
  const card0 = formatMissionCardQueueProgressHtml(s0, (x) => x);
  assert.match(card0, /empty queue/);
  const s1 = computeQueueProgressStats([{ status: "done" }, { status: "todo" }]);
  const card1 = formatMissionCardQueueProgressHtml(s1, (x) => x);
  assert.match(card1, /1\/2 resolved/);
  assert.match(card1, /1 pending/);
  assert.ok(!card1.includes("Includes:"));
});

test("missionQueueProgressSummary: issues stay visible when queue has only resolved rows plus a blocker", async () => {
  const { computeQueueProgressStats, formatInspectorQueueProgressHtml } = await import(mediaChatUrl("missionQueueProgressSummary.js"));
  const s = computeQueueProgressStats([
    { status: "done", completionKind: "already_satisfied" },
    { status: "skipped" },
    { status: "blocked" }
  ]);
  assert.equal(s.resolved, 2);
  assert.equal(s.pending, 0);
  assert.equal(s.issueCount, 1);
  const inspector = formatInspectorQueueProgressHtml(s, (x) => x);
  assert.match(inspector, /Open: none/);
  assert.match(inspector, /Issues: 1 blocked, 0 failed/);
});

test("mergeModelLists: merges live + preset model ids", async () => {
  const { mergeModelLists } = await import(mediaChatUrl("webviewModelLists.js"));
  const snap = {
    providerLiveModelCatalog: {
      p1: { models: ["a", "b"], modelsDisplay: ["a", "b"], source: "live", at: 1 }
    },
    providerModelPresets: { p1: ["b", "c"] }
  };
  const { merged } = mergeModelLists(snap, "p1");
  assert.deepEqual(merged, ["a", "b", "c"]);
});

test("mergeModelLists: picker prefers modelsDisplay shortlist over full catalog", async () => {
  const { mergeModelLists } = await import(mediaChatUrl("webviewModelLists.js"));
  const snap = {
    providerLiveModelCatalog: {
      p1: { models: ["z", "y", "x"], modelsDisplay: ["x", "y"], source: "live", at: 1 }
    },
    providerModelPresets: { p1: [] }
  };
  const { merged, catalogTotal, pickerShortlistLen } = mergeModelLists(snap, "p1");
  assert.deepEqual(merged, ["x", "y"]);
  assert.equal(catalogTotal, 3);
  assert.equal(pickerShortlistLen, 2);
});

test("fillModelSelect: appends placeholder plus one option per model id", async () => {
  const { fillModelSelect } = await import(mediaChatUrl("webviewModelLists.js"));
  const appended = [];
  const sel = {
    tagName: "SELECT",
    appendChild(node) {
      appended.push(node);
    },
    set textContent(_) {
      appended.length = 0;
    },
    _v: "",
    get value() {
      return this._v;
    },
    set value(v) {
      this._v = v;
    }
  };
  const prevDoc = globalThis.document;
  globalThis.document = {
    createElement() {
      return { value: "", textContent: "" };
    }
  };
  try {
    fillModelSelect(sel, ["alpha", "beta"], { preserveValue: "", emptyLabel: "pick" });
    assert.equal(appended.length, 3, "empty row + 2 models");
    assert.equal(appended[0].value, "");
    assert.equal(appended[1].value, "alpha");
    assert.equal(appended[2].value, "beta");
  } finally {
    globalThis.document = prevDoc;
  }
});

test("fillProviderModelCatalogList: list buttons match model ids; empty hint when no ids", async () => {
  const { fillProviderModelCatalogList } = await import(mediaChatUrl("webviewModelLists.js"));
  const rows = [];
  const ulEl = {
    set textContent(_) {
      rows.length = 0;
    },
    appendChild(li) {
      rows.push(li);
    }
  };
  const emptyEl = { hidden: true };
  const prevDoc = globalThis.document;
  globalThis.document = {
    createElement() {
      return {
        type: "",
        textContent: "",
        dataset: {},
        _kids: [],
        appendChild(c) {
          this._kids.push(c);
        },
        setAttribute() {}
      };
    }
  };
  try {
    fillProviderModelCatalogList(ulEl, emptyEl, []);
    assert.equal(emptyEl.hidden, false);
    assert.equal(rows.length, 0);

    fillProviderModelCatalogList(ulEl, emptyEl, ["m1", "m2"]);
    assert.equal(emptyEl.hidden, true);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]._kids[0].dataset.model, "m1");
    assert.equal(rows[1]._kids[0].dataset.model, "m2");
  } finally {
    globalThis.document = prevDoc;
  }
});

test("syncProviderAwareModelPicker: provider-aware catalog list stays aligned with selected provider", async () => {
  const { syncProviderAwareModelPicker } = await import(mediaChatUrl("webviewModelPicker.js"));
  const { mergeModelLists, fillProviderModelCatalogList } = await import(mediaChatUrl("webviewModelLists.js"));
  const rows = [];
  const prevDoc = globalThis.document;
  globalThis.document = {
    createElement() {
      return {
        type: "",
        textContent: "",
        dataset: {},
        _kids: [],
        appendChild(c) {
          this._kids.push(c);
        },
        setAttribute(k, v) {
          this[k] = v;
        }
      };
    }
  };
  try {
    const snapshot = minimalSidebarSnapshot();
    snapshot.providers = ["openai", "ollama"];
    snapshot.defaultProvider = "openai";
    snapshot.providerModelPresets = {
      openai: ["gpt-4.1-mini"],
      ollama: ["llama3.1"]
    };
    snapshot.providerLiveModelCatalog = {
      openai: { models: ["gpt-4.1", "gpt-4.1-mini"], modelsDisplay: ["gpt-4.1"], source: "live", at: 1 },
      ollama: { models: ["qwen2.5-coder", "llama3.1"], modelsDisplay: ["qwen2.5-coder"], source: "cache", at: 2 }
    };
    const inputEl = { dataset: {} };
    const buttonEl = { dataset: {}, setAttribute(k, v) { this[k] = v; } };
    const popoverEl = { hidden: false };
    const emptyEl = { hidden: true };
    const listEl = {
      set textContent(_) {
        rows.length = 0;
      },
      appendChild(li) {
        rows.push(li);
      }
    };
    const out = syncProviderAwareModelPicker({
      snapshot,
      providerId: "ollama",
      inputEl,
      buttonEl,
      popoverEl,
      listEl,
      emptyEl,
      mergeModelLists,
      fillProviderModelCatalogList
    });
    assert.deepEqual(out.merged, ["qwen2.5-coder", "llama3.1"]);
    assert.equal(buttonEl.dataset.providerId, "ollama");
    assert.equal(inputEl.dataset.providerId, "ollama");
    assert.equal(popoverEl.hidden, true);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]._kids[0].dataset.model, "qwen2.5-coder");
  } finally {
    globalThis.document = prevDoc;
  }
});

test("ESM: webview helper modules load (excluding main.js bootstrap)", async () => {
  const files = [
    "webviewFormat.js",
    "webviewConstants.js",
    "missionCompletionLabels.js",
    "missionOperatorLabelsCore.js",
    "missionStatusPresentation.js",
    "missionListSort.js",
    "missionQuickFilters.js",
    "missionBulkVisibleCandidates.js",
    "missionQueueProgressSummary.js",
    "missionQueueCurrentNext.js",
    "missionProgressDashboard.js",
    "missionEventLabels.js",
    "missionMemoryLabels.js",
    "webviewSignatures.js",
    "webviewSigCache.js",
    "webviewModelLists.js",
    "webviewModelPicker.js",
    "webviewTraceAndPersist.js",
    "webviewRenderMissions.js",
    "webviewPanelBundle.js",
    "webviewTabController.js",
    "webviewSnapshotApply.js",
    "webviewMessageHandler.js",
    "webviewDomWire.js"
  ];
  for (const f of files) {
    const mod = await import(mediaChatUrl(f));
    assert.ok(mod && typeof mod === "object", `${f} exports an object`);
  }
});

test("createMessageHandler: init, snapshot, snapshotSection x4, chatChunk, memorySearchResults", async () => {
  const { createMessageHandler } = await import(mediaChatUrl("webviewMessageHandler.js"));
  const snap = minimalSidebarSnapshot();
  const calls = [];
  const state = {
    lastSnapshotPublishSeq: null,
    lastAppliedMissionsSectionSeq: 0,
    lastAppliedAuxiliarySectionSeq: 0,
    lastAppliedProviderChromeSectionSeq: 0,
    lastAppliedGlobalMemorySectionSeq: 0,
    memorySearchResults: [],
    chatBuffer: "",
    chatHistory: mockChatHistory(),
    activeTab: "chat",
    snapshot: null,
    missionReportCache: null,
    dirty: { quickSettings: false, providersForm: false, chatRow: false, routingPanel: false }
  };
  const handler = createMessageHandler({
    state,
    els: { chatPrompt: { focus: () => calls.push("focus") } },
    emitHostTrace: () => {},
    renderTraceLogSnapshot: () => calls.push("traceLog"),
    applyMissionSectionSnapshot: () => calls.push("missionSection"),
    applyAuxiliarySectionSnapshot: () => calls.push("auxiliary"),
    applyProviderChromeSectionSnapshot: () => calls.push("providerChrome"),
    applyGlobalMemorySectionSnapshot: () => calls.push("globalMemory"),
    renderSnapshot: () => calls.push("renderSnapshot"),
    renderChat: () => calls.push("renderChat"),
    renderMemory: () => calls.push("renderMemory"),
    renderMissions: () => calls.push("renderMissions"),
    updateQuickDirtyBadge: () => calls.push("quickBadge"),
    updateProvidersDirtyBadge: () => calls.push("provBadge"),
    setActiveTab: (t) => calls.push(`tab:${t}`)
  });

  handler({ data: { type: "snapshot", snapshot: snap } });
  assert.ok(calls.includes("renderSnapshot"));

  calls.length = 0;
  handler({ data: { type: "init", snapshot: snap } });
  assert.ok(calls.includes("renderSnapshot") && calls.includes("tab:chat"));

  state.lastSnapshotPublishSeq = 42;
  calls.length = 0;
  handler({
    data: {
      type: "snapshotSection",
      section: "missions",
      snapshot: snap,
      sectionSeq: 1,
      sectionBasePublishSeq: 42
    }
  });
  assert.ok(calls.includes("missionSection"));

  calls.length = 0;
  handler({
    data: {
      type: "snapshotSection",
      section: "missions",
      snapshot: snap,
      sectionSeq: 0,
      sectionBasePublishSeq: 42
    }
  });
  assert.ok(!calls.includes("missionSection"));

  calls.length = 0;
  state.lastAppliedAuxiliarySectionSeq = 0;
  handler({
    data: {
      type: "snapshotSection",
      section: "auxiliary",
      snapshot: snap,
      sectionSeq: 1,
      sectionBasePublishSeq: 42
    }
  });
  assert.ok(calls.includes("auxiliary"));

  calls.length = 0;
  state.lastAppliedProviderChromeSectionSeq = 0;
  handler({
    data: {
      type: "snapshotSection",
      section: "providerChrome",
      snapshot: snap,
      sectionSeq: 1,
      sectionBasePublishSeq: 42
    }
  });
  assert.ok(calls.includes("providerChrome"));

  calls.length = 0;
  state.lastAppliedGlobalMemorySectionSeq = 0;
  handler({
    data: {
      type: "snapshotSection",
      section: "globalMemory",
      snapshot: snap,
      sectionSeq: 1,
      sectionBasePublishSeq: 42
    }
  });
  assert.ok(calls.includes("globalMemory"));

  state.snapshot = snap;
  calls.length = 0;
  handler({ data: { type: "chatChunk", text: "x" } });
  assert.equal(state.chatBuffer, "x");
  assert.ok(calls.includes("renderChat"));

  calls.length = 0;
  handler({ data: { type: "chatDone" } });
  assert.ok(calls.includes("renderChat"));

  calls.length = 0;
  handler({
    data: { type: "memorySearchResults", query: "q", results: [{ id: "1", ts: 1, kind: "k", text: "t" }] }
  });
  assert.ok(calls.includes("renderMemory"));

  state.snapshot = snap;
  state.missionReportCache = null;
  calls.length = 0;
  handler({ data: { type: "missionReportReady", missionId: "m99", markdown: "# Report\n" } });
  assert.equal(state.missionReportCache?.missionId, "m99");
  assert.ok(String(state.missionReportCache?.markdown || "").includes("Report"));
  assert.ok(calls.includes("renderMissions"));
});

test("createMessageHandler: error messages surface mission action status for visible failure feedback", async () => {
  const { createMessageHandler } = await import(mediaChatUrl("webviewMessageHandler.js"));
  const missionActionStatus = mockEl();
  globalThis.document = {
    getElementById: (id) => (id === "missionActionStatus" ? missionActionStatus : mockEl())
  };
  const state = {
    lastSnapshotPublishSeq: null,
    lastAppliedMissionsSectionSeq: 0,
    lastAppliedAuxiliarySectionSeq: 0,
    lastAppliedProviderChromeSectionSeq: 0,
    lastAppliedGlobalMemorySectionSeq: 0,
    memorySearchResults: [],
    chatBuffer: "",
    chatHistory: mockChatHistory(),
    activeTab: "chat",
    snapshot: minimalSidebarSnapshot(),
    missionReportCache: null,
    dirty: { quickSettings: false, providersForm: false, chatRow: false, routingPanel: false }
  };
  const handler = createMessageHandler({
    state,
    els: { chatPrompt: mockEl() },
    emitHostTrace: () => {},
    renderTraceLogSnapshot: () => {},
    applyMissionSectionSnapshot: () => {},
    applyAuxiliarySectionSnapshot: () => {},
    applyProviderChromeSectionSnapshot: () => {},
    applyGlobalMemorySectionSnapshot: () => {},
    renderSnapshot: () => {},
    renderChat: () => {},
    renderMemory: () => {},
    renderMissions: () => {},
    updateQuickDirtyBadge: () => {},
    updateProvidersDirtyBadge: () => {},
    setActiveTab: () => {}
  });

  handler({ data: { type: "error", message: "Mission start requires a prompt." } });
  assert.equal(missionActionStatus.textContent, "Mission start requires a prompt.");
  assert.match(state.chatBuffer, /Mission start requires a prompt\./);
});

test("createSnapshotApply: renderSnapshot invokes renderMissions before chat (order)", async () => {
  const { createSnapshotApply } = await import(mediaChatUrl("webviewSnapshotApply.js"));
  const { createPanelSigCache } = await import(mediaChatUrl("webviewSigCache.js"));
  const { escapeHtml } = await import(mediaChatUrl("webviewFormat.js"));
  const order = [];
  const snap = minimalSidebarSnapshot();
  const els = {
    summaryMissions: mockEl(),
    summaryApprovals: mockEl(),
    summaryProvider: mockEl(),
    summaryModel: mockEl(),
    globalMemory: mockEl()
  };
  globalThis.document = {
    querySelector: () => ({ classList: { contains: () => true } }),
    querySelectorAll: () => ({ forEach: () => {} })
  };
  const api = createSnapshotApply({
    state: {
      snapshot: null,
      lastSnapshotPublishSeq: null,
      traceSessionId: null,
      activeTab: "chat",
      traceAutoRefreshIntervalMs: 10000,
      lastAppliedMissionsSectionSeq: 0,
      lastAppliedAuxiliarySectionSeq: 0,
      lastAppliedProviderChromeSectionSeq: 0,
      lastAppliedGlobalMemorySectionSeq: 0,
      lastIncludeArchivedApplied: null,
      lastMissionCountApplied: null
    },
    els,
    sigCache: createPanelSigCache(),
    emitHostTrace: () => {},
    trace: () => {},
    escapeHtml,
    setActiveTab: () => {},
    renderMissions: () => order.push("missions"),
    syncChatProviderRow: () => order.push("syncChat"),
    renderRouting: () => order.push("routing"),
    renderApprovals: () => order.push("approvals"),
    renderBundles: () => order.push("bundles"),
    renderTimeline: () => order.push("timeline"),
    renderAgents: () => order.push("agents"),
    renderTools: () => order.push("tools"),
    renderMemory: () => order.push("memory"),
    renderConsole: () => order.push("console"),
    renderChat: () => order.push("chat"),
    renderProvidersPanel: () => order.push("providers"),
    renderSettings: () => order.push("settings")
  });
  api.renderSnapshot(snap, {});
  const mi = order.indexOf("missions");
  const ch = order.indexOf("chat");
  assert.ok(mi !== -1 && ch !== -1 && mi < ch, `order: ${order.join(",")}`);
});

test("createTabController: trace tab posts requestTraceLog", async () => {
  const { createTabController } = await import(mediaChatUrl("webviewTabController.js"));
  const posted = [];
  const tabEls = [
    { dataset: { tab: "chat" }, classList: { toggle: () => {} } },
    { dataset: { tab: "trace" }, classList: { toggle: () => {} } }
  ];
  globalThis.document = {
    querySelectorAll: (sel) => (sel === ".tab" ? tabEls : []),
    getElementById: (id) => (id === "traceAutoRefresh" ? { checked: false } : null)
  };
  const state = { activeTab: "chat", snapshot: minimalSidebarSnapshot() };
  const { setActiveTab } = createTabController({
    vscode: { postMessage: (m) => posted.push(m) },
    state,
    trace: () => {},
    persistWebviewUiState: () => {},
    stopTraceAutoRefresh: () => {},
    startTraceAutoRefresh: () => {},
    renderProvidersPanel: () => {},
    renderSettings: () => {},
    renderMemory: () => {},
    renderTools: () => {},
    renderRouting: () => {},
    renderMissions: () => {},
    renderChat: () => {}
  });
  setActiveTab("trace");
  assert.equal(state.activeTab, "trace");
  const req = posted.find((m) => m.type === "requestTraceLog");
  assert.ok(req, `posted: ${JSON.stringify(posted)}`);
});

test("wireChatDomEvents: sendChat triggers post('sendChat', …)", async () => {
  const { wireChatDomEvents } = await import(mediaChatUrl("webviewDomWire.js"));
  const posted = [];
  globalThis.document = {
    body: { addEventListener: () => {} },
    getElementById: () => mockEl(),
    querySelectorAll: () => ({ forEach: () => {} }),
    addEventListener: () => {}
  };
  const snap = minimalSidebarSnapshot();
  const chatPrompt = mockEl({ value: "hello smoke" });
  const sendChat = mockEl({
    addEventListener: (_, fn) => {
      sendChat._fn = fn;
    }
  });
  const els = {};
  const proxy = new Proxy(els, {
    get(t, p) {
      if (!t[p]) t[p] = mockEl();
      return t[p];
    }
  });
  proxy.chatPrompt = chatPrompt;
  proxy.sendChat = sendChat;

  wireChatDomEvents({
    vscode: {},
    state: {
      snapshot: snap,
      chatBuffer: "x",
      chatHistory: mockChatHistory(),
      dirty: { quickSettings: false, providersForm: false, chatRow: false, routingPanel: false },
      memorySearchResults: [],
      timelineFilterText: "",
      timelineFilterLevel: "all",
      timelineFocusedOnly: false,
      selectedApproval: null,
      selectedBundle: null,
      routingDraft: null
    },
    els: proxy,
    post: (type, extra = {}) => posted.push({ type, ...extra }),
    postWithInteractionId: (type, payload = {}) => posted.push({ type, ...payload }),
    setActiveTab: () => {},
    emitHostTrace: () => {},
    renderChat: () => {},
    renderApprovals: () => {},
    renderBundles: () => {},
    renderTimeline: () => {},
    renderMemory: () => {},
    renderProvidersPanel: () => {},
    renderSettings: () => {},
    syncChatProviderRow: () => {},
    mergeModelLists: () => ({ merged: [] }),
    renderRouting: () => {},
    updateQuickDirtyBadge: () => {},
    updateProvidersDirtyBadge: () => {},
    stopTraceAutoRefresh: () => {},
    startTraceAutoRefresh: () => {}
  });
  assert.ok(typeof sendChat._fn === "function");
  sendChat._fn();
  const send = posted.find((p) => p.type === "sendChat");
  assert.ok(send && send.prompt === "hello smoke");
});

test("createPanelRenderers: renderTools mutates toolSummary (MCP/tools path)", async () => {
  const { createPanelRenderers } = await import(mediaChatUrl("webviewPanelBundle.js"));
  const { createPanelSigCache } = await import(mediaChatUrl("webviewSigCache.js"));
  const { escapeHtml, mdToHtml, relTime } = await import(mediaChatUrl("webviewFormat.js"));
  const toolSummary = mockEl();
  const state = {
    selectedApproval: null,
    selectedBundle: null,
    selectedHunkIndex: 0,
    routingDraft: null,
    dirty: { quickSettings: false, providersForm: false, chatRow: false, routingPanel: false },
    memorySearchResults: [],
    chatBuffer: "",
    chatHistory: mockChatHistory(),
    timelineFilterText: "",
    timelineFilterLevel: "all",
    timelineFocusedOnly: false
  };
  const panels = createPanelRenderers({
    state,
    els: { toolSummary },
    sigCache: createPanelSigCache(),
    escapeHtml,
    relTime,
    mdToHtml,
    post: () => {},
    mergeModelLists: () => ({ merged: [] }),
    fillModelSelect: () => {},
    fillProviderModelCatalogList: () => {}
  });
  panels.renderTools(minimalSidebarSnapshot());
  assert.ok(toolSummary.innerHTML.includes("MCP configuration"));
  assert.ok(toolSummary.innerHTML.includes("read"));
});

test("createPanelRenderers: chat and settings model pickers use provider-aware options", async () => {
  const { createPanelRenderers } = await import(mediaChatUrl("webviewPanelBundle.js"));
  const { createPanelSigCache } = await import(mediaChatUrl("webviewSigCache.js"));
  const { escapeHtml, mdToHtml, relTime } = await import(mediaChatUrl("webviewFormat.js"));
  const prevDoc = globalThis.document;
  const rows = { chat: [], settings: [] };
  const byId = {
    btnChatModelCatalog: { dataset: {}, setAttribute(k, v) { this[k] = v; } },
    chatModelCatalogPopover: { hidden: false },
    chatModelCatalogEmpty: { hidden: true },
    chatModelCatalogUl: {
      set textContent(_) { rows.chat.length = 0; },
      appendChild(li) { rows.chat.push(li); }
    },
    btnSettingDefaultModelCatalog: { dataset: {}, setAttribute(k, v) { this[k] = v; } },
    settingDefaultModelCatalogPopover: { hidden: false },
    settingDefaultModelCatalogEmpty: { hidden: true },
    settingDefaultModelCatalogUl: {
      set textContent(_) { rows.settings.length = 0; },
      appendChild(li) { rows.settings.push(li); }
    },
    settingDefaultProvider: {
      options: [],
      appendChild(opt) { this.options.push(opt); },
      value: ""
    },
    settingDefaultModel: { value: "", placeholder: "", dataset: {} },
    settingHeartbeatSeconds: { value: "" },
    settingAllowTerminal: { checked: false },
    settingRequireWriteApproval: { checked: false },
    settingAutoRevealOnActivation: { checked: false },
    settingDefaultTab: { value: "" },
    quickSettingsDirtyBadge: { hidden: true }
  };
  globalThis.document = {
    getElementById(id) {
      return byId[id] || null;
    },
    createElement() {
      return {
        value: "",
        textContent: "",
        dataset: {},
        _kids: [],
        appendChild(c) { this._kids.push(c); },
        setAttribute(k, v) { this[k] = v; }
      };
    }
  };
  try {
    const state = {
      selectedApproval: null,
      selectedBundle: null,
      selectedHunkIndex: 0,
      routingDraft: null,
      dirty: { quickSettings: false, providersForm: false, chatRow: false, routingPanel: false },
      memorySearchResults: [],
      chatBuffer: "",
      chatHistory: mockChatHistory(),
      timelineFilterText: "",
      timelineFilterLevel: "all",
      timelineFocusedOnly: false
    };
    const snapshot = minimalSidebarSnapshot();
    snapshot.providers = ["openai", "ollama"];
    snapshot.providerModelPresets = {
      openai: ["gpt-4.1-mini"],
      ollama: ["llama3.1"]
    };
    snapshot.providerSavedModels = {
      openai: "gpt-4.1",
      ollama: "qwen2.5-coder"
    };
    snapshot.providerLiveModelCatalog = {
      openai: { models: ["gpt-4.1", "gpt-4.1-mini"], modelsDisplay: ["gpt-4.1"], source: "live", at: 1 },
      ollama: { models: ["qwen2.5-coder", "llama3.1"], modelsDisplay: ["qwen2.5-coder"], source: "cache", at: 2 }
    };
    snapshot.settings.defaultProvider = "ollama";
    snapshot.settings.defaultModel = "qwen2.5-coder";
    const els = {
      chatProviderSelect: { innerHTML: "", value: "", options: [] },
      chatModelInput: { value: "", placeholder: "", dataset: {} },
      settingsPanel: { innerHTML: "" }
    };
    const panels = createPanelRenderers({
      state,
      els,
      sigCache: createPanelSigCache(),
      escapeHtml,
      relTime,
      mdToHtml,
      post: () => {},
      mergeModelLists: (await import(mediaChatUrl("webviewModelLists.js"))).mergeModelLists,
      fillProviderModelCatalogList: (await import(mediaChatUrl("webviewModelLists.js"))).fillProviderModelCatalogList
    });
    panels.syncChatProviderRow(snapshot);
    assert.equal(rows.chat.length, 2);
    assert.equal(rows.chat[0]._kids[0].dataset.model, "gpt-4.1");
    assert.equal(byId.btnChatModelCatalog.dataset.providerId, "openai");

    panels.renderSettings(snapshot, { force: true });
    assert.match(els.settingsPanel.innerHTML, /Effective for provider/);
    assert.match(els.settingsPanel.innerHTML, /Autonomy mode/);
    assert.match(els.settingsPanel.innerHTML, /Blueprint mode/);
    assert.match(els.settingsPanel.innerHTML, /Edit mission settings in VS Code/);
    assert.equal(rows.settings.length, 2);
    assert.equal(rows.settings[0]._kids[0].dataset.model, "qwen2.5-coder");
    assert.equal(byId.btnSettingDefaultModelCatalog.dataset.providerId, "ollama");
  } finally {
    globalThis.document = prevDoc;
  }
});

test("createPanelRenderers: routing model pickers cover mission default plus per-role provider-aware options", async () => {
  const { createPanelRenderers } = await import(mediaChatUrl("webviewPanelBundle.js"));
  const { createPanelSigCache } = await import(mediaChatUrl("webviewSigCache.js"));
  const { escapeHtml, mdToHtml, relTime } = await import(mediaChatUrl("webviewFormat.js"));
  const { mergeModelLists, fillProviderModelCatalogList } = await import(mediaChatUrl("webviewModelLists.js"));
  const prevDoc = globalThis.document;
  const rows = { mission: [], planner: [], implementer: [] };
  const byId = {
    routingPanelMount: { innerHTML: "", querySelector: () => null },
    routingMissionDefProvider: { value: "", addEventListener: () => {} },
    routingMissionDefModel: { value: "", placeholder: "", dataset: {}, addEventListener: () => {} },
    btnRoutingMissionDefModelCatalog: { dataset: {}, setAttribute(k, v) { this[k] = v; } },
    routingMissionDefModelCatalogPopover: { hidden: false },
    routingMissionDefModelCatalogEmpty: { hidden: true },
    routingMissionDefModelCatalogUl: {
      set textContent(_) { rows.mission.length = 0; },
      appendChild(li) { rows.mission.push(li); }
    },
    routingPresetSelect: { value: "", addEventListener: () => {} },
    btnRevertMissionRouting: { addEventListener: () => {} },
    btnSaveMissionRouting: { addEventListener: () => {} },
    routingDirtyBadge: { hidden: true },
    "routingProv-0": { value: "", addEventListener: () => {} },
    "routingMod-0": { value: "", placeholder: "", dataset: {}, addEventListener: () => {} },
    "btnRoutingModelCatalog-0": { dataset: {}, setAttribute(k, v) { this[k] = v; } },
    "routingModelCatalogPopover-0": { hidden: false },
    "routingModelCatalogEmpty-0": { hidden: true },
    "routingModelCatalogUl-0": {
      set textContent(_) { rows.planner.length = 0; },
      appendChild(li) { rows.planner.push(li); }
    },
    "routingProv-2": { value: "", addEventListener: () => {} },
    "routingMod-2": { value: "", placeholder: "", dataset: {}, addEventListener: () => {} },
    "btnRoutingModelCatalog-2": { dataset: {}, setAttribute(k, v) { this[k] = v; } },
    "routingModelCatalogPopover-2": { hidden: false },
    "routingModelCatalogEmpty-2": { hidden: true },
    "routingModelCatalogUl-2": {
      set textContent(_) { rows.implementer.length = 0; },
      appendChild(li) { rows.implementer.push(li); }
    }
  };
  globalThis.document = {
    getElementById(id) {
      return byId[id] || null;
    },
    createElement() {
      return {
        value: "",
        textContent: "",
        dataset: {},
        _kids: [],
        appendChild(c) { this._kids.push(c); },
        setAttribute(k, v) { this[k] = v; }
      };
    }
  };
  try {
    const snapshot = minimalSidebarSnapshot();
    snapshot.providers = ["openai", "ollama"];
    snapshot.defaultProvider = "openai";
    snapshot.providerModelPresets = {
      openai: ["gpt-4.1-mini"],
      ollama: ["llama3.1"]
    };
    snapshot.providerLiveModelCatalog = {
      openai: { models: ["gpt-4.1", "gpt-4.1-mini"], modelsDisplay: ["gpt-4.1"], source: "live", at: 1 },
      ollama: { models: ["qwen2.5-coder", "llama3.1"], modelsDisplay: ["qwen2.5-coder"], source: "cache", at: 2 }
    };
    snapshot.focusedMission = {
      id: "m1",
      activeProviderId: "openai",
      activeModel: "gpt-4.1",
      routing: {
        preset: "custom",
        providerPerRole: { planner: "", implementer: "ollama" },
        modelPerRole: { planner: "", implementer: "" }
      }
    };
    const panels = createPanelRenderers({
      state: {
        routingDraft: null,
        dirty: { quickSettings: false, providersForm: false, chatRow: false, routingPanel: false },
        selectedApproval: null,
        selectedBundle: null,
        selectedHunkIndex: 0,
        memorySearchResults: [],
        chatBuffer: "",
        chatHistory: mockChatHistory(),
        timelineFilterText: "",
        timelineFilterLevel: "all",
        timelineFocusedOnly: false
      },
      els: {},
      sigCache: createPanelSigCache(),
      escapeHtml,
      relTime,
      mdToHtml,
      post: () => {},
      mergeModelLists,
      fillProviderModelCatalogList
    });
    panels.renderRouting(snapshot, { force: true });
    assert.match(byId.routingPanelMount.innerHTML, /btnRoutingMissionDefModelCatalog/);
    assert.match(byId.routingPanelMount.innerHTML, /btnRoutingModelCatalog-0/);
    assert.match(byId.routingPanelMount.innerHTML, /btnRoutingModelCatalog-2/);
    assert.equal(rows.mission[0]._kids[0].dataset.model, "gpt-4.1");
    assert.equal(rows.planner[0]._kids[0].dataset.model, "gpt-4.1");
    assert.equal(rows.implementer[0]._kids[0].dataset.model, "qwen2.5-coder");
    assert.equal(byId["btnRoutingModelCatalog-0"].dataset.providerId, "openai");
    assert.equal(byId["btnRoutingModelCatalog-2"].dataset.providerId, "ollama");
    assert.equal(byId["routingMod-0"].placeholder, "Inherit if empty");
    assert.equal(byId["routingMod-2"].placeholder, "Inherit if empty");
  } finally {
    globalThis.document = prevDoc;
  }
});

test("createPanelRenderers: routing provider changes clear stale model text and refresh provider-local options", async () => {
  const { createPanelRenderers } = await import(mediaChatUrl("webviewPanelBundle.js"));
  const { createPanelSigCache } = await import(mediaChatUrl("webviewSigCache.js"));
  const { escapeHtml, mdToHtml, relTime } = await import(mediaChatUrl("webviewFormat.js"));
  const { mergeModelLists, fillProviderModelCatalogList } = await import(mediaChatUrl("webviewModelLists.js"));
  const prevDoc = globalThis.document;
  const rows = { mission: [], planner: [] };
  const listeners = {};
  const byId = {
    routingPanelMount: { innerHTML: "", querySelector: () => null },
    routingMissionDefProvider: {
      value: "",
      addEventListener(type, fn) {
        listeners.defProv = fn;
      }
    },
    routingMissionDefModel: { value: "", placeholder: "", dataset: {}, addEventListener: () => {} },
    btnRoutingMissionDefModelCatalog: { dataset: {}, setAttribute(k, v) { this[k] = v; } },
    routingMissionDefModelCatalogPopover: { hidden: false },
    routingMissionDefModelCatalogEmpty: { hidden: true },
    routingMissionDefModelCatalogUl: {
      set textContent(_) { rows.mission.length = 0; },
      appendChild(li) { rows.mission.push(li); }
    },
    routingPresetSelect: { value: "custom", addEventListener: () => {} },
    btnRevertMissionRouting: { addEventListener: () => {} },
    btnSaveMissionRouting: { addEventListener: () => {} },
    routingDirtyBadge: { hidden: true },
    "routingProv-0": {
      value: "",
      addEventListener(type, fn) {
        listeners.roleProv = fn;
      }
    },
    "routingMod-0": { value: "", placeholder: "", dataset: {}, addEventListener: () => {} },
    "btnRoutingModelCatalog-0": { dataset: {}, setAttribute(k, v) { this[k] = v; } },
    "routingModelCatalogPopover-0": { hidden: false },
    "routingModelCatalogEmpty-0": { hidden: true },
    "routingModelCatalogUl-0": {
      set textContent(_) { rows.planner.length = 0; },
      appendChild(li) { rows.planner.push(li); }
    }
  };
  globalThis.document = {
    getElementById(id) {
      return byId[id] || null;
    },
    createElement() {
      return {
        value: "",
        textContent: "",
        dataset: {},
        _kids: [],
        appendChild(c) { this._kids.push(c); },
        setAttribute(k, v) { this[k] = v; }
      };
    }
  };
  try {
    const snapshot = minimalSidebarSnapshot();
    snapshot.providers = ["openai", "ollama"];
    snapshot.defaultProvider = "openai";
    snapshot.providerModelPresets = { openai: ["gpt-4.1-mini"], ollama: ["llama3.1"] };
    snapshot.providerLiveModelCatalog = {
      openai: { models: ["gpt-4.1"], modelsDisplay: ["gpt-4.1"], source: "live", at: 1 },
      ollama: { models: ["qwen2.5-coder"], modelsDisplay: ["qwen2.5-coder"], source: "cache", at: 2 }
    };
    snapshot.focusedMission = {
      id: "m1",
      activeProviderId: "openai",
      activeModel: "gpt-4.1",
      routing: {
        preset: "custom",
        providerPerRole: { planner: "openai" },
        modelPerRole: { planner: "gpt-4.1" }
      }
    };
    const panels = createPanelRenderers({
      state: {
        routingDraft: null,
        dirty: { quickSettings: false, providersForm: false, chatRow: false, routingPanel: false },
        selectedApproval: null,
        selectedBundle: null,
        selectedHunkIndex: 0,
        memorySearchResults: [],
        chatBuffer: "",
        chatHistory: mockChatHistory(),
        timelineFilterText: "",
        timelineFilterLevel: "all",
        timelineFocusedOnly: false
      },
      els: {},
      sigCache: createPanelSigCache(),
      escapeHtml,
      relTime,
      mdToHtml,
      post: () => {},
      mergeModelLists,
      fillProviderModelCatalogList
    });
    panels.renderRouting(snapshot, { force: true });
    byId.routingMissionDefProvider.value = "ollama";
    byId.routingMissionDefModel.value = "gpt-4.1";
    listeners.defProv();
    assert.equal(byId.routingMissionDefModel.value, "");
    assert.ok(rows.mission.some((li) => li._kids[0].dataset.model === "qwen2.5-coder"));

    byId["routingProv-0"].value = "ollama";
    byId["routingMod-0"].value = "gpt-4.1";
    listeners.roleProv();
    assert.equal(byId["routingMod-0"].value, "");
    assert.ok(rows.planner.some((li) => li._kids[0].dataset.model === "qwen2.5-coder"));
  } finally {
    globalThis.document = prevDoc;
  }
});

test("createPanelRenderers: routing preset apply resyncs each affected row picker source immediately", async () => {
  const { createPanelRenderers } = await import(mediaChatUrl("webviewPanelBundle.js"));
  const { createPanelSigCache } = await import(mediaChatUrl("webviewSigCache.js"));
  const { escapeHtml, mdToHtml, relTime } = await import(mediaChatUrl("webviewFormat.js"));
  const { mergeModelLists, fillProviderModelCatalogList } = await import(mediaChatUrl("webviewModelLists.js"));
  const prevDoc = globalThis.document;
  const rows = { planner: [], implementer: [] };
  const listeners = {};
  const byId = {
    routingPanelMount: { innerHTML: "", querySelector: () => null },
    routingMissionDefProvider: { value: "openai", addEventListener: () => {} },
    routingMissionDefModel: { value: "", placeholder: "", dataset: {}, addEventListener: () => {} },
    btnRoutingMissionDefModelCatalog: { dataset: {}, setAttribute(k, v) { this[k] = v; } },
    routingMissionDefModelCatalogPopover: { hidden: false },
    routingMissionDefModelCatalogEmpty: { hidden: true },
    routingMissionDefModelCatalogUl: { set textContent(_) {}, appendChild() {} },
    routingPresetSelect: {
      value: "local_first",
      addEventListener(type, fn) {
        listeners.preset = fn;
      }
    },
    btnRevertMissionRouting: { addEventListener: () => {} },
    btnSaveMissionRouting: { addEventListener: () => {} },
    routingDirtyBadge: { hidden: true },
    "routingProv-0": { value: "", addEventListener: () => {} },
    "routingMod-0": { value: "", placeholder: "", dataset: {}, addEventListener: () => {} },
    "btnRoutingModelCatalog-0": { dataset: {}, setAttribute(k, v) { this[k] = v; } },
    "routingModelCatalogPopover-0": { hidden: false },
    "routingModelCatalogEmpty-0": { hidden: true },
    "routingModelCatalogUl-0": {
      set textContent(_) { rows.planner.length = 0; },
      appendChild(li) { rows.planner.push(li); }
    },
    "routingProv-2": { value: "", addEventListener: () => {} },
    "routingMod-2": { value: "", placeholder: "", dataset: {}, addEventListener: () => {} },
    "btnRoutingModelCatalog-2": { dataset: {}, setAttribute(k, v) { this[k] = v; } },
    "routingModelCatalogPopover-2": { hidden: false },
    "routingModelCatalogEmpty-2": { hidden: true },
    "routingModelCatalogUl-2": {
      set textContent(_) { rows.implementer.length = 0; },
      appendChild(li) { rows.implementer.push(li); }
    }
  };
  globalThis.document = {
    getElementById(id) {
      return byId[id] || null;
    },
    createElement() {
      return {
        value: "",
        textContent: "",
        dataset: {},
        _kids: [],
        appendChild(c) { this._kids.push(c); },
        setAttribute(k, v) { this[k] = v; }
      };
    }
  };
  try {
    const snapshot = minimalSidebarSnapshot();
    snapshot.providers = ["openai", "ollama"];
    snapshot.defaultProvider = "openai";
    snapshot.providerModelPresets = { openai: ["gpt-4.1-mini"], ollama: ["llama3.1"] };
    snapshot.providerLiveModelCatalog = {
      openai: { models: ["gpt-4.1"], modelsDisplay: ["gpt-4.1"], source: "live", at: 1 },
      ollama: { models: ["qwen2.5-coder"], modelsDisplay: ["qwen2.5-coder"], source: "cache", at: 2 }
    };
    snapshot.routingPresetTemplates = {
      local_first: {
        providerPerRole: { planner: "ollama", implementer: "openai" },
        modelPerRole: { planner: "qwen2.5-coder", implementer: "gpt-4.1" }
      }
    };
    snapshot.focusedMission = {
      id: "m1",
      activeProviderId: "openai",
      activeModel: "gpt-4.1",
      routing: { preset: "custom", providerPerRole: {}, modelPerRole: {} }
    };
    const panels = createPanelRenderers({
      state: {
        routingDraft: null,
        dirty: { quickSettings: false, providersForm: false, chatRow: false, routingPanel: false },
        selectedApproval: null,
        selectedBundle: null,
        selectedHunkIndex: 0,
        memorySearchResults: [],
        chatBuffer: "",
        chatHistory: mockChatHistory(),
        timelineFilterText: "",
        timelineFilterLevel: "all",
        timelineFocusedOnly: false
      },
      els: {},
      sigCache: createPanelSigCache(),
      escapeHtml,
      relTime,
      mdToHtml,
      post: () => {},
      mergeModelLists,
      fillProviderModelCatalogList
    });
    panels.renderRouting(snapshot, { force: true });
    byId.routingPresetSelect.value = "local_first";
    listeners.preset();
    assert.equal(byId["routingProv-0"].value, "ollama");
    assert.equal(byId["routingMod-0"].value, "qwen2.5-coder");
    assert.equal(byId["btnRoutingModelCatalog-0"].dataset.providerId, "ollama");
    assert.equal(rows.planner[0]._kids[0].dataset.model, "qwen2.5-coder");
    assert.equal(byId["routingProv-2"].value, "openai");
    assert.equal(byId["routingMod-2"].value, "gpt-4.1");
    assert.equal(byId["btnRoutingModelCatalog-2"].dataset.providerId, "openai");
    assert.equal(rows.implementer[0]._kids[0].dataset.model, "gpt-4.1");
  } finally {
    globalThis.document = prevDoc;
  }
});

test("chat, settings, and routing save paths remain target-local", async () => {
  const { wireChatDomEvents } = await import(mediaChatUrl("webviewDomWire.js"));
  const { createPanelRenderers } = await import(mediaChatUrl("webviewPanelBundle.js"));
  const { createPanelSigCache } = await import(mediaChatUrl("webviewSigCache.js"));
  const { escapeHtml, mdToHtml, relTime } = await import(mediaChatUrl("webviewFormat.js"));
  const { mergeModelLists, fillProviderModelCatalogList } = await import(mediaChatUrl("webviewModelLists.js"));
  const posted = [];
  const listeners = {};
  const byId = {
    settingDefaultProvider: { value: "openai", addEventListener: () => {} },
    settingDefaultModel: { value: "gpt-4.1", addEventListener: () => {} },
    settingHeartbeatSeconds: { value: "8", addEventListener: () => {} },
    settingAllowTerminal: { checked: false, addEventListener: () => {} },
    settingRequireWriteApproval: { checked: true, addEventListener: () => {} },
    settingRequireApprovalForNonImplementerMutations: { checked: true, addEventListener: () => {} },
    settingAutoApproveAllToolRequests: { checked: false, addEventListener: () => {} },
    settingAutoRevealOnActivation: { checked: true, addEventListener: () => {} },
    settingDefaultTab: { value: "chat", addEventListener: () => {} },
    saveQuickSettings: { addEventListener(type, fn) { listeners.saveQuick = fn; } },
    routingMissionDefProvider: { value: "ollama" },
    routingMissionDefModel: { value: "qwen2.5-coder", dataset: {}, placeholder: "", addEventListener: () => {} },
    routingPresetSelect: { value: "custom" },
    "routingProv-0": { value: "openai" },
    "routingMod-0": { value: "gpt-4.1", dataset: {}, placeholder: "", addEventListener: () => {} },
    "routingProv-1": { value: "", addEventListener: () => {} },
    "routingMod-1": { value: "", dataset: {}, placeholder: "", addEventListener: () => {} },
    "routingProv-2": { value: "", addEventListener: () => {} },
    "routingMod-2": { value: "", dataset: {}, placeholder: "", addEventListener: () => {} },
    "routingProv-3": { value: "", addEventListener: () => {} },
    "routingMod-3": { value: "", dataset: {}, placeholder: "", addEventListener: () => {} },
    "routingProv-4": { value: "", addEventListener: () => {} },
    "routingMod-4": { value: "", dataset: {}, placeholder: "", addEventListener: () => {} },
    btnSaveMissionRouting: { addEventListener(type, fn) { listeners.saveRouting = fn; } },
    routingDirtyBadge: { hidden: true }
  };
  for (const idx of [0, 1, 2, 3, 4]) {
    byId[`btnRoutingModelCatalog-${idx}`] = { dataset: {}, setAttribute(k, v) { this[k] = v; } };
    byId[`routingModelCatalogPopover-${idx}`] = { hidden: true };
    byId[`routingModelCatalogEmpty-${idx}`] = { hidden: true };
    byId[`routingModelCatalogUl-${idx}`] = { set textContent(_) {}, appendChild() {} };
  }
  byId.btnRoutingMissionDefModelCatalog = { dataset: {}, setAttribute(k, v) { this[k] = v; } };
  byId.routingMissionDefModelCatalogPopover = { hidden: true };
  byId.routingMissionDefModelCatalogEmpty = { hidden: true };
  byId.routingMissionDefModelCatalogUl = { set textContent(_) {}, appendChild() {} };
  globalThis.document = {
    body: { addEventListener: () => {} },
    getElementById(id) {
      return byId[id] ? { ...mockEl(), ...byId[id] } : mockEl();
    },
    querySelectorAll: () => ({ forEach: () => {} }),
    addEventListener: () => {}
  };
  const chatPrompt = mockEl({ value: "hello smoke" });
  const sendChat = mockEl({ addEventListener(type, fn) { listeners.sendChat = fn; } });
  const startMission = mockEl({ addEventListener(type, fn) { listeners.startMission = fn; } });
  const state = {
    snapshot: minimalSidebarSnapshot(),
    chatBuffer: "",
    chatHistory: mockChatHistory(),
    dirty: { quickSettings: false, providersForm: false, chatRow: false, routingPanel: false },
    memorySearchResults: [],
    timelineFilterText: "",
    timelineFilterLevel: "all",
    timelineFocusedOnly: false,
    selectedApproval: null,
    selectedBundle: null,
    routingDraft: null
  };
  state.snapshot.focusedMissionId = "m1";
  const els = new Proxy(
    {
      chatPrompt,
      sendChat,
      startMission,
      chatProviderSelect: { value: "openai", addEventListener: () => {} },
      chatModelInput: { value: "gpt-4.1", addEventListener: () => {} },
      missionTitle: { value: "Mission title" },
      missionPrompt: { value: "Mission prompt" }
    },
    { get: (t, p) => (t[p] ??= mockEl()) }
  );
  wireChatDomEvents({
    vscode: {},
    state,
    els,
    post: (type, extra = {}) => posted.push({ type, ...extra }),
    postWithInteractionId: (type, payload = {}) => posted.push({ type, ...payload }),
    setActiveTab: () => {},
    emitHostTrace: () => {},
    renderChat: () => {},
    renderApprovals: () => {},
    renderBundles: () => {},
    renderTimeline: () => {},
    renderMemory: () => {},
    renderProvidersPanel: () => {},
    renderSettings: () => {},
    syncChatProviderRow: () => {},
    renderRouting: () => {},
    updateQuickDirtyBadge: () => {},
    updateProvidersDirtyBadge: () => {},
    stopTraceAutoRefresh: () => {},
    startTraceAutoRefresh: () => {}
  });
  const panels = createPanelRenderers({
    state,
    els,
    sigCache: createPanelSigCache(),
    escapeHtml,
    relTime,
    mdToHtml,
    post: (type, extra = {}) => posted.push({ type, ...extra }),
    mergeModelLists,
    fillProviderModelCatalogList
  });
  state.snapshot.focusedMission = {
    id: "m1",
    activeProviderId: "ollama",
    activeModel: "qwen2.5-coder",
    routing: { preset: "custom", providerPerRole: { planner: "openai" }, modelPerRole: { planner: "gpt-4.1" } }
  };
  panels.renderRouting(state.snapshot, { force: true });
  listeners.sendChat();
  listeners.startMission();
  listeners.saveQuick();
  listeners.saveRouting();
  const send = posted.find((p) => p.type === "sendChat");
  const start = posted.find((p) => p.type === "startMission");
  const quick = posted.find((p) => p.type === "saveQuickSettings");
  const routing = posted.find((p) => p.type === "saveMissionRouting");
  assert.deepEqual(
    { providerId: send.providerId, model: send.model },
    { providerId: "openai", model: "gpt-4.1" }
  );
  assert.deepEqual(
    { providerId: start.providerId, model: start.model },
    { providerId: "openai", model: "gpt-4.1" }
  );
  assert.equal(quick.defaultProvider, "openai");
  assert.equal(quick.defaultModel, "gpt-4.1");
  assert.equal(quick.requireApprovalForNonImplementerMutations, true);
  assert.equal(quick.autoApproveAllToolRequests, false);
  assert.equal(routing.activeProviderId, "ollama");
  assert.equal(routing.activeModel, "qwen2.5-coder");
  assert.deepEqual(routing.roles[0], { role: "planner", providerId: "openai", model: "gpt-4.1" });
  assert.equal(typeof start.interactionId, "string");
});

test("wireChatDomEvents: startMission preserves one interaction id from click trace through posted payload", async () => {
  const { wireChatDomEvents } = await import(mediaChatUrl("webviewDomWire.js"));
  const posted = [];
  const traces = [];
  globalThis.document = {
    body: { addEventListener: () => {} },
    getElementById: () => mockEl(),
    querySelectorAll: () => ({ forEach: () => {} }),
    addEventListener: () => {}
  };
  const listeners = {};
  const els = new Proxy(
    {
      chatPrompt: mockEl(),
      sendChat: mockEl(),
      startMission: mockEl({ addEventListener(type, fn) { listeners.startMission = fn; } }),
      chatProviderSelect: { value: "openai", addEventListener: () => {} },
      chatModelInput: { value: "gpt-4.1", addEventListener: () => {} },
      missionTitle: { value: "Trace start" },
      missionPrompt: { value: "Make the start mission visible" }
    },
    { get: (t, p) => (t[p] ??= mockEl()) }
  );
  wireChatDomEvents({
    vscode: {},
    state: {
      snapshot: minimalSidebarSnapshot(),
      chatBuffer: "",
      chatHistory: mockChatHistory(),
      dirty: { quickSettings: false, providersForm: false, chatRow: false, routingPanel: false },
      memorySearchResults: [],
      timelineFilterText: "",
      timelineFilterLevel: "all",
      timelineFocusedOnly: false,
      selectedApproval: null,
      selectedBundle: null,
      routingDraft: null
    },
    els,
    post: (type, extra = {}, interactionId) => posted.push({ type, interactionId, ...extra }),
    postWithInteractionId: () => {
      throw new Error("startMission should preserve its own interaction id instead of generating a second one");
    },
    setActiveTab: () => {},
    emitHostTrace: (entry) => traces.push(entry),
    renderChat: () => {},
    renderApprovals: () => {},
    renderBundles: () => {},
    renderTimeline: () => {},
    renderMemory: () => {},
    renderProvidersPanel: () => {},
    renderSettings: () => {},
    syncChatProviderRow: () => {},
    renderRouting: () => {},
    updateQuickDirtyBadge: () => {},
    updateProvidersDirtyBadge: () => {},
    stopTraceAutoRefresh: () => {},
    startTraceAutoRefresh: () => {}
  });

  listeners.startMission();
  const clickTrace = traces.find((entry) => entry.event === "start_mission_click");
  const start = posted.find((entry) => entry.type === "startMission");
  assert.ok(clickTrace);
  assert.ok(start);
  assert.equal(start.interactionId, clickTrace.interactionId);
  assert.equal(start.providerId, "openai");
  assert.equal(start.model, "gpt-4.1");
});

test("wireChatDomEvents: blank startMission shows visible status instead of silent no-op", async () => {
  const { wireChatDomEvents } = await import(mediaChatUrl("webviewDomWire.js"));
  const missionActionStatus = mockEl();
  const posted = [];
  const traces = [];
  const listeners = {};
  globalThis.document = {
    body: { addEventListener: () => {} },
    getElementById: (id) => (id === "missionActionStatus" ? missionActionStatus : mockEl()),
    querySelectorAll: () => ({ forEach: () => {} }),
    addEventListener: () => {}
  };
  const els = new Proxy(
    {
      chatPrompt: mockEl(),
      sendChat: mockEl(),
      startMission: mockEl({ addEventListener(type, fn) { listeners.startMission = fn; } }),
      chatProviderSelect: { value: "openai", addEventListener: () => {} },
      chatModelInput: { value: "gpt-4.1", addEventListener: () => {} },
      missionTitle: { value: "No prompt mission" },
      missionPrompt: { value: "   " }
    },
    { get: (t, p) => (t[p] ??= mockEl()) }
  );
  wireChatDomEvents({
    vscode: {},
    state: {
      snapshot: minimalSidebarSnapshot(),
      chatBuffer: "",
      chatHistory: mockChatHistory(),
      dirty: { quickSettings: false, providersForm: false, chatRow: false, routingPanel: false },
      memorySearchResults: [],
      timelineFilterText: "",
      timelineFilterLevel: "all",
      timelineFocusedOnly: false,
      selectedApproval: null,
      selectedBundle: null,
      routingDraft: null
    },
    els,
    post: (type, extra = {}, interactionId) => posted.push({ type, interactionId, ...extra }),
    postWithInteractionId: () => posted.push({ type: "unexpectedPostWithInteractionId" }),
    setActiveTab: () => {},
    emitHostTrace: (entry) => traces.push(entry),
    renderChat: () => {},
    renderApprovals: () => {},
    renderBundles: () => {},
    renderTimeline: () => {},
    renderMemory: () => {},
    renderProvidersPanel: () => {},
    renderSettings: () => {},
    syncChatProviderRow: () => {},
    renderRouting: () => {},
    updateQuickDirtyBadge: () => {},
    updateProvidersDirtyBadge: () => {},
    stopTraceAutoRefresh: () => {},
    startTraceAutoRefresh: () => {}
  });

  listeners.startMission();
  assert.equal(posted.length, 0);
  assert.equal(missionActionStatus.textContent, "Mission start requires a prompt.");
  assert.ok(traces.some((entry) => entry.event === "start_mission_click_rejected"));
});

test("wireChatDomEvents: model picker selection marks the right surface dirty and updates the field", async () => {
  const { wireChatDomEvents } = await import(mediaChatUrl("webviewDomWire.js"));
  const posted = [];
  const chatInput = { value: "" };
  const chatField = {
    dataset: { modelPickerScope: "chatRow" },
    querySelector(sel) {
      if (sel === "input") return chatInput;
      if (sel === "[data-model-picker-popover='true']") return { hidden: false };
      if (sel === "[data-model-picker-trigger='true']") return { setAttribute() {} };
      return null;
    }
  };
  const routingBadge = { hidden: true };
  const listeners = {};
  globalThis.document = {
    body: { addEventListener: () => {} },
    getElementById(id) {
      if (id === "routingDirtyBadge") return routingBadge;
      return mockEl();
    },
    querySelectorAll: () => ({ forEach: () => {} }),
    addEventListener(type, fn) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    }
  };
  const state = {
    snapshot: minimalSidebarSnapshot(),
    chatBuffer: "",
    chatHistory: mockChatHistory(),
    dirty: { quickSettings: false, providersForm: false, chatRow: false, routingPanel: false },
    memorySearchResults: [],
    timelineFilterText: "",
    timelineFilterLevel: "all",
    timelineFocusedOnly: false,
    selectedApproval: null,
    selectedBundle: null,
    routingDraft: null
  };
  const els = new Proxy({}, { get: (t, p) => (t[p] ??= mockEl()) });
  wireChatDomEvents({
    vscode: {},
    state,
    els,
    post: (type, extra = {}) => posted.push({ type, ...extra }),
    postWithInteractionId: () => {},
    setActiveTab: () => {},
    emitHostTrace: () => {},
    renderChat: () => {},
    renderApprovals: () => {},
    renderBundles: () => {},
    renderTimeline: () => {},
    renderMemory: () => {},
    renderProvidersPanel: () => {},
    renderSettings: () => {},
    syncChatProviderRow: () => {},
    renderRouting: () => {},
    updateQuickDirtyBadge: () => {},
    updateProvidersDirtyBadge: () => {},
    stopTraceAutoRefresh: () => {},
    startTraceAutoRefresh: () => {}
  });
  const clickFns = listeners.click || [];
  const modelItem = {
    dataset: { model: "gpt-4.1" },
    closest(sel) {
      if (sel === ".model-catalog-item") return this;
      if (sel === ".model-picker-field") return chatField;
      return null;
    }
  };
  for (const fn of clickFns) {
    fn({ target: modelItem, stopPropagation() {} });
  }
  assert.equal(chatInput.value, "gpt-4.1");
  assert.equal(state.dirty.chatRow, true);
  assert.equal(posted.length, 0);
});

test("createMissionRenderer: guarded manual-review stop renders non-resumable controls and explicit copy", async () => {
  const { createMissionRenderer } = await import(mediaChatUrl("webviewRenderMissions.js"));
  const { createPanelSigCache } = await import(mediaChatUrl("webviewSigCache.js"));
  const { escapeHtml, mdToHtml, relTime, htmlSig } = await import(mediaChatUrl("webviewFormat.js"));
  const missionsEl = {
    innerHTML: "",
    childElementCount: 0,
    querySelectorAll(sel) {
      if (sel === ".mission-card") {
        return { length: (this.innerHTML.match(/class="mission-card/g) || []).length };
      }
      return { length: 0 };
    },
    get offsetHeight() {
      return 0;
    }
  };
  const inspectorEl = { innerHTML: "" };
  const resumeFocusedMission = { textContent: "", disabled: false, title: "" };
  const prevDoc = globalThis.document;
  globalThis.document = {
    getElementById(id) {
      if (id === "missions") return missionsEl;
      if (id === "missionInspector") return inspectorEl;
      if (id === "resumeFocusedMission") return resumeFocusedMission;
      return null;
    },
    querySelector(sel) {
      if (sel === '.pane[data-pane="missions"]') {
        return { classList: { contains: () => true } };
      }
      return null;
    }
  };
  try {
    const snapshot = minimalSidebarSnapshot();
    snapshot.focusedMissionId = "m-guard";
    snapshot.focusedMissionLifecycleSummary =
      "Blocked intentionally; manual review is required before retrying interrupted mutating work.";
    snapshot.focusedMissionDownstreamGatingHint =
      "Required implementer work is blocked or failed; downstream review and validation are paused to avoid misleading progress. Interrupted mutating work may already have executed. Manual review is required before any retry; this is not a normal safe-resume state. No eligible recovery work is currently runnable.";
    snapshot.missionDownstreamGatingCardHints = {
      "m-guard": "Implementer blocked: manual review required"
    };
    snapshot.missions = [
      {
        id: "m-guard",
        title: "Guarded replay stop",
        prompt: "p",
        createdAt: 1,
        updatedAt: 2,
        status: "blocked",
        blocker: "Blocked: manual review required before retrying interrupted mutating work",
        blockReasonCode: "manual_review_required",
        activeProviderId: "openai",
        currentStep: 2,
        policy: { policyPreset: "balanced" },
        queue: [],
        memory: [],
        events: [],
        checkpoints: [],
        approvals: [],
        validationState: "failed"
      }
    ];
    snapshot.focusedMission = snapshot.missions[0];
    snapshot.missionList.totalCount = 1;
    const renderer = createMissionRenderer({
      state: { missionQuickFilter: "all", activeTab: "missions", visibleBulkCandidates: {} },
      sigCache: createPanelSigCache(),
      emitHostTrace: () => {},
      trace: () => {},
      escapeHtml,
      relTime,
      mdToHtml,
      htmlSig
    });
    renderer.renderMissions(snapshot, "iid-smoke", { force: true });
    assert.match(missionsEl.innerHTML, /Stopped — manual review required/);
    assert.match(missionsEl.innerHTML, /Implementer blocked: manual review required/);
    assert.match(missionsEl.innerHTML, /Review required/);
    assert.match(missionsEl.innerHTML, /disabled/);
    assert.equal(resumeFocusedMission.disabled, true);
    assert.match(resumeFocusedMission.textContent, /Review required focused/);
    assert.match(resumeFocusedMission.title, /manual review/i);
  } finally {
    globalThis.document = prevDoc;
  }
});

test("createMissionRenderer: approval-pending mission keeps approval-paused story aligned across card and inspector", async () => {
  const { createMissionRenderer } = await import(mediaChatUrl("webviewRenderMissions.js"));
  const { createPanelSigCache } = await import(mediaChatUrl("webviewSigCache.js"));
  const { escapeHtml, mdToHtml, relTime, htmlSig } = await import(mediaChatUrl("webviewFormat.js"));
  const missionsEl = {
    innerHTML: "",
    childElementCount: 0,
    querySelectorAll(sel) {
      if (sel === ".mission-card") return { length: (this.innerHTML.match(/class="mission-card/g) || []).length };
      return { length: 0 };
    },
    get offsetHeight() {
      return 0;
    }
  };
  const inspectorEl = { innerHTML: "" };
  const resumeFocusedMission = { textContent: "", disabled: false, title: "" };
  const prevDoc = globalThis.document;
  globalThis.document = {
    getElementById(id) {
      if (id === "missions") return missionsEl;
      if (id === "missionInspector") return inspectorEl;
      if (id === "resumeFocusedMission") return resumeFocusedMission;
      return null;
    },
    querySelector(sel) {
      if (sel === '.pane[data-pane="missions"]') return { classList: { contains: () => true } };
      return null;
    }
  };
  try {
    const snapshot = minimalSidebarSnapshot();
    snapshot.focusedMissionId = "m-pending";
    snapshot.focusedMissionLifecycleSummary = "Waiting for approval to continue.";
    snapshot.missions = [
      {
        id: "m-pending",
        title: "Approval pending mission",
        prompt: "p",
        createdAt: 1,
        updatedAt: 2,
        status: "awaiting_input",
        blocker: "Awaiting approval",
        blockReasonCode: "approval_pending",
        activeProviderId: "openai",
        currentStep: 1,
        policy: { policyPreset: "balanced" },
        queue: [
          { id: "impl", title: "Implement tranche", role: "implementer", status: "blocked" },
          { id: "rev", title: "Review tranche", role: "reviewer", status: "todo" }
        ],
        memory: [],
        events: [{ id: "e1", ts: 2, level: "warn", source: "approval", message: "Approval required: Approve bounded write" }],
        checkpoints: [],
        approvals: [{ status: "pending" }],
        validationState: "failed"
      }
    ];
    snapshot.focusedMission = snapshot.missions[0];
    snapshot.missionList.totalCount = 1;
    const renderer = createMissionRenderer({
      state: { missionQuickFilter: "all", activeTab: "missions", visibleBulkCandidates: {} },
      sigCache: createPanelSigCache(),
      emitHostTrace: () => {},
      trace: () => {},
      escapeHtml,
      relTime,
      mdToHtml,
      htmlSig
    });
    renderer.renderMissions(snapshot, "iid-pending", { force: true });
    assert.match(missionsEl.innerHTML, /Paused — awaiting approval/);
    assert.match(missionsEl.innerHTML, /Awaiting your approval/i);
    assert.match(inspectorEl.innerHTML, /Waiting for approval to continue\./);
    assert.match(inspectorEl.innerHTML, /Paused on: implementer • Implement tranche/);
    assert.equal(resumeFocusedMission.disabled, true);
    assert.match(resumeFocusedMission.textContent, /Awaiting approval focused/);
  } finally {
    globalThis.document = prevDoc;
  }
});

test("createMissionRenderer: operator-abort resumable mission keeps resumable story aligned across card and inspector", async () => {
  const { createMissionRenderer } = await import(mediaChatUrl("webviewRenderMissions.js"));
  const { createPanelSigCache } = await import(mediaChatUrl("webviewSigCache.js"));
  const { escapeHtml, mdToHtml, relTime, htmlSig } = await import(mediaChatUrl("webviewFormat.js"));
  const missionsEl = {
    innerHTML: "",
    childElementCount: 0,
    querySelectorAll(sel) {
      if (sel === ".mission-card") return { length: (this.innerHTML.match(/class="mission-card/g) || []).length };
      return { length: 0 };
    },
    get offsetHeight() {
      return 0;
    }
  };
  const inspectorEl = { innerHTML: "" };
  const resumeFocusedMission = { textContent: "", disabled: false, title: "" };
  const prevDoc = globalThis.document;
  globalThis.document = {
    getElementById(id) {
      if (id === "missions") return missionsEl;
      if (id === "missionInspector") return inspectorEl;
      if (id === "resumeFocusedMission") return resumeFocusedMission;
      return null;
    },
    querySelector(sel) {
      if (sel === '.pane[data-pane="missions"]') return { classList: { contains: () => true } };
      return null;
    }
  };
  try {
    const snapshot = minimalSidebarSnapshot();
    snapshot.focusedMissionId = "m-abort";
    snapshot.focusedMissionLifecycleSummary = "Paused after operator abort; safe to resume when ready.";
    snapshot.missions = [
      {
        id: "m-abort",
        title: "Operator abort mission",
        prompt: "p",
        createdAt: 1,
        updatedAt: 2,
        status: "blocked",
        blocker: "Model stream cancelled (operator abort). Resume when ready.",
        blockReasonCode: "operator_stream_abort",
        activeProviderId: "openai",
        currentStep: 2,
        policy: { policyPreset: "balanced" },
        queue: [{ id: "impl", title: "Implement tranche", role: "implementer", status: "blocked" }],
        memory: [],
        events: [{ id: "e1", ts: 2, level: "warn", source: "orchestrator", message: "Work item LLM stream aborted by operator." }],
        checkpoints: [],
        approvals: [],
        validationState: "failed"
      }
    ];
    snapshot.focusedMission = snapshot.missions[0];
    snapshot.missionList.totalCount = 1;
    const renderer = createMissionRenderer({
      state: { missionQuickFilter: "all", activeTab: "missions", visibleBulkCandidates: {} },
      sigCache: createPanelSigCache(),
      emitHostTrace: () => {},
      trace: () => {},
      escapeHtml,
      relTime,
      mdToHtml,
      htmlSig
    });
    renderer.renderMissions(snapshot, "iid-abort", { force: true });
    assert.match(missionsEl.innerHTML, /Paused — run stopped/);
    assert.match(inspectorEl.innerHTML, /Paused after operator abort; safe to resume when ready\./);
    assert.match(inspectorEl.innerHTML, /Paused on: implementer • Implement tranche/);
    assert.equal(resumeFocusedMission.disabled, false);
    assert.match(resumeFocusedMission.textContent, /Resume focused/);
    assert.match(resumeFocusedMission.title, /Safe to resume/i);
  } finally {
    globalThis.document = prevDoc;
  }
});

test("createMissionRenderer: terminal outcomes remain terminal across focused card, inspector, and action state", async () => {
  const { createMissionRenderer } = await import(mediaChatUrl("webviewRenderMissions.js"));
  const { createPanelSigCache } = await import(mediaChatUrl("webviewSigCache.js"));
  const { escapeHtml, mdToHtml, relTime, htmlSig } = await import(mediaChatUrl("webviewFormat.js"));
  const missionsEl = {
    innerHTML: "",
    childElementCount: 0,
    querySelectorAll(sel) {
      if (sel === ".mission-card") return { length: (this.innerHTML.match(/class="mission-card/g) || []).length };
      return { length: 0 };
    },
    get offsetHeight() {
      return 0;
    }
  };
  const inspectorEl = { innerHTML: "" };
  const resumeFocusedMission = { textContent: "", disabled: false, title: "" };
  const prevDoc = globalThis.document;
  globalThis.document = {
    getElementById(id) {
      if (id === "missions") return missionsEl;
      if (id === "missionInspector") return inspectorEl;
      if (id === "resumeFocusedMission") return resumeFocusedMission;
      return null;
    },
    querySelector(sel) {
      if (sel === '.pane[data-pane="missions"]') return { classList: { contains: () => true } };
      return null;
    }
  };
  try {
    const snapshot = minimalSidebarSnapshot();
    snapshot.focusedMissionId = "m-done";
    snapshot.focusedMissionLifecycleSummary = "Completed; Already satisfied; no tool run needed.";
    snapshot.missions = [
      {
        id: "m-done",
        title: "Completed mission",
        prompt: "p",
        createdAt: 1,
        updatedAt: 2,
        status: "completed",
        completionReason: "already_satisfied_no_tool_run",
        activeProviderId: "openai",
        currentStep: 3,
        policy: { policyPreset: "balanced" },
        queue: [{ id: "v1", title: "Validate", role: "validator", status: "done" }],
        memory: [],
        events: [{ id: "e1", ts: 2, level: "info", source: "validator", message: "COMPLETE:" }],
        checkpoints: [],
        approvals: [],
        validationState: "passed"
      }
    ];
    snapshot.focusedMission = snapshot.missions[0];
    snapshot.missionList.totalCount = 1;
    const renderer = createMissionRenderer({
      state: { missionQuickFilter: "all", activeTab: "missions", visibleBulkCandidates: {} },
      sigCache: createPanelSigCache(),
      emitHostTrace: () => {},
      trace: () => {},
      escapeHtml,
      relTime,
      mdToHtml,
      htmlSig
    });
    renderer.renderMissions(snapshot, "iid-terminal", { force: true });
    assert.match(missionsEl.innerHTML, /Completed — already satisfied/);
    assert.match(inspectorEl.innerHTML, /Completed; Already satisfied; no tool run needed\./);
    assert.match(resumeFocusedMission.textContent, /Completed focused/);
    assert.equal(resumeFocusedMission.disabled, true);
    assert.match(resumeFocusedMission.title, /already completed/i);
  } finally {
    globalThis.document = prevDoc;
  }
});

test("createMissionRenderer: approval-rejected mission renders blocked approval copy and no normal resume control", async () => {
  const { createMissionRenderer } = await import(mediaChatUrl("webviewRenderMissions.js"));
  const { createPanelSigCache } = await import(mediaChatUrl("webviewSigCache.js"));
  const { escapeHtml, mdToHtml, relTime, htmlSig } = await import(mediaChatUrl("webviewFormat.js"));
  const missionsEl = {
    innerHTML: "",
    childElementCount: 0,
    querySelectorAll(sel) {
      if (sel === ".mission-card") {
        return { length: (this.innerHTML.match(/class="mission-card/g) || []).length };
      }
      return { length: 0 };
    },
    get offsetHeight() {
      return 0;
    }
  };
  const inspectorEl = { innerHTML: "" };
  const resumeFocusedMission = { textContent: "", disabled: false, title: "" };
  const prevDoc = globalThis.document;
  globalThis.document = {
    getElementById(id) {
      if (id === "missions") return missionsEl;
      if (id === "missionInspector") return inspectorEl;
      if (id === "resumeFocusedMission") return resumeFocusedMission;
      return null;
    },
    querySelector(sel) {
      if (sel === '.pane[data-pane="missions"]') {
        return { classList: { contains: () => true } };
      }
      return null;
    }
  };
  try {
    const snapshot = minimalSidebarSnapshot();
    snapshot.focusedMissionId = "m-reject";
    snapshot.focusedMissionLifecycleSummary =
      "Blocked after approval rejection; implementer recovery is required before the mission can continue.";
    snapshot.focusedMissionDownstreamGatingHint =
      "Required implementer work is blocked or failed; downstream review and validation are paused to avoid misleading progress. The approval was rejected; implementer recovery is required before downstream steps continue. No eligible recovery work is currently runnable.";
    snapshot.missionDownstreamGatingCardHints = {
      "m-reject": "Implementer blocked: approval rejected"
    };
    snapshot.missions = [
      {
        id: "m-reject",
        title: "Rejected approval mission",
        prompt: "p",
        createdAt: 1,
        updatedAt: 2,
        status: "blocked",
        blocker: "Tool request rejected",
        blockReasonCode: "approval_rejected",
        activeProviderId: "openai",
        currentStep: 2,
        policy: { policyPreset: "balanced" },
        queue: [],
        memory: [],
        events: [],
        checkpoints: [],
        approvals: [{ status: "rejected" }],
        validationState: "failed"
      }
    ];
    snapshot.focusedMission = snapshot.missions[0];
    snapshot.missionList.totalCount = 1;
    const renderer = createMissionRenderer({
      state: { missionQuickFilter: "all", activeTab: "missions", visibleBulkCandidates: {} },
      sigCache: createPanelSigCache(),
      emitHostTrace: () => {},
      trace: () => {},
      escapeHtml,
      relTime,
      mdToHtml,
      htmlSig
    });
    renderer.renderMissions(snapshot, "iid-smoke-reject", { force: true });
    assert.match(missionsEl.innerHTML, /Needs attention — approval rejected/);
    assert.match(missionsEl.innerHTML, /Implementer blocked: approval rejected/);
    assert.match(missionsEl.innerHTML, /Approval rejected/);
    assert.match(missionsEl.innerHTML, /disabled/);
    assert.equal(resumeFocusedMission.disabled, true);
    assert.match(resumeFocusedMission.textContent, /Approval rejected focused/);
    assert.match(resumeFocusedMission.title, /blocked after approval rejection/i);
  } finally {
    globalThis.document = prevDoc;
  }
});

test("createMissionRenderer: card and inspector agree on dependency-blocked vs runnable queue path", async () => {
  const { createMissionRenderer } = await import(mediaChatUrl("webviewRenderMissions.js"));
  const { createPanelSigCache } = await import(mediaChatUrl("webviewSigCache.js"));
  const { escapeHtml, mdToHtml, relTime, htmlSig } = await import(mediaChatUrl("webviewFormat.js"));
  const prevDoc = globalThis.document;
  const missionsEl = {
    innerHTML: "",
    childElementCount: 0,
    querySelectorAll(sel) {
      if (sel === ".mission-card") {
        return { length: (this.innerHTML.match(/class="mission-card/g) || []).length };
      }
      return { length: 0 };
    },
    get offsetHeight() {
      return 0;
    }
  };
  const inspectorEl = { innerHTML: "" };
  const resumeFocusedMission = { textContent: "", disabled: false, title: "" };
  globalThis.document = {
    getElementById(id) {
      if (id === "missions") return missionsEl;
      if (id === "missionInspector") return inspectorEl;
      if (id === "resumeFocusedMission") return resumeFocusedMission;
      return null;
    },
    querySelector(sel) {
      if (sel === '.pane[data-pane="missions"]') {
        return { classList: { contains: () => true } };
      }
      return null;
    }
  };
  try {
    const snapshot = minimalSidebarSnapshot();
    snapshot.focusedMissionId = "m-deps";
    snapshot.missions = [
      {
        id: "m-deps",
        title: "Dependency visibility mission",
        prompt: "p",
        createdAt: 1,
        updatedAt: 2,
        status: "queued",
        blocker: "",
        activeProviderId: "openai",
        currentStep: 2,
        policy: { policyPreset: "balanced" },
        queue: [
          { id: "a", title: "Blocked earlier todo", role: "reviewer", status: "todo", dependsOn: ["missing"] },
          { id: "b", title: "Runnable later todo", role: "validator", status: "todo" }
        ],
        memory: [],
        events: [],
        checkpoints: [],
        approvals: [],
        validationState: "pending"
      }
    ];
    snapshot.focusedMission = snapshot.missions[0];
    snapshot.missionList.totalCount = 1;
    const renderer = createMissionRenderer({
      state: { missionQuickFilter: "all", activeTab: "missions", visibleBulkCandidates: {} },
      sigCache: createPanelSigCache(),
      emitHostTrace: () => {},
      trace: () => {},
      escapeHtml,
      relTime,
      mdToHtml,
      htmlSig
    });
    renderer.renderMissions(snapshot, "iid-deps", { force: true });
    assert.match(missionsEl.innerHTML, /Next: validator — Runnable later todo/);
    assert.doesNotMatch(missionsEl.innerHTML, /Waiting on dependency: reviewer — Blocked earlier todo/);
    assert.match(inspectorEl.innerHTML, /Next step: validator • Runnable later todo/);
    assert.doesNotMatch(inspectorEl.innerHTML, /Waiting on dependency: reviewer • Blocked earlier todo/);
    assert.equal(resumeFocusedMission.disabled, false);
  } finally {
    globalThis.document = prevDoc;
  }
});

test("createMissionRenderer: card and inspector agree when queue is only waiting on dependency", async () => {
  const { createMissionRenderer } = await import(mediaChatUrl("webviewRenderMissions.js"));
  const { createPanelSigCache } = await import(mediaChatUrl("webviewSigCache.js"));
  const { escapeHtml, mdToHtml, relTime, htmlSig } = await import(mediaChatUrl("webviewFormat.js"));
  const prevDoc = globalThis.document;
  const missionsEl = {
    innerHTML: "",
    childElementCount: 0,
    querySelectorAll(sel) {
      if (sel === ".mission-card") {
        return { length: (this.innerHTML.match(/class="mission-card/g) || []).length };
      }
      return { length: 0 };
    },
    get offsetHeight() {
      return 0;
    }
  };
  const inspectorEl = { innerHTML: "" };
  globalThis.document = {
    getElementById(id) {
      if (id === "missions") return missionsEl;
      if (id === "missionInspector") return inspectorEl;
      if (id === "resumeFocusedMission") return { textContent: "", disabled: false, title: "" };
      return null;
    },
    querySelector(sel) {
      if (sel === '.pane[data-pane="missions"]') {
        return { classList: { contains: () => true } };
      }
      return null;
    }
  };
  try {
    const snapshot = minimalSidebarSnapshot();
    snapshot.focusedMissionId = "m-wait";
    snapshot.missions = [
      {
        id: "m-wait",
        title: "Dependency wait mission",
        prompt: "p",
        createdAt: 1,
        updatedAt: 2,
        status: "queued",
        blocker: "",
        activeProviderId: "openai",
        currentStep: 1,
        policy: { policyPreset: "balanced" },
        queue: [{ id: "a", title: "Blocked todo", role: "reviewer", status: "todo", dependsOn: ["missing"] }],
        memory: [],
        events: [],
        checkpoints: [],
        approvals: [],
        validationState: "pending"
      }
    ];
    snapshot.focusedMission = snapshot.missions[0];
    snapshot.missionList.totalCount = 1;
    const renderer = createMissionRenderer({
      state: { missionQuickFilter: "all", activeTab: "missions", visibleBulkCandidates: {} },
      sigCache: createPanelSigCache(),
      emitHostTrace: () => {},
      trace: () => {},
      escapeHtml,
      relTime,
      mdToHtml,
      htmlSig
    });
    renderer.renderMissions(snapshot, "iid-wait", { force: true });
    assert.match(missionsEl.innerHTML, /Waiting on dependency: reviewer — Blocked todo/);
    assert.doesNotMatch(missionsEl.innerHTML, /Next: reviewer — Blocked todo/);
    assert.match(inspectorEl.innerHTML, /Waiting on dependency: reviewer • Blocked todo/);
    assert.doesNotMatch(inspectorEl.innerHTML, /Next step: reviewer • Blocked todo/);
  } finally {
    globalThis.document = prevDoc;
  }
});
