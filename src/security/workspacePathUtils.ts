import * as path from "path";

export function isPathInWorkspace(workspaceRoot: string | undefined, targetPath: string): boolean {
  if (!workspaceRoot) return false;
  const normalizedRoot = path.resolve(workspaceRoot);
  const normalizedTarget = path.resolve(targetPath);
  const rel = path.relative(normalizedRoot, normalizedTarget);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
