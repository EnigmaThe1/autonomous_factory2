import type { MissionStore } from "./MissionStore";

/**
 * Tracks files modified during mission execution.
 * Called by ToolRegistry after successful write/patch operations.
 */
export class MissionFileTracker {
  private readonly modified = new Map<string, Set<string>>();

  constructor(private readonly store: MissionStore) {}

  trackFile(missionId: string, filePath: string): void {
    let files = this.modified.get(missionId);
    if (!files) {
      files = new Set();
      this.modified.set(missionId, files);
    }
    files.add(filePath);
  }

  getModifiedFiles(missionId: string): string[] {
    return [...(this.modified.get(missionId) || [])].sort();
  }

  async flush(missionId: string): Promise<void> {
    const files = this.getModifiedFiles(missionId);
    if (!files.length) return;
    const mission = this.store.get(missionId);
    if (!mission) return;
    const existing = new Set(mission.filesModified || []);
    for (const f of files) existing.add(f);
    await this.store.updateMission(missionId, {
      filesModified: [...existing].sort(),
    });
  }

  clear(missionId: string): void {
    this.modified.delete(missionId);
  }
}
