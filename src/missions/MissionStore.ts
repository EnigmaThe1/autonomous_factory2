import * as vscode from "vscode";
import { ApprovalRequest, MemoryItem, Mission, MissionCheckpoint, MissionEvent, MissionPolicy, MissionRuntime, WorkItem } from "../types";
import { uid } from "../util";
import { DiskMissionPersistence } from "../storage/DiskMissionPersistence";
import { isAllowedMissionStatusTransition } from "./LifecycleRules";
import { canonicalizeStoredRouting, snapshotRoutingFromWorkspace } from "./missionRouting";
import { isLikelyOperatorTestMission } from "./missionTestHeuristic";

const MISSIONS_KEY = "myAi.missions";
const ACTIVE_IDS_KEY = "myAi.activeMissionIds";

export class MissionStore {
  /**
   * Bumps on every persistence change to `MISSIONS_KEY` (upsert/delete/hydrate merge).
   * Poll routing can treat unchanged generation as "mission list JSON in storage unchanged" and reuse a cached
   * `missionVisibleListFingerprint` without re-listing/normalizing all missions. `markActive` does not bump
   * (active set is not part of that fingerprint).
   */
  private missionMutationGenerationCounter = 0;

  /** Per-mission listeners notified after successful persisted mission document changes (microtask). */
  private readonly missionMutationListeners = new Map<string, Set<() => void>>();

  constructor(
    private readonly globalState: vscode.Memento,
    private readonly workspaceState: vscode.Memento,
    private readonly disk: DiskMissionPersistence
  ) {}

  /** Monotonic counter; increments when stored mission documents change. */
  getMissionMutationGeneration(): number {
    return this.missionMutationGenerationCounter;
  }

  private bumpMissionMutationGeneration(): void {
    this.missionMutationGenerationCounter += 1;
  }

  /**
   * Subscribe to persisted mutations for one mission (`upsert` / `deleteMission` / `hydrateFromDisk`
   * when disk wins the merge for that id).
   * Callbacks run on a microtask after the write succeeds. Returns unsubscribe.
   */
  subscribeMissionMutation(missionId: string, listener: () => void): () => void {
    let set = this.missionMutationListeners.get(missionId);
    if (!set) {
      set = new Set();
      this.missionMutationListeners.set(missionId, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) {
        this.missionMutationListeners.delete(missionId);
      }
    };
  }

  private scheduleMissionMutationDelivery(missionId: string): void {
    queueMicrotask(() => {
      const listeners = this.missionMutationListeners.get(missionId);
      if (!listeners?.size) return;
      for (const fn of [...listeners]) {
        try {
          fn();
        } catch {
          /* never break store */
        }
      }
    });
  }

  private defaultPolicy(): MissionPolicy {
    const cfg = vscode.workspace.getConfiguration();
    const preset = cfg.get<string>("myAi.missions.policyPreset", "balanced") as MissionPolicy["policyPreset"];
    const presets: Record<string, Partial<MissionPolicy>> = {
      light: {
        closureRequired: true, requireReviewerBeforeComplete: false, requireValidatorBeforeComplete: true,
        requireImplementerBeforeComplete: true, minCompletedWorkItems: 2, maxAutoRounds: 12,
        stallReplanThreshold: 2, requireValidationEvidence: false, policyPreset: "light"
      },
      balanced: {
        closureRequired: true, requireReviewerBeforeComplete: true, requireValidatorBeforeComplete: true,
        requireImplementerBeforeComplete: true, minCompletedWorkItems: 4, maxAutoRounds: 24,
        stallReplanThreshold: 3, requireValidationEvidence: true, policyPreset: "balanced"
      },
      strict: {
        closureRequired: true, requireReviewerBeforeComplete: true, requireValidatorBeforeComplete: true,
        requireImplementerBeforeComplete: true, minCompletedWorkItems: 6, maxAutoRounds: 40,
        stallReplanThreshold: 4, requireValidationEvidence: true, policyPreset: "strict"
      }
    };
    const base = presets[preset || "balanced"] || presets.balanced;
    return {
      closureRequired: cfg.get<boolean>("myAi.missions.closureRequired", base.closureRequired ?? true),
      requireReviewerBeforeComplete: cfg.get<boolean>("myAi.missions.requireReviewerBeforeComplete", base.requireReviewerBeforeComplete ?? true),
      requireValidatorBeforeComplete: cfg.get<boolean>("myAi.missions.requireValidatorBeforeComplete", base.requireValidatorBeforeComplete ?? true),
      requireImplementerBeforeComplete: cfg.get<boolean>("myAi.missions.requireImplementerBeforeComplete", base.requireImplementerBeforeComplete ?? true),
      autoContinue: true,
      maxAutoRounds: cfg.get<number>("myAi.missions.maxAutoRounds", base.maxAutoRounds ?? 24),
      minCompletedWorkItems: cfg.get<number>("myAi.missions.minCompletedWorkItems", base.minCompletedWorkItems ?? 4),
      stallReplanThreshold: cfg.get<number>("myAi.missions.stallReplanThreshold", base.stallReplanThreshold ?? 3),
      policyPreset: preset || "balanced",
      requireValidationEvidence: cfg.get<boolean>("myAi.missions.requireValidationEvidence", base.requireValidationEvidence ?? true)
    };
  }

  private defaultRuntime(): MissionRuntime {
    return {
      lastProgressAt: undefined,
      lastRunnerHeartbeatAt: undefined,
      stalledHeartbeats: 0,
      autoReplans: 0,
      loopGuardTrips: 0,
      runnerOwnerId: undefined,
      runnerLeaseExpiresAt: undefined
    };
  }

  async hydrateFromDisk(): Promise<void> {
    const diskMissions = await this.disk.loadAll();
    if (!diskMissions.length) return;
    const current = this.globalState.get<Mission[]>(MISSIONS_KEY, []);
    const merged = new Map<string, Mission>();
    for (const mission of current) merged.set(mission.id, mission);
    const diskAppliedIds = new Set<string>();
    for (const mission of diskMissions) {
      const existing = merged.get(mission.id);
      const normalized = this.normalizeMission(mission);
      if (!existing || normalized.updatedAt > existing.updatedAt) {
        merged.set(normalized.id, normalized);
        diskAppliedIds.add(normalized.id);
      }
    }
    await this.globalState.update(MISSIONS_KEY, [...merged.values()]);
    this.bumpMissionMutationGeneration();
    for (const id of diskAppliedIds) {
      this.scheduleMissionMutationDelivery(id);
    }
  }

  list(): Mission[] {
    const raw = this.globalState.get<Mission[]>(MISSIONS_KEY, []);
    return raw.map((m) => this.normalizeMission(m)).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  listVisible(includeArchived: boolean): Mission[] {
    const all = this.list();
    if (includeArchived) return all;
    return all.filter((m) => !m.archivedAt);
  }

  get(id: string): Mission | undefined { return this.list().find((m) => m.id === id); }

  async upsert(mission: Mission): Promise<void> {
    const normalized = this.normalizeMission(mission);
    const all = this.list().filter((m) => m.id !== normalized.id);
    all.push(normalized);
    await this.globalState.update(MISSIONS_KEY, all);
    await this.disk.saveMission(normalized);
    this.bumpMissionMutationGeneration();
    this.scheduleMissionMutationDelivery(normalized.id);
  }

  async create(title: string, prompt: string, providerId: string, model?: string, policy?: Partial<MissionPolicy>): Promise<Mission> {
    const now = Date.now();
    const mission: Mission = {
      id: uid("mission"),
      title,
      prompt,
      createdAt: now,
      updatedAt: now,
      status: "queued",
      activeProviderId: providerId,
      activeModel: model,
      routing: snapshotRoutingFromWorkspace(vscode.workspace.getConfiguration()),
      queue: [],
      memory: [{ id: uid("mem"), ts: now, kind: "user", text: prompt, tags: ["prompt"] }],
      events: [],
      checkpoints: [],
      approvals: [],
      currentStep: 0,
      policy: { ...this.defaultPolicy(), ...(policy || {}) },
      validationState: "pending",
      roundsCompleted: 0,
      runtime: this.defaultRuntime()
    };
    await this.upsert(mission);
    await this.markActive(mission.id, true);
    return mission;
  }

  async saveEvent(missionId: string, event: Omit<MissionEvent, "id" | "ts">): Promise<void> {
    const mission = this.requireMission(missionId);
    mission.events.push({ id: uid("evt"), ts: Date.now(), ...event });
    mission.events = mission.events.slice(-400);
    mission.updatedAt = Date.now();
    await this.upsert(mission);
  }

  async addMemory(missionId: string, item: Omit<MemoryItem, "id" | "ts">): Promise<MemoryItem> {
    const mission = this.requireMission(missionId);
    const saved: MemoryItem = { id: uid("mem"), ts: Date.now(), ...item };
    mission.memory.push(saved);
    const max = vscode.workspace.getConfiguration().get<number>("myAi.memory.maxRecentEvents", 250);
    mission.memory = mission.memory.slice(-max);
    mission.updatedAt = Date.now();
    await this.upsert(mission);
    return saved;
  }

  async enqueue(missionId: string, items: WorkItem[]): Promise<void> {
    const mission = this.requireMission(missionId);
    mission.queue.push(...items);
    mission.updatedAt = Date.now();
    await this.upsert(mission);
  }

  async updateMission(missionId: string, patch: Partial<Mission>): Promise<void> {
    const mission = this.requireMission(missionId);
    if (patch.status && !isAllowedMissionStatusTransition(mission.status, patch.status)) {
      throw new Error(`Invalid mission status transition: ${mission.status} -> ${patch.status}`);
    }
    Object.assign(mission, patch, { updatedAt: Date.now() });
    mission.policy = { ...this.defaultPolicy(), ...(mission.policy || {}) };
    mission.runtime = { ...this.defaultRuntime(), ...(mission.runtime || {}) };
    if (patch.routing !== undefined) {
      mission.routing = canonicalizeStoredRouting(patch.routing);
    } else {
      mission.routing = canonicalizeStoredRouting(mission.routing);
    }
    await this.upsert(mission);
    if (patch.status && ["completed", "failed", "cancelled"].includes(patch.status)) await this.markActive(missionId, false);
    if (patch.status && ["queued", "running", "awaiting_input", "blocked"].includes(patch.status)) await this.markActive(missionId, true);
  }

  async archiveMission(missionId: string): Promise<void> {
    const mission = this.requireMission(missionId);
    if (["queued", "running", "awaiting_input"].includes(mission.status)) {
      throw new Error("Cannot archive an actively running mission. Pause or complete it first.");
    }
    mission.archivedAt = Date.now();
    mission.updatedAt = Date.now();
    await this.upsert(mission);
    await this.markActive(missionId, false);
  }

  async unarchiveMission(missionId: string): Promise<void> {
    const mission = this.requireMission(missionId);
    mission.archivedAt = undefined;
    mission.updatedAt = Date.now();
    await this.upsert(mission);
    if (["queued", "running", "awaiting_input", "blocked"].includes(mission.status)) {
      await this.markActive(missionId, true);
    }
  }

  async deleteMission(missionId: string): Promise<void> {
    const mission = this.requireMission(missionId);
    if (["queued", "running", "awaiting_input"].includes(mission.status)) {
      throw new Error("Cannot delete an actively running mission.");
    }
    const all = this.list().filter((m) => m.id !== missionId);
    await this.globalState.update(MISSIONS_KEY, all);
    await this.markActive(missionId, false);
    await this.disk.deleteMission(missionId);
    this.bumpMissionMutationGeneration();
    this.scheduleMissionMutationDelivery(missionId);
  }

  private isLikelyTestMission(mission: Mission): boolean {
    return isLikelyOperatorTestMission(mission.title, mission.prompt);
  }

  async bulkArchiveCompletedMissions(): Promise<number> {
    const ids = this.list().filter((m) => m.status === "completed" && !m.archivedAt).map((m) => m.id);
    let archived = 0;
    for (const id of ids) {
      try {
        await this.archiveMission(id);
        archived++;
      } catch {
        /* skip missions that cannot be archived (e.g. still active) */
      }
    }
    return archived;
  }

  /** @returns deleted count and skipped count (still active, etc.) */
  async bulkDeleteFailedTestMissions(): Promise<{ deleted: number; skipped: number }> {
    const ids = this.list()
      .filter((m) => m.status === "failed" && this.isLikelyTestMission(m))
      .map((m) => m.id);
    let deleted = 0;
    let skipped = 0;
    for (const id of ids) {
      try {
        await this.deleteMission(id);
        deleted++;
      } catch {
        skipped++;
      }
    }
    return { deleted, skipped };
  }

  /** @returns deleted count and skipped count (still active, etc.) */
  async bulkDeleteBlockedTestMissions(): Promise<{ deleted: number; skipped: number }> {
    const ids = this.list()
      .filter((m) => m.status === "blocked" && this.isLikelyTestMission(m))
      .map((m) => m.id);
    let deleted = 0;
    let skipped = 0;
    for (const id of ids) {
      try {
        await this.deleteMission(id);
        deleted++;
      } catch {
        skipped++;
      }
    }
    return { deleted, skipped };
  }

  async updateRuntime(missionId: string, patch: Partial<MissionRuntime>): Promise<void> {
    const mission = this.requireMission(missionId);
    mission.runtime = { ...this.defaultRuntime(), ...(mission.runtime || {}), ...patch };
    mission.updatedAt = Date.now();
    await this.upsert(mission);
  }

  async noteProgress(missionId: string): Promise<void> {
    const mission = this.requireMission(missionId);
    mission.runtime = {
      ...this.defaultRuntime(),
      ...(mission.runtime || {}),
      lastProgressAt: Date.now(),
      stalledHeartbeats: 0
    };
    mission.updatedAt = Date.now();
    await this.upsert(mission);
  }

  async updateWorkItem(missionId: string, itemId: string, patch: Partial<WorkItem>): Promise<void> {
    const mission = this.requireMission(missionId);
    const idx = mission.queue.findIndex((w) => w.id === itemId);
    if (idx < 0) return;
    mission.queue[idx] = { ...mission.queue[idx], ...patch };
    mission.updatedAt = Date.now();
    await this.upsert(mission);
  }

  async addApproval(missionId: string, request: ApprovalRequest): Promise<void> {
    const mission = this.requireMission(missionId);
    mission.approvals.push(request);
    mission.updatedAt = Date.now();
    await this.upsert(mission);
  }

  async resolveApproval(missionId: string, approvalId: string, status: "approved" | "rejected", note?: string): Promise<ApprovalRequest | undefined> {
    const mission = this.requireMission(missionId);
    const approval = mission.approvals.find((a) => a.id === approvalId);
    if (!approval || approval.status !== "pending") return undefined;
    approval.status = status;
    approval.resolutionNote = note;
    mission.updatedAt = Date.now();
    await this.upsert(mission);
    return approval;
  }

  async addCheckpoint(missionId: string, checkpoint: Omit<MissionCheckpoint, "id" | "ts">): Promise<void> {
    const mission = this.requireMission(missionId);
    mission.checkpoints.push({ id: uid("ck"), ts: Date.now(), ...checkpoint });
    mission.checkpoints = mission.checkpoints.slice(-80);
    await this.addMemory(missionId, { kind: "checkpoint", text: checkpoint.summary, tags: ["checkpoint"] });
    mission.updatedAt = Date.now();
    await this.upsert(mission);
  }

  getActiveMissionIds(): string[] { return this.workspaceState.get<string[]>(ACTIVE_IDS_KEY, []); }

  async markActive(missionId: string, active: boolean): Promise<void> {
    const ids = new Set(this.getActiveMissionIds());
    if (active) ids.add(missionId); else ids.delete(missionId);
    await this.workspaceState.update(ACTIVE_IDS_KEY, [...ids]);
  }

  private requireMission(id: string): Mission {
    const mission = this.get(id);
    if (!mission) throw new Error(`Mission not found: ${id}`);
    return mission;
  }

  private normalizeMission(mission: Mission): Mission {
    return {
      ...mission,
      policy: { ...this.defaultPolicy(), ...(mission.policy || {}) },
      validationState: mission.validationState || "pending",
      roundsCompleted: mission.roundsCompleted || 0,
      runtime: { ...this.defaultRuntime(), ...(mission.runtime || {}) },
      routing: canonicalizeStoredRouting(mission.routing),
      archivedAt: mission.archivedAt
    };
  }
}
