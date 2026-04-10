/**
 * Fixture missions store prompts in workspace-local `MISSION_PROMPT.md`.
 * This helper extracts the intended “paste into Start mission” content.
 *
 * Heuristic by design:
 * - Prefer the section under heading "## Mission prompt".
 * - If not found, fall back to the whole file (bounded).
 */
export function extractFixtureMissionPrompt(markdown: string): string {
  const text = String(markdown || "");
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  const idx = lines.findIndex((l) => /^##\s+mission prompt\b/i.test(l.trim()));
  if (idx < 0) return text.trim();

  // Skip heading line + subsequent blank lines.
  let i = idx + 1;
  while (i < lines.length && lines[i]!.trim() === "") i++;

  const out: string[] = [];
  for (; i < lines.length; i++) {
    const raw = lines[i]!;
    if (/^##\s+/.test(raw.trim())) break; // next section
    out.push(raw);
  }

  const extracted = out.join("\n").trim();
  return extracted || text.trim();
}

