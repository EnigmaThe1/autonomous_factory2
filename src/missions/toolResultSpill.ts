import * as vscode from "vscode";
import { uid } from "../util";
import type { MissionEvent } from "../types";

export function jsonUtf8ByteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

type ToolEventDataShape = {
  ok?: boolean;
  tool?: string;
  meta?: unknown;
  result?: unknown;
  [key: string]: unknown;
};

/**
 * When mission event `data` is large (typical: runCommand stdout, test output), write full JSON next to
 * the workspace disk store and persist a compact inline payload so mission JSON/global state stays smaller.
 */
export async function spillMissionEventDataIfLarge(args: {
  missionId: string;
  event: Omit<MissionEvent, "id" | "ts">;
  maxInlineBytes: number;
  enabled: boolean;
}): Promise<Omit<MissionEvent, "id" | "ts">> {
  const { missionId, event, maxInlineBytes, enabled } = args;
  if (!enabled || event.data === undefined) return event;

  const bytes = jsonUtf8ByteLength(event.data);
  if (bytes <= maxInlineBytes) return event;

  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) {
    return truncateEventDataInPlace(event, maxInlineBytes);
  }

  const diskFolder = vscode.workspace.getConfiguration().get<string>("myAi.missions.diskStoreFolder", ".my-ai-extension");
  const spillDir = vscode.Uri.joinPath(root, diskFolder, "tool-spills", missionId);
  try {
    await vscode.workspace.fs.createDirectory(spillDir);
  } catch {
    return truncateEventDataInPlace(event, maxInlineBytes);
  }

  const name = `spill-${Date.now()}-${uid("sp")}.json`;
  const fileUri = vscode.Uri.joinPath(spillDir, name);
  let raw: string;
  try {
    raw = JSON.stringify(event.data, null, 0);
  } catch {
    return event;
  }

  try {
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(raw, "utf8"));
  } catch {
    return truncateEventDataInPlace(event, maxInlineBytes);
  }

  const relPath = `${diskFolder}/tool-spills/${missionId}/${name}`;
  const d = event.data as ToolEventDataShape;
  const preview = raw.slice(0, 1200);
  return {
    ...event,
    data: {
      _toolResultSpill: true,
      spillRelativePath: relPath,
      spillByteSize: bytes,
      spillPreview: preview.length < raw.length ? `${preview}…` : preview,
      ok: d.ok,
      tool: d.tool,
      meta: d.meta
    }
  };
}

function truncateEventDataInPlace(
  event: Omit<MissionEvent, "id" | "ts">,
  maxInlineBytes: number
): Omit<MissionEvent, "id" | "ts"> {
  const raw = (() => {
    try {
      return JSON.stringify(event.data);
    } catch {
      return "";
    }
  })();
  if (!raw) return event;
  let end = Math.min(raw.length, maxInlineBytes);
  while (end > 0 && Buffer.byteLength(raw.slice(0, end), "utf8") > maxInlineBytes) {
    end -= 1;
  }
  return {
    ...event,
    data: {
      _toolResultTruncated: true,
      truncatedByteCap: maxInlineBytes,
      preview: raw.slice(0, end) + (end < raw.length ? "…" : "")
    }
  };
}
