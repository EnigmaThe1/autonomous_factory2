/**
 * Builds a shell command from a user-defined template for optional browser/screenshot CLIs.
 * Template must include literal `{url}` and `{outPath}`; values are single-quoted for POSIX shells.
 */

export function escapeForPosixSingleQuotes(s: string): string {
  return `'${s.replace(/'/g, `'\"'\"'`)}'`;
}

export function buildBrowserCaptureCommand(
  template: string,
  url: string,
  outPath: string
): { ok: true; command: string } | { ok: false; reason: string } {
  const t = template.trim();
  if (!t) {
    return { ok: false, reason: "Empty capture command template" };
  }
  if (!t.includes("{url}")) {
    return { ok: false, reason: "Template must include {url}" };
  }
  if (!t.includes("{outPath}")) {
    return { ok: false, reason: "Template must include {outPath}" };
  }
  const eu = escapeForPosixSingleQuotes(url);
  const ep = escapeForPosixSingleQuotes(outPath);
  const command = t.split("{url}").join(eu).split("{outPath}").join(ep);
  return { ok: true, command };
}
