import { MemoryItem, Mission } from "../types";
import { PersistedMcpSessionState } from "./DiskMissionPersistence";

export const PERSISTENCE_SCHEMA_VERSION = 1;

export interface PersistedEnvelope<T> {
  schemaVersion: number;
  kind: "mission" | "global_memory" | "mcp_sessions";
  writtenAt?: number;
  payload: T;
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

function tryMigrateLegacyEnvelope(raw: unknown, expectedKind: PersistedEnvelope<unknown>["kind"]): PersistedEnvelope<unknown> | undefined {
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
