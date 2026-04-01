function text(v: unknown): string {
  return typeof v === "string" ? v.toLowerCase() : "";
}

/**
 * Missing files are expected on first run and should not be reported as
 * persistence corruption/load issues.
 */
export function shouldIgnorePersistenceReadError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { code?: unknown; name?: unknown; message?: unknown };
  const code = text(e.code);
  const name = text(e.name);
  const message = text(e.message);
  return code === "enoent"
    || code === "filenotfound"
    || name.includes("filenotfound")
    || message.includes("enoent")
    || message.includes("no such file")
    || message.includes("file not found");
}
