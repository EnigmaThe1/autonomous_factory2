/**
 * Current / next step hints from queue snapshot only (mirrors orchestrator pick order + dependency edges).
 * dependencyEdgeSatisfied matches host: done | skipped.
 */

/** @param {string|undefined} status */
function dependencyEdgeSatisfied(status) {
  return status === "done" || status === "skipped";
}

/**
 * @param {ReadonlyArray<{ id?: string, status?: string }>} queue
 * @param {{ dependsOn?: string[] }} item
 */
function dependenciesMet(queue, item) {
  const deps = item.dependsOn;
  if (!deps || !deps.length) return true;
  return deps.every((depId) => {
    const dep = queue.find((w) => w.id === depId);
    return dependencyEdgeSatisfied(dep?.status);
  });
}

/**
 * @param {ReadonlyArray<{ id?: string, status?: string, dependsOn?: string[] }>|null|undefined} queue
 */
export function findFirstEligibleTodo(queue) {
  const q = Array.isArray(queue) ? queue : [];
  return q.find((w) => w.status === "todo" && dependenciesMet(q, w)) ?? null;
}

/**
 * @param {ReadonlyArray<{ status?: string }>|null|undefined} queue
 */
export function hasUnresolvedQueueWork(queue) {
  const q = Array.isArray(queue) ? queue : [];
  return q.some((w) => w.status === "todo" || w.status === "running" || w.status === "blocked" || w.status === "failed");
}

/**
 * @param {{ role?: string, title?: string }} w
 */
function workOneLiner(w) {
  const role = w.role != null ? String(w.role) : "work item";
  const title = w.title != null && String(w.title).trim() ? String(w.title).trim() : "(no title)";
  return { role, title, text: `${role} — ${title}` };
}

/**
 * @returns {{ current?: object, next?: object, pausedOn?: object, dependencyBlocked?: object } | null}
 */
export function describeMissionCurrentNext(queue) {
  const q = Array.isArray(queue) ? queue : [];
  if (!hasUnresolvedQueueWork(q)) return null;

  const running = q.find((w) => w.status === "running") ?? null;
  const firstIssue = q.find((w) => w.status === "blocked" || w.status === "failed") ?? null;
  const nextEligible = findFirstEligibleTodo(q);
  const firstTodoAny = q.find((w) => w.status === "todo") ?? null;

  /** When a blocked/failed row exists and nothing is running, do not imply a definite "next" runnable step. */
  const ambiguousForNext = Boolean(firstIssue && !running);

  const out = {};

  if (running) {
    out.current = workOneLiner(running);
  }

  if (firstIssue) {
    out.pausedOn = workOneLiner(firstIssue);
  }

  if (!ambiguousForNext && nextEligible) {
    out.next = workOneLiner(nextEligible);
  } else if (!ambiguousForNext && !nextEligible && firstTodoAny && !running && !firstIssue) {
    out.dependencyBlocked = workOneLiner(firstTodoAny);
  }

  return out;
}

/**
 * @param {ReadonlyArray<{ id?: string, status?: string, dependsOn?: string[] }>|null|undefined} queue
 */
export function currentNextSignatureTuple(queue) {
  const q = Array.isArray(queue) ? queue : [];
  if (!hasUnresolvedQueueWork(q)) return null;
  const rid = q.find((w) => w.status === "running")?.id ?? null;
  const iid = q.find((w) => w.status === "blocked" || w.status === "failed")?.id ?? null;
  const ne = findFirstEligibleTodo(q)?.id ?? null;
  const ft = q.find((w) => w.status === "todo")?.id ?? null;
  return [rid, iid, ne, ft];
}

/**
 * @param {ReturnType<typeof describeMissionCurrentNext>} desc
 * @param {(s: string) => string} escapeHtml
 */
export function formatMissionCardCurrentNextHtml(desc, escapeHtml) {
  if (!desc) return "";
  const parts = [];
  if (desc.current) parts.push(`<div>Current: ${escapeHtml(desc.current.text)}</div>`);
  if (desc.pausedOn) parts.push(`<div>Paused on: ${escapeHtml(desc.pausedOn.text)}</div>`);
  if (desc.next) parts.push(`<div>Next: ${escapeHtml(desc.next.text)}</div>`);
  if (desc.dependencyBlocked) {
    parts.push(`<div>Waiting on dependency: ${escapeHtml(desc.dependencyBlocked.text)}</div>`);
  }
  if (!parts.length) return "";
  return `<div class="meta mission-current-next">${parts.join("")}</div>`;
}

/**
 * @param {ReturnType<typeof describeMissionCurrentNext>} desc
 * @param {(s: string) => string} escapeHtml
 */
export function formatInspectorCurrentNextHtml(desc, escapeHtml) {
  if (!desc) return "";
  const rows = [];
  if (desc.current) {
    rows.push(`Current step: ${escapeHtml(desc.current.role)} • ${escapeHtml(desc.current.title)}`);
  } else {
    rows.push("No active step running");
  }
  if (desc.pausedOn) {
    rows.push(`Paused on: ${escapeHtml(desc.pausedOn.role)} • ${escapeHtml(desc.pausedOn.title)}`);
  }
  if (desc.next) {
    rows.push(`Next step: ${escapeHtml(desc.next.role)} • ${escapeHtml(desc.next.title)}`);
  }
  if (desc.dependencyBlocked) {
    rows.push(
      `Waiting on dependency: ${escapeHtml(desc.dependencyBlocked.role)} • ${escapeHtml(desc.dependencyBlocked.title)}`
    );
  }
  const inner = rows.map((r) => `<div class="meta">${r}</div>`).join("");
  return `<div class="inspector-section"><div class="section-title small">Current / next</div><div class="meta-block">${inner}</div></div>`;
}
