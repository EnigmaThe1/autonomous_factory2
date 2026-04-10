import type { MissionProgram } from "../types";
import { uid } from "../util";
import type { DiskMissionPersistence } from "../storage/DiskMissionPersistence";
import type { MissionStore } from "./MissionStore";

/**
 * Persisted cross-mission programs / roadmaps. Missions reference `programId`; `missionIds` is kept in sync.
 */
export class ProgramDirectory {
  private items = new Map<string, MissionProgram>();

  constructor(private readonly disk: DiskMissionPersistence) {}

  async hydrate(): Promise<void> {
    const list = await this.disk.loadPrograms();
    this.items = new Map(list.map((p) => [p.id, p]));
  }

  list(): MissionProgram[] {
    return [...this.items.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): MissionProgram | undefined {
    return this.items.get(id);
  }

  async createProgram(title: string, roadmap?: string): Promise<MissionProgram> {
    const now = Date.now();
    const p: MissionProgram = {
      id: uid("prog"),
      title: title.trim().slice(0, 200) || "Program",
      ...(roadmap?.trim() ? { roadmap: roadmap.trim().slice(0, 64_000) } : {}),
      missionIds: [],
      createdAt: now,
      updatedAt: now
    };
    this.items.set(p.id, p);
    await this.persist();
    return p;
  }

  async updateProgramRoadmap(programId: string, roadmap: string): Promise<boolean> {
    const p = this.items.get(programId);
    if (!p) return false;
    p.roadmap = roadmap.trim().slice(0, 64_000);
    p.updatedAt = Date.now();
    await this.persist();
    return true;
  }

  /**
   * Set mission's `programId` in the store and sync `missionIds` on programs.
   */
  async setMissionProgram(store: MissionStore, missionId: string, programId: string | undefined): Promise<boolean> {
    const mission = store.get(missionId);
    if (!mission) return false;
    const prev = mission.programId;
    if (prev === programId) return true;

    if (prev) {
      const oldP = this.items.get(prev);
      if (oldP) {
        oldP.missionIds = oldP.missionIds.filter((id) => id !== missionId);
        oldP.updatedAt = Date.now();
      }
    }

    await store.updateMission(missionId, { programId: programId || undefined });

    if (programId) {
      const p = this.items.get(programId);
      if (p && !p.missionIds.includes(missionId)) {
        p.missionIds.push(missionId);
        p.updatedAt = Date.now();
      }
    }

    await this.persist();
    return true;
  }

  private async persist(): Promise<void> {
    await this.disk.savePrograms(this.list());
  }
}
