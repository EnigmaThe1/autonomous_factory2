/**
 * Optional structured lines validators may emit for honest reporting (rules-aligned verdicts).
 */
const MAX_FIELD = 2000;

export interface ValidationVerdictExtract {
  validationVerdict?: string;
  validationLimits?: string;
}

export function extractValidationVerdictFromSummary(text: string): ValidationVerdictExtract {
  if (!text || typeof text !== "string") return {};
  const verdict = matchCaptured(text, /^VALIDATION_VERDICT:\s*(.+)$/im);
  const limits = matchCaptured(text, /^VALIDATION_LIMITS:\s*(.+)$/im);
  return {
    ...(verdict ? { validationVerdict: verdict.slice(0, MAX_FIELD) } : {}),
    ...(limits ? { validationLimits: limits.slice(0, MAX_FIELD) } : {})
  };
}

function matchCaptured(text: string, re: RegExp): string | undefined {
  const m = text.match(re);
  if (!m?.[1]) return undefined;
  const t = m[1].trim();
  return t || undefined;
}
