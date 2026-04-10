/**
 * Heuristic: is this runCommand string very likely read-only (safe to replay after host interruption)?
 * Conservative: reject compound shells and known-mutating verbs.
 */
export function isRunCommandLikelyReadOnlyProbe(command: string): boolean {
  const c = command.trim();
  if (!c || c.length > 4000) return false;
  // Compound / subshell — too easy to hide side effects
  if (/[;&|`$()]/.test(c)) return false;
  if (/\b(bash|sh|zsh)\s+-c\b/i.test(c)) return false;

  if (
    /\b(rm\b|rmdir\b|mv\b|cp\b|mkdir\b|touch\b|chmod\b|chown\b|git\s|npm\s|pnpm\s|yarn\s|sudo\b|curl\b|wget\b|tee\b|openssl\b|\bdd\b|\bpython\b|\bnode\b|\bperl\b|>\s*[^\s|]|\b-dd\b|--delete\b)\b/i.test(c)
  ) {
    return false;
  }
  // find -delete is mutating
  if (/(?:^|\s)-delete\b/i.test(c)) return false;

  const m = c.match(/^\s*([^\s]+)/);
  const firstToken = (m?.[1] ?? "").replace(/^\.\//, "");
  const bin = firstToken.includes("/") ? (firstToken.split("/").pop() || firstToken) : firstToken;
  const base = bin.replace(/^-+/, "") || bin;

  const allow = new Set([
    "ls",
    "find",
    "cat",
    "head",
    "tail",
    "wc",
    "stat",
    "file",
    "pwd",
    "echo",
    "grep",
    "egrep",
    "fgrep",
    "rg",
    "id",
    "whoami",
    "date",
    "dirname",
    "basename",
    "readlink",
    "realpath",
    "which",
    "type"
  ]);
  return allow.has(base);
}
