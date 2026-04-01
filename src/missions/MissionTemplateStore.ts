import * as vscode from "vscode";
import { MissionTemplate } from "../types";
import { WorkspacePaths } from "../storage/WorkspacePaths";
import { uid } from "../util";

export class MissionTemplateStore {
  private templates = new Map<string, MissionTemplate>();

  constructor(private readonly paths: WorkspacePaths) {}

  async hydrate(): Promise<void> {
    const file = this.paths.templatesFile();
    if (!file) return;
    try {
      const raw = await vscode.workspace.fs.readFile(file);
      const arr = JSON.parse(Buffer.from(raw).toString("utf8"));
      if (Array.isArray(arr)) {
        this.templates.clear();
        for (const t of arr) {
          if (t?.id && t?.name) this.templates.set(t.id, t);
        }
      }
    } catch {
      // no file yet
    }
  }

  list(): MissionTemplate[] {
    return [...this.templates.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): MissionTemplate | undefined {
    return this.templates.get(id);
  }

  async save(template: Omit<MissionTemplate, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<MissionTemplate> {
    const now = Date.now();
    const existing = template.id ? this.templates.get(template.id) : undefined;
    const saved: MissionTemplate = {
      ...template,
      id: existing?.id || uid("tmpl"),
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    this.templates.set(saved.id, saved);
    await this.persist();
    return saved;
  }

  async delete(id: string): Promise<boolean> {
    const existed = this.templates.delete(id);
    if (existed) await this.persist();
    return existed;
  }

  private async persist(): Promise<void> {
    const file = this.paths.templatesFile();
    if (!file) return;
    const data = JSON.stringify(this.list(), null, 2);
    await vscode.workspace.fs.writeFile(file, Buffer.from(data, "utf8"));
  }
}
