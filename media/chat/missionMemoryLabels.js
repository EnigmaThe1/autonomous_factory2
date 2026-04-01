import { describeOperatorFreeText, formatOperatorFreeTextHtml } from "./missionOperatorLabelsCore.js";

/**
 * Presentation for stored memory / tool-result text: friendly primary + full raw detail when mapped.
 * @param {string | null | undefined} text
 * @returns {{ primary: string, detail?: string }}
 */
export function describeMissionMemoryText(text) {
  return describeOperatorFreeText(text);
}

/**
 * @param {string | null | undefined} text
 * @param {(s: string) => string} escapeHtml
 */
export function formatMissionMemoryTextHtml(text, escapeHtml) {
  return formatOperatorFreeTextHtml("memory", text, escapeHtml);
}
