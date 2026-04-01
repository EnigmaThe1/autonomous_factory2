
import * as vscode from "vscode";
import { WorkspacePaths } from "../storage/WorkspacePaths";
import { ExternalToolAdapterDefinition, ToolCall } from "../types";

export class ExternalToolAdapterRegistry {
  constructor(private readonly paths: WorkspacePaths) {}

  async list(): Promise<ExternalToolAdapterDefinition[]> {
    if (!vscode.workspace.getConfiguration().get<boolean>('myAi.tools.allowExternalAdapters', true)) return [];
    const uri = this.paths.externalAdaptersFile();
    if (!uri) return [];
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
      const adapters = Array.isArray(parsed?.adapters) ? parsed.adapters : Array.isArray(parsed) ? parsed : [];
      return adapters.filter((x: any) => x && x.name && x.type === 'http' && x.url) as ExternalToolAdapterDefinition[];
    } catch {
      return [];
    }
  }

  async get(name: string): Promise<ExternalToolAdapterDefinition | undefined> {
    const adapters = await this.list();
    return adapters.find((a) => a.name === name);
  }

  async execute(call: ToolCall, missionId: string): Promise<{ok:boolean; summary:string; data?:unknown; mutating?:boolean}> {
    const name = call.tool.replace(/^ext\./, '');
    const adapter = await this.get(name);
    if (!adapter) return { ok: false, summary: `Unknown external adapter: ${name}` };

    const method = adapter.method || 'POST';
    const body = JSON.stringify({ missionId, tool: name, args: call.args, workspaceFolders: vscode.workspace.workspaceFolders?.map((w) => w.uri.fsPath) || [] });
    const res = await fetch(adapter.url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(adapter.headers || {}) },
      body: method === 'GET' ? undefined : body
    });
    const raw = await res.text();
    let data: unknown = raw;
    try { data = JSON.parse(raw); } catch {}
    return {
      ok: res.ok,
      summary: res.ok ? `External adapter ${name} responded.` : `External adapter ${name} failed: ${res.status}`,
      data,
      mutating: Boolean(adapter.mutating)
    };
  }
}
