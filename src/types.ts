import type { MissionBlueprint } from "./missions/missionBlueprintTypes";

export type MissionStatus =
  | "queued"
  | "running"
  | "awaiting_input"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Orchestrator-owned pause/block classification. `Mission.blocker` stays human-readable detail / fallback.
 */
export type MissionBlockReasonCode =
  | "policy_blocked"
  | "tool_failure"
  | "manual_review_required"
  | "max_auto_rounds"
  | "closure_not_satisfied"
  | "required_work_open"
  | "operator_stream_abort"
  | "approval_rejected"
  | "approval_pending"
  | "stall_recovery_limit"
  | "generic_blocked"
  | "awaiting_blueprint_approval"
  | "post_validator_checkpoint"
  | "awaiting_pre_blueprint_answers";

/**
 * Orchestrator-owned classification when `Mission.status === "failed"` (true terminal failure).
 * Separate from `blockReasonCode` (pause/blocked semantics). Free-text detail stays in `blocker` / events.
 */
export type MissionFailureReasonCode = "orchestrator_uncaught_error";

/** Structured Q&A before blueprint generation when `myAi.missions.preBlueprintClarification` is on. */
export interface PreBlueprintClarificationState {
  questions: string[];
  /** Operator-supplied answers; set when moving to blueprint generation. */
  answersMarkdown?: string;
  status: "awaiting_answers" | "complete";
}

export type AgentRole =
  | "planner"
  | "researcher"
  | "implementer"
  | "reviewer"
  | "validator"
  | "architect";

export interface MissionPolicy {
  closureRequired: boolean;
  requireReviewerBeforeComplete: boolean;
  requireValidatorBeforeComplete: boolean;
  requireImplementerBeforeComplete: boolean;
  autoContinue: boolean;
  maxAutoRounds: number;
  minCompletedWorkItems: number;
  stallReplanThreshold: number;
  policyPreset?: "light" | "balanced" | "strict" | "custom";
  requireValidationEvidence?: boolean;
}

export interface MissionAgentRouting {
  preset?: "default" | "research_heavy" | "local_first" | "review_strict" | "custom";
  providerPerRole?: Partial<Record<AgentRole, string>>;
  modelPerRole?: Partial<Record<AgentRole, string>>;
}

export interface MissionTemplate {
  id: string;
  name: string;
  description?: string;
  prompt: string;
  providerId?: string;
  model?: string;
  routing?: MissionAgentRouting;
  policy: MissionPolicy;
  createdAt: number;
  updatedAt: number;
}

export interface MissionRuntime {
  lastProgressAt?: number;
  lastRunnerHeartbeatAt?: number;
  stalledHeartbeats: number;
  autoReplans: number;
  loopGuardTrips: number;
  runnerOwnerId?: string;
  runnerLeaseExpiresAt?: number;
  /** Timestamp (ms) of last successful implementer-side mutating tool action (non-noop). */
  lastImplementerMutationAt?: number;
  /** Timestamp (ms) of last successful verification run (lint/tests) after mutation. */
  lastVerificationAt?: number;
  /** Count of web research tool calls (webSearch/fetchWebPage) during this mission. */
  webResearchCalls?: number;
}

/**
 * Optional structured classification for mission events (telemetry / operator analytics).
 * Omitted on legacy events; prefer setting on new orchestrator and runner paths.
 */
export type MissionTelemetryKind =
  | "work_started"
  | "work_completed"
  | "work_failed"
  | "tool_called"
  | "approval_requested"
  | "scope_drift"
  | "verification_recorded"
  | "mission_blocked"
  | "stall_recovery_replan"
  | "stall_recovery_limit"
  | "research_contradiction_warn"
  | "heartbeat";

export interface MissionEvent {
  id: string;
  ts: number;
  level: "info" | "warn" | "error";
  source: string;
  message: string;
  data?: unknown;
  telemetryKind?: MissionTelemetryKind;
}

export interface MemoryItem {
  id: string;
  ts: number;
  kind: "summary" | "finding" | "decision" | "tool_result" | "user" | "checkpoint";
  text: string;
  tags?: string[];
  sourceMissionId?: string;
  /** Cached embedding vector from a real embedding model (not serialized to webview snapshots). */
  embedding?: number[];
}

export interface WorkItem {
  id: string;
  title: string;
  role: AgentRole;
  status: "todo" | "running" | "done" | "blocked" | "failed" | "skipped";
  prompt: string;
  /** When false, item does not block mission completion (optional / demoted tail). Omitted = required. */
  requiredForCompletion?: boolean;
  dependsOn?: string[];
  output?: string;
  providerId?: string;
  model?: string;
  /**
   * When status is `done`, set if the item completed without actionable tool work because the
   * step was already satisfied (e.g. `ALREADY_SATISFIED:` model line with no TOOL calls), or
   * tools ran but applyPatch was a deterministic no-op (replace already present; see applyPatchNoOpPolicy).
   */
  completionKind?: "already_satisfied" | "apply_patch_noop";
  /**
   * Structured classification for blocked/failed **implementer** hard-stops. The orchestrator must set
   * this whenever a required implementer work item is left `blocked` or `failed` for a downstream-gating
   * reason. Valid values match `KNOWN_IMPLEMENTER_HARD_STOP_CLASSES` in `implementerHardStopClassInvariant.ts`;
   * missing or unknown values are malformed (explicit `malformed` kind in gate classification + mission events).
   */
  hardStopClass?:
    | "approval_pending"
    | "approval_rejected"
    | "policy_blocked"
    | "tool_failure"
    | "operator_abort"
    | "timeout_or_system_abort"
    | "unknown_hard_stop";
  /**
   * Persisted just before a potentially mutating tool call executes and cleared only when the work item is
   * durably finalized. Recovery must not blindly replay a `running` item that still carries this marker.
   */
  activeMutatingToolCall?: {
    tool: string;
    approved?: boolean;
    target?: string;
    startedAt: number;
  };
  /**
   * Set when automatic retries are exhausted for this failure row. Operator must fix, skip, or reset
   * the item; the runner will not enqueue further auto-retries for this row.
   */
  deadLetter?: boolean;
  deadLetterAt?: number;
  /** Number of times this work item has been retried after failure. */
  retryCount?: number;
  /** Error output from the previous failed attempt (injected on auto-retry). */
  previousError?: string;
  /** Parent work item ID — set when this is a sub-item from DECOMPOSE. */
  parentWorkItemId?: string;
  /** Sub-items decomposed from this work item. Parent completes only when all sub-items complete. */
  subItems?: WorkItem[];
  /** Blueprint mode: planner item that emits structured JSON plan; revision passes. */
  workItemPurpose?:
    | "blueprint_generate"
    | "blueprint_revise"
    | "pre_blueprint_clarify"
    | "web_research_consolidate";
  /** After synthesis, ties this row to `MissionBlueprint.steps[].id`. */
  blueprintStepId?: string;
}

export interface MissionCheckpoint {
  id: string;
  ts: number;
  step: number;
  summary: string;
  queueSnapshot: Array<Pick<WorkItem, "id" | "title" | "role" | "status">>;
}

export interface DiffHunkPreview {
  header: string;
  beforeStart: number;
  beforeEnd: number;
  afterStart: number;
  afterEnd: number;
  beforeLines: string[];
  afterLines: string[];
}

export interface DiffPreview {
  targetPath?: string;
  beforeText?: string;
  afterText?: string;
  previewBeforeUri?: string;
  previewAfterUri?: string;
  hunks?: DiffHunkPreview[];
}

export interface ApprovalRequest {
  id: string;
  createdAt: number;
  missionId: string;
  kind: "write_file" | "apply_patch" | "terminal" | "external_tool";
  title: string;
  details: string;
  toolCall: ToolCall;
  status: "pending" | "approved" | "rejected";
  resolutionNote?: string;
  diffPreview?: DiffPreview;
  /** Work item that was blocked pending this approval; cleared to `done` after approved execution. */
  workItemId?: string;
}


export interface ApprovalBundle {
  id: string;
  missionId: string;
  title: string;
  status: "pending" | "mixed" | "approved" | "rejected";
  approvalIds: string[];
  kinds: ApprovalRequest["kind"][];
  createdAt: number;
  targetPaths?: string[];
}

export interface Mission {
  id: string;
  title: string;
  prompt: string;
  createdAt: number;
  updatedAt: number;
  status: MissionStatus;
  activeProviderId: string;
  activeModel?: string;
  routing?: MissionAgentRouting;
  queue: WorkItem[];
  memory: MemoryItem[];
  events: MissionEvent[];
  checkpoints: MissionCheckpoint[];
  approvals: ApprovalRequest[];
  result?: string;
  blocker?: string;
  /** Set with known orchestrator pause semantics; omit for arbitrary failures or legacy missions. */
  blockReasonCode?: MissionBlockReasonCode;
  /** When status is `failed`, set by the orchestrator for known fatal paths. Omitted for non-failed missions. */
  failureReasonCode?: MissionFailureReasonCode;
  currentStep: number;
  policy: MissionPolicy;
  validationState?: "pending" | "passed" | "failed";
  roundsCompleted?: number;
  runtime?: MissionRuntime;
  /** When true, mutating tools are skipped — the mission plans but does not execute changes. */
  dryRun?: boolean;
  /** Set of file paths modified by tool calls during this mission (for post-mission review). */
  filesModified?: string[];
  /** Archived missions are hidden from default dashboard lists but retained in persistence. */
  archivedAt?: number;
  /**
   * When the mission reaches `completed` via a bounded recovery or no-tool satisfied path.
   * Omitted for normal completions.
   */
  completionReason?:
    | "stale_patch_but_goal_already_met"
    | "already_satisfied_no_tool_run"
    | "apply_patch_noop_success";
  /** Upfront plan (blueprint mode). Omitted for legacy missions. */
  blueprint?: MissionBlueprint;
  /** User-requested blueprint revision rounds (for cap). */
  blueprintRevisionCount?: number;
  /** Pre-blueprint clarification (questions from planner; operator answers before blueprint JSON). */
  preBlueprintClarification?: PreBlueprintClarificationState;
}

export interface ChatContext {
  workspaceName?: string;
  fileName?: string;
  selection?: string;
  activeFileText?: string;
  diagnostics?: Array<{ message: string; severity: string; line: number }>;
  workspaceFolders?: string[];
  /** High-level project overview: file tree, manifest summaries, git info. */
  projectOverview?: string;
  /** Snippet summaries from files relevant to the current work item. */
  relevantFileSnippets?: Array<{ file: string; snippet: string }>;
  /** Workspace-wide diagnostics summary (errors + warnings). */
  allDiagnosticsSummary?: string;
  /** Current git status (branch, modified files, short diff). */
  gitStatus?: string;
}

export interface ChatHistoryEntry {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  prompt: string;
  model?: string;
  context: ChatContext;
  system?: string;
  /** Prior conversation turns for multi-turn chat continuity. */
  history?: ChatHistoryEntry[];
  /** When set, providers should abort in-flight network or LM requests when aborted. */
  signal?: AbortSignal;
}

/** Passed from MissionOrchestrator into agent runs so LLM streams can be cancelled mid-flight. */
export interface AgentRunOptions {
  signal?: AbortSignal;
  /** Called with each partial LLM token chunk for live streaming to the UI. */
  onChunk?: (chunk: string) => void;
}

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface ToolApproval {
  kind: ApprovalRequest["kind"];
  title: string;
  details: string;
  diffPreview?: DiffPreview;
}

export interface AgentTurnResult {
  summary: string;
  newMemory?: Omit<MemoryItem, "id" | "ts">[];
  events?: Omit<MissionEvent, "id" | "ts">[];
  toolCalls?: ToolCall[];
  nextWorkItems?: WorkItem[];
  markStatus?: WorkItem["status"];
  decision?: "complete" | "needs_followup" | "blocked";
}

export interface McpToolDescriptor {
  server: string;
  name: string;
  description?: string;
  inputSchema?: unknown;
  /** Present in compact `listMcpTools` summaries: top-level `properties` keys from inputSchema. */
  inputPropertyNames?: string[];
  sessionState?: "disconnected" | "starting" | "ready" | "error";
}

export interface ExternalToolAdapterDefinition {
  name: string;
  type: "http";
  method?: "GET" | "POST";
  url: string;
  description?: string;
  mutating?: boolean;
  headers?: Record<string, string>;
}

/** `listTools` `external` payload when URLs are redacted (no secrets in model context). */
export type ExternalToolAdapterPublicSummary = Pick<
  ExternalToolAdapterDefinition,
  "name" | "type" | "method" | "description" | "mutating"
>;
