import { describeOperatorFreeText, formatOperatorFreeTextHtml } from "./missionOperatorLabelsCore.js";

/**
 * Presentation layer for mission/timeline event messages: friendly primary line + optional raw detail.
 * @param {string | null | undefined} message
 * @returns {{ primary: string, detail?: string }}
 */
export function describeMissionEventMessage(message) {
  return describeOperatorFreeText(message);
}

/**
 * @param {string | null | undefined} message
 * @param {(s: string) => string} escapeHtml
 */
export function formatMissionEventMessageHtml(message, escapeHtml) {
  return formatOperatorFreeTextHtml("event", message, escapeHtml);
}

/**
 * Mission inspector / console: when host provides a headline for this event id (operator-action only), show
 * compact label + raw durable message (same layout as Timeline operator-action rows).
 * @param {{ id?: string, source?: string, message?: string }} ev
 * @param {Record<string, string>|null|undefined} operatorActionHeadlinesByEventId
 * @param {(s: string) => string} escapeHtml
 */
export function formatMissionEventRowHtml(ev, operatorActionHeadlinesByEventId, escapeHtml) {
  const headline =
    operatorActionHeadlinesByEventId &&
    ev &&
    ev.source === "operator-action" &&
    typeof ev.id === "string" &&
    operatorActionHeadlinesByEventId[ev.id];
  if (headline) {
    const raw = ev.message != null ? String(ev.message) : "";
    return `<div class="timeline-operator-action"><div class="timeline-operator-action-headline">${escapeHtml(headline)}</div><div class="meta timeline-operator-action-raw">${escapeHtml(raw)}</div></div>`;
  }
  return formatMissionEventMessageHtml(ev?.message, escapeHtml);
}
