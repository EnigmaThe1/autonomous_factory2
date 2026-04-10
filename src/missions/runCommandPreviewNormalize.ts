/**
 * Normalize model-provided runCommand `args.command` for persistence on mutating markers.
 * Non-string shapes still deserve a bounded preview so recovery heuristics can run when safe.
 */
const MAX_PREVIEW = 500;

export function normalizeRunCommandPreview(command: unknown): string | undefined {
  if (command === undefined || command === null) return undefined;
  if (typeof command === "string") {
    const t = command.trim();
    return t ? t.slice(0, MAX_PREVIEW) : undefined;
  }
  if (typeof command === "number" || typeof command === "boolean") {
    return String(command).slice(0, MAX_PREVIEW);
  }
  try {
    const s = JSON.stringify(command);
    if (!s) return undefined;
    return s.slice(0, MAX_PREVIEW);
  } catch {
    return "[unserializable command]".slice(0, MAX_PREVIEW);
  }
}
