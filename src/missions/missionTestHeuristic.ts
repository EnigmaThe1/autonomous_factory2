/**
 * Detect “test/debug” missions for bulk cleanup. Avoid naive `includes("test")` so words like “latest” do not match.
 */
export function isLikelyOperatorTestMission(title: string, prompt: string): boolean {
  const t = title.trim();
  const blob = `${title}\n${prompt}`.toLowerCase();
  if (/\btest(?:ing|s|er|ed)?\b/.test(blob)) return true;
  if (/\btest\s*[\d:#.\-]/.test(blob)) return true;
  if (/\btest[-_]/.test(blob)) return true;
  if (/^test[-\s]/im.test(title)) return true;
  /** e.g. `TestMission`, `testmission` (no delimiter) */
  if (/^test/i.test(t)) return true;
  return false;
}
