import * as vscode from "vscode";
import { runCommand } from "./CommandRunner";
import { trimText } from "../util";

export interface DockerToolResult {
  ok: boolean;
  summary: string;
  data?: unknown;
}

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export async function dockerPs(): Promise<DockerToolResult> {
  const r = await runCommand({
    command: 'docker ps --format "table {{.ID}}\\t{{.Names}}\\t{{.Status}}\\t{{.Ports}}\\t{{.Image}}"',
    cwd: workspaceRoot(),
    timeoutMs: 10_000,
  });
  if (r.exitCode !== 0) return { ok: false, summary: r.stderr || "docker ps failed" };
  const lines = r.stdout.trim().split("\n");
  return { ok: true, summary: `${Math.max(0, lines.length - 1)} running container(s)`, data: r.stdout.trim() };
}

export async function dockerLogs(container: string, tail = 100): Promise<DockerToolResult> {
  const r = await runCommand({
    command: `docker logs --tail ${tail} ${container}`,
    cwd: workspaceRoot(),
    timeoutMs: 15_000,
    maxOutputBytes: 16_384,
  });
  if (r.exitCode !== 0) return { ok: false, summary: r.stderr || `docker logs ${container} failed` };
  const combined = `${r.stdout}\n${r.stderr}`.trim();
  return { ok: true, summary: `Logs for ${container} (${tail} lines)`, data: trimText(combined, 8000) };
}

export async function dockerExec(container: string, command: string): Promise<DockerToolResult> {
  const r = await runCommand({
    command: `docker exec ${container} ${command}`,
    cwd: workspaceRoot(),
    timeoutMs: 30_000,
    maxOutputBytes: 16_384,
  });
  if (r.exitCode !== 0) return { ok: false, summary: `docker exec failed (exit ${r.exitCode})`, data: { stdout: r.stdout, stderr: r.stderr } };
  return { ok: true, summary: `Executed in ${container}: ${command}`, data: { stdout: trimText(r.stdout, 8000), stderr: trimText(r.stderr, 2000) } };
}

export async function dockerComposeStatus(): Promise<DockerToolResult> {
  const cwd = workspaceRoot();
  const r = await runCommand({
    command: "docker compose ps --format json 2>/dev/null || docker-compose ps 2>&1",
    cwd,
    timeoutMs: 15_000,
  });
  if (r.exitCode !== 0) return { ok: false, summary: r.stderr || "docker compose ps failed" };
  return { ok: true, summary: "Docker Compose status", data: trimText(r.stdout, 6000) };
}

export async function dbQuery(engine: string, connectionString: string, query: string): Promise<DockerToolResult> {
  let command: string;
  switch (engine.toLowerCase()) {
    case "postgres":
    case "postgresql":
      command = `psql "${connectionString}" -c ${shellQuote(query)}`;
      break;
    case "mysql":
      command = `mysql ${connectionString} -e ${shellQuote(query)}`;
      break;
    case "sqlite":
      command = `sqlite3 "${connectionString}" ${shellQuote(query)}`;
      break;
    default:
      return { ok: false, summary: `Unsupported database engine: ${engine}` };
  }

  const r = await runCommand({ command, cwd: workspaceRoot(), timeoutMs: 30_000, maxOutputBytes: 16_384 });
  if (r.exitCode !== 0) return { ok: false, summary: `Query failed: ${r.stderr}`, data: { stderr: trimText(r.stderr, 4000) } };
  return { ok: true, summary: `Query executed (${r.stdout.split("\n").length} rows)`, data: trimText(r.stdout, 8000) };
}

export async function dbSchema(engine: string, connectionString: string): Promise<DockerToolResult> {
  let command: string;
  switch (engine.toLowerCase()) {
    case "postgres":
    case "postgresql":
      command = `pg_dump --schema-only "${connectionString}" 2>&1 | head -500`;
      break;
    case "mysql":
      command = `mysqldump --no-data ${connectionString} 2>&1 | head -500`;
      break;
    case "sqlite":
      command = `sqlite3 "${connectionString}" ".schema" 2>&1 | head -500`;
      break;
    default:
      return { ok: false, summary: `Unsupported database engine: ${engine}` };
  }

  const r = await runCommand({ command, cwd: workspaceRoot(), timeoutMs: 30_000, maxOutputBytes: 32_768 });
  if (r.exitCode !== 0) return { ok: false, summary: `Schema dump failed: ${r.stderr}` };
  return { ok: true, summary: `Schema dump for ${engine}`, data: trimText(r.stdout, 8000) };
}

function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
