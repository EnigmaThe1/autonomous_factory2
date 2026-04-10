/**
 * Optional structured lines validators may emit for honest reporting (rules-aligned verdicts).
 */
import type { ValidatorOutcomeKind, ValidatorStructuredOutcome, ValidatorSuspectedClass } from "./reviewValidatorOutcomeContracts";

const MAX_FIELD = 2000;

const OUTCOMES = new Set<ValidatorOutcomeKind>(["pass", "fail", "inconclusive"]);
const SUSPECT = new Set<ValidatorSuspectedClass>(["code", "environment", "unknown"]);

export interface ValidationVerdictExtract {
  validationVerdict?: string;
  validationLimits?: string;
}

export interface ValidationStructuredExtract extends ValidationVerdictExtract {
  validationOutcome?: ValidatorOutcomeKind;
  validationSuspectedClass?: ValidatorSuspectedClass;
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

/** Structured VALIDATION_OUTCOME / VALIDATION_SUSPECTED_CLASS plus legacy verdict lines. */
export function extractValidationStructuredFromSummary(text: string): ValidationStructuredExtract {
  const base = extractValidationVerdictFromSummary(text);
  if (!text || typeof text !== "string") return base;
  const rawOut = matchCaptured(text, /^VALIDATION_OUTCOME:\s*(\S+)/im)?.toLowerCase();
  let validationOutcome: ValidatorOutcomeKind | undefined;
  if (rawOut && OUTCOMES.has(rawOut as ValidatorOutcomeKind)) {
    validationOutcome = rawOut as ValidatorOutcomeKind;
  }
  const rawSus = matchCaptured(text, /^VALIDATION_SUSPECTED_CLASS:\s*(\S+)/im)?.toLowerCase();
  let validationSuspectedClass: ValidatorSuspectedClass | undefined;
  if (rawSus && SUSPECT.has(rawSus as ValidatorSuspectedClass)) {
    validationSuspectedClass = rawSus as ValidatorSuspectedClass;
  }
  return {
    ...base,
    ...(validationOutcome ? { validationOutcome } : {}),
    ...(validationSuspectedClass ? { validationSuspectedClass } : {})
  };
}

export function validationStructuredToOutcome(extract: ValidationStructuredExtract): ValidatorStructuredOutcome | undefined {
  if (!extract.validationOutcome) return undefined;
  return {
    outcome: extract.validationOutcome,
    ...(extract.validationSuspectedClass ? { suspectedClass: extract.validationSuspectedClass } : {})
  };
}

function matchCaptured(text: string, re: RegExp): string | undefined {
  const m = text.match(re);
  if (!m?.[1]) return undefined;
  const t = m[1].trim();
  return t || undefined;
}
