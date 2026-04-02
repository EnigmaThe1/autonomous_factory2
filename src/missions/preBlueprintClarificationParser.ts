import { extractJsonObject } from "./blueprintParser";

export interface ParsePreBlueprintClarificationResult {
  questions: string[];
  errors: string[];
}

/**
 * Parse planner output for pre-blueprint Q&A: `{ "questions": string[] }`.
 */
export function parsePreBlueprintClarificationOutput(
  text: string,
  opts?: { maxQuestions?: number; maxQuestionChars?: number }
): ParsePreBlueprintClarificationResult {
  const errors: string[] = [];
  const maxQ = Math.min(12, Math.max(1, opts?.maxQuestions ?? 8));
  const maxChars = Math.min(2000, Math.max(40, opts?.maxQuestionChars ?? 400));

  const jsonStr = extractJsonObject(text);
  if (!jsonStr) {
    errors.push("No JSON object found in model output.");
    return { questions: [], errors };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(jsonStr) as unknown;
  } catch (e) {
    errors.push(`JSON parse error: ${e instanceof Error ? e.message : String(e)}`);
    return { questions: [], errors };
  }

  if (!raw || typeof raw !== "object") {
    errors.push("Root must be an object.");
    return { questions: [], errors };
  }

  const arr = (raw as Record<string, unknown>).questions;
  if (!Array.isArray(arr)) {
    errors.push("questions must be an array of strings.");
    return { questions: [], errors };
  }

  const questions: string[] = [];
  for (let i = 0; i < arr.length && questions.length < maxQ; i++) {
    const s = typeof arr[i] === "string" ? arr[i]!.trim() : "";
    if (!s) continue;
    questions.push(s.slice(0, maxChars));
  }

  if (!questions.length) {
    errors.push("At least one non-empty question is required.");
  }

  return { questions, errors };
}
