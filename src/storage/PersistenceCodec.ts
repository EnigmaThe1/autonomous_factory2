import { MemoryItem, Mission, MissionProgram } from "../types";
import { PersistedMcpSessionState } from "./DiskMissionPersistence";

export const PERSISTENCE_SCHEMA_VERSION = 1;

export interface PersistedEnvelope<T> {
  schemaVersion: number;
  kind: "mission" | "global_memory" | "mcp_sessions" | "mission_programs";
  writtenAt?: number;
  payload: T;
}

export interface PersistedProgramsPayload {
  programs: MissionProgram[];
}

export function wrapMission(mission: Mission): PersistedEnvelope<Mission> {
  return { schemaVersion: PERSISTENCE_SCHEMA_VERSION, kind: "mission", writtenAt: Date.now(), payload: mission };
}

export function unwrapMission(raw: unknown): Mission {
  if (isMission(raw)) return raw;
  const migrated = tryMigrateLegacyEnvelope(raw, "mission");
  if (migrated && isMission(migrated.payload)) return migrated.payload;
  if (isEnvelope(raw, "mission") && isMission(raw.payload)) return raw.payload;
  throw new Error("Invalid mission payload.");
}

export function wrapGlobalMemory(items: MemoryItem[]): PersistedEnvelope<MemoryItem[]> {
  return { schemaVersion: PERSISTENCE_SCHEMA_VERSION, kind: "global_memory", writtenAt: Date.now(), payload: items };
}

export function unwrapGlobalMemory(raw: unknown): MemoryItem[] {
  if (Array.isArray(raw)) return raw as MemoryItem[];
  const migrated = tryMigrateLegacyEnvelope(raw, "global_memory");
  if (migrated && Array.isArray(migrated.payload)) return migrated.payload as MemoryItem[];
  if (isEnvelope(raw, "global_memory") && Array.isArray(raw.payload)) return raw.payload as MemoryItem[];
  throw new Error("Invalid global memory payload.");
}

export function wrapMcpSessions(items: PersistedMcpSessionState[]): PersistedEnvelope<PersistedMcpSessionState[]> {
  return { schemaVersion: PERSISTENCE_SCHEMA_VERSION, kind: "mcp_sessions", writtenAt: Date.now(), payload: items };
}

export function unwrapMcpSessions(raw: unknown): PersistedMcpSessionState[] {
  if (Array.isArray(raw)) return raw as PersistedMcpSessionState[];
  const migrated = tryMigrateLegacyEnvelope(raw, "mcp_sessions");
  if (migrated && Array.isArray(migrated.payload)) return migrated.payload as PersistedMcpSessionState[];
  if (isEnvelope(raw, "mcp_sessions") && Array.isArray(raw.payload)) return raw.payload as PersistedMcpSessionState[];
  throw new Error("Invalid MCP sessions payload.");
}

export function wrapPrograms(programs: MissionProgram[]): PersistedEnvelope<PersistedProgramsPayload> {
  return {
    schemaVersion: PERSISTENCE_SCHEMA_VERSION,
    kind: "mission_programs",
    writtenAt: Date.now(),
    payload: { programs }
  };
}

export function unwrapPrograms(raw: unknown): MissionProgram[] {
  if (Array.isArray(raw)) return normalizeProgramsArray(raw);
  if (raw && typeof raw === "object" && Array.isArray((raw as PersistedProgramsPayload).programs)) {
    return normalizeProgramsArray((raw as PersistedProgramsPayload).programs);
  }
  if (isEnvelope(raw, "mission_programs") && raw.payload && typeof raw.payload === "object") {
    const p = (raw.payload as PersistedProgramsPayload).programs;
    if (Array.isArray(p)) return normalizeProgramsArray(p);
  }
  throw new Error("Invalid mission programs payload.");
}

function normalizeProgramsArray(arr: unknown[]): MissionProgram[] {
  const out: MissionProgram[] = [];
  for (const row of arr) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.title !== "string") continue;
    const missionIds = Array.isArray(o.missionIds)
      ? o.missionIds.filter((x): x is string => typeof x === "string")
      : [];
    out.push({
      id: o.id,
      title: o.title,
      ...(typeof o.roadmap === "string" ? { roadmap: o.roadmap } : {}),
      missionIds,
      createdAt: typeof o.createdAt === "number" ? o.createdAt : Date.now(),
      updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : Date.now()
    });
  }
  return out;
}

function isEnvelope(raw: unknown, kind: PersistedEnvelope<unknown>["kind"]): raw is PersistedEnvelope<unknown> {
  if (!raw || typeof raw !== "object") return false;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.schemaVersion !== "number" || obj.kind !== kind || !("payload" in obj)) return false;
  if (obj.schemaVersion > PERSISTENCE_SCHEMA_VERSION) {
    throw new Error(`Unsupported persistence schema version: ${obj.schemaVersion}`);
  }
  return true;
}

function isMission(raw: unknown): raw is Mission {
  if (!raw || typeof raw !== "object") return false;
  const obj = raw as Record<string, unknown>;
  return typeof obj.id === "string" && typeof obj.title === "string" && Array.isArray(obj.queue) && Array.isArray(obj.memory);
}

function tryMigrateLegacyEnvelope(
  raw: unknown,
  expectedKind: "mission" | "global_memory" | "mcp_sessions"
): PersistedEnvelope<unknown> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  if (obj.schemaVersion !== 0) return undefined;
  const legacyKind = typeof obj.kind === "string" ? obj.kind : undefined;
  if (legacyKind !== expectedKind) return undefined;
  if (!("data" in obj)) return undefined;
  return {
    schemaVersion: PERSISTENCE_SCHEMA_VERSION,
    kind: expectedKind,
    writtenAt: Date.now(),
    payload: obj.data
  };
}
