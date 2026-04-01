/**
 * Queue progress stats for Missions UI (presentation only; uses existing queue rows).
 * @param {ReadonlyArray<{ status?: string, completionKind?: string }>|null|undefined} queue
 */
export function computeQueueProgressStats(queue) {
  const q = Array.isArray(queue) ? queue : [];
  let todo = 0;
  let running = 0;
  let blocked = 0;
  let failed = 0;
  let skipped = 0;
  let donePlain = 0;
  let doneAlreadySatisfied = 0;
  let donePatchNoop = 0;

  for (const w of q) {
    const st = w.status;
    if (st === "todo") todo += 1;
    else if (st === "running") running += 1;
    else if (st === "blocked") blocked += 1;
    else if (st === "failed") failed += 1;
    else if (st === "skipped") skipped += 1;
    else if (st === "done") {
      if (w.completionKind === "already_satisfied") doneAlreadySatisfied += 1;
      else if (w.completionKind === "apply_patch_noop") donePatchNoop += 1;
      else donePlain += 1;
    }
  }

  const done = donePlain + doneAlreadySatisfied + donePatchNoop;
  const resolved = done + skipped;
  const pending = todo + running;
  const issueCount = blocked + failed;

  return {
    total: q.length,
    donePlain,
    doneAlreadySatisfied,
    donePatchNoop,
    skipped,
    todo,
    running,
    blocked,
    failed,
    done,
    resolved,
    pending,
    issueCount
  };
}

/**
 * Compact line(s) for mission list cards.
 * @param {ReturnType<typeof computeQueueProgressStats>} stats
 * @param {(s: string) => string} escapeHtml
 */
export function formatMissionCardQueueProgressHtml(stats, escapeHtml) {
  if (stats.total === 0) {
    return `<div class="meta mission-queue-progress">Progress: empty queue</div>`;
  }
  const pct = Math.round((stats.resolved / stats.total) * 100);
  const runPct = Math.round((stats.running / stats.total) * 100);
  const issuePct = Math.round((stats.issueCount / stats.total) * 100);
  const main = `${pct}% — ${stats.resolved}/${stats.total} resolved · ${stats.pending} pending`;
  let html = `<div class="mission-progress-bar-container" title="${escapeHtml(main)}"><div class="mission-progress-bar done" style="width:${pct}%"></div><div class="mission-progress-bar running" style="width:${runPct}%;left:${pct}%"></div>${issuePct ? `<div class="mission-progress-bar issue" style="width:${issuePct}%;left:${pct + runPct}%"></div>` : ''}</div>`;
  html += `<div class="meta mission-queue-progress">${escapeHtml(main)}</div>`;
  const includes = [];
  if (stats.doneAlreadySatisfied > 0) {
    includes.push(`${stats.doneAlreadySatisfied} already satisfied`);
  }
  if (stats.donePatchNoop > 0) {
    includes.push(`${stats.donePatchNoop} patch noop`);
  }
  if (includes.length) {
    html += `<div class="meta mission-queue-progress-includes">Includes: ${escapeHtml(includes.join(", "))}</div>`;
  }
  if (stats.issueCount > 0) {
    const iss = `${stats.blocked} blocked · ${stats.failed} failed`;
    html += `<div class="meta mission-queue-progress-issues">${escapeHtml(iss)}</div>`;
  }
  return html;
}

/**
 * Fuller block for mission inspector (before work queue list).
 * @param {ReturnType<typeof computeQueueProgressStats>} stats
 * @param {(s: string) => string} escapeHtml
 */
export function formatInspectorQueueProgressHtml(stats, escapeHtml) {
  if (stats.total === 0) {
    return `<div class="inspector-section"><div class="section-title small">Queue progress</div><div class="meta-block"><div class="meta">No work items in queue.</div></div></div>`;
  }
  const head = `Queue progress: ${stats.resolved} resolved / ${stats.total} total`;
  const resolvedParts = [];
  if (stats.donePlain > 0) resolvedParts.push(`${stats.donePlain} standard`);
  if (stats.doneAlreadySatisfied > 0) resolvedParts.push(`${stats.doneAlreadySatisfied} already satisfied`);
  if (stats.donePatchNoop > 0) resolvedParts.push(`${stats.donePatchNoop} patch noop`);
  if (stats.skipped > 0) resolvedParts.push(`${stats.skipped} skipped`);
  const resolvedLine =
    resolvedParts.length > 0
      ? `Resolved: ${resolvedParts.join(", ")}`
      : stats.resolved === 0
        ? "Resolved: none yet"
        : `Resolved: ${stats.resolved} (no breakdown)`;

  const openParts = [];
  if (stats.todo > 0) openParts.push(`${stats.todo} todo`);
  if (stats.running > 0) openParts.push(`${stats.running} running`);
  const openLine = openParts.length ? `Open: ${openParts.join(", ")}` : "Open: none";

  const issuesLine =
    stats.issueCount === 0 ? "Issues: none" : `Issues: ${stats.blocked} blocked, ${stats.failed} failed`;

  const lines = [head, resolvedLine, openLine, issuesLine].map((line) => `<div class="meta">${escapeHtml(line)}</div>`).join("");
  return `<div class="inspector-section"><div class="section-title small">Queue progress</div><div class="meta-block">${lines}</div></div>`;
}

/**
 * Fingerprint for snapshot signatures (list cards) when queue length is unchanged but statuses shift.
 * @param {ReadonlyArray<{ status?: string, completionKind?: string }>|null|undefined} queue
 */
export function queueProgressSignatureTuple(queue) {
  const s = computeQueueProgressStats(queue);
  return [s.total, s.resolved, s.pending, s.donePlain, s.doneAlreadySatisfied, s.donePatchNoop, s.skipped, s.blocked, s.failed];
}
