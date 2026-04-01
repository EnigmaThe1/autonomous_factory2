/**
 * VS Code / Cursor file providers sometimes implement overwrite as "delete dest, then rename".
 * When the destination file has never existed, that delete can throw EntryNotFound / FileSystemError
 * even though the rename-to-new-file case should succeed without overwrite.
 */

export function isLikelyMissingPathFilesystemError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const o = err as { code?: string; message?: string };
  const code = String(o.code || "");
  const msg = String(o.message || "").toLowerCase();
  return (
    code === "ENOENT" ||
    /entrynotfound|file not found|enoent|no such file|nonexistent|does not exist/i.test(msg) ||
    (/unable to delete/i.test(msg) && /nonexistent|not found|enoent|entrynotfound/i.test(msg))
  );
}

export function isLikelyFileExistsFilesystemError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const o = err as { code?: string; message?: string };
  const code = String(o.code || "");
  const msg = String(o.message || "").toLowerCase();
  return code === "EEXIST" || /\balready exists\b|\beexist\b/i.test(msg);
}
