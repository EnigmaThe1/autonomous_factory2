import type { Mission, WorkItem, MissionEvent } from "../types";
import { computeMissionProgressStats } from "../ui/missionProgressStats";

export interface MissionReport {
  missionId: string;
  title: string;
  status: string;
  duration: string;
  stats: {
    totalWorkItems: number;
    done: number;
    failed: number;
    blocked: number;
    skipped: number;
    retried: number;
    roundsCompleted: number;
    completionPercent: number;
  };
  filesModified: string[];
  workItemSummary: Array<{
    title: string;
    role: string;
    status: string;
    retryCount: number;
    output: string;
  }>;
  errorPatterns: Array<{
    pattern: string;
    count: number;
    firstSeen: string;
  }>;
  timeline: Array<{
    ts: string;
    source: string;
    message: string;
  }>;
  markdown: string;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remainSecs}s`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}

function formatTs(ts: number): string {
  return new Date(ts).toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
}

function extractErrorPatterns(events: MissionEvent[]): MissionReport["errorPatterns"] {
  const errors = events.filter((e) => e.level === "error" || e.level === "warn");
  const patterns = new Map<string, { count: number; firstTs: number }>();

  for (const e of errors) {
    const normalized = e.message
      .replace(/\b[0-9a-f]{8,}\b/g, "<hash>")
      .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/g, "<timestamp>")
      .replace(/\/[^\s]+/g, "<path>")
      .slice(0, 120);

    const existing = patterns.get(normalized);
    if (existing) {
      existing.count++;
    } else {
      patterns.set(normalized, { count: 1, firstTs: e.ts });
    }
  }

  return [...patterns.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 15)
    .map(([pattern, info]) => ({
      pattern,
      count: info.count,
      firstSeen: formatTs(info.firstTs),
    }));
}

function buildWorkItemSummary(queue: WorkItem[]): MissionReport["workItemSummary"] {
  return queue.map((w) => ({
    title: w.title,
    role: w.role,
    status: w.status,
    retryCount: w.retryCount || 0,
    output: (w.output || "").slice(0, 300),
  }));
}

function buildTimeline(events: MissionEvent[]): MissionReport["timeline"] {
  const milestones = events.filter(
    (e) =>
      e.level === "error" ||
      e.source === "orchestrator" ||
      e.message.includes("COMPLETE") ||
      e.message.includes("BLOCKER") ||
      e.message.includes("Auto-retry") ||
      e.message.includes("Recovered") ||
      e.message.includes("Resume context")
  );
  return milestones.slice(-30).map((e) => ({
    ts: formatTs(e.ts),
    source: e.source,
    message: e.message.slice(0, 200),
  }));
}

export function generateMissionReport(mission: Mission): MissionReport {
  const progress = computeMissionProgressStats(mission);
  const elapsedMs = mission.updatedAt - mission.createdAt;
  const retried = mission.queue.filter((w) => (w.retryCount || 0) > 0).length;

  const stats = {
    totalWorkItems: progress.total,
    done: progress.done,
    failed: progress.failed,
    blocked: progress.blocked,
    skipped: progress.skipped,
    retried,
    roundsCompleted: progress.roundsCompleted,
    completionPercent: progress.completionPercent,
  };

  const filesModified = mission.filesModified || [];
  const workItemSummary = buildWorkItemSummary(mission.queue);
  const errorPatterns = extractErrorPatterns(mission.events);
  const timeline = buildTimeline(mission.events);

  const md = renderMarkdown(mission, stats, filesModified, workItemSummary, errorPatterns, timeline, elapsedMs);

  return {
    missionId: mission.id,
    title: mission.title,
    status: mission.status,
    duration: formatDuration(elapsedMs),
    stats,
    filesModified,
    workItemSummary,
    errorPatterns,
    timeline,
    markdown: md,
  };
}

function renderMarkdown(
  mission: Mission,
  stats: MissionReport["stats"],
  files: string[],
  items: MissionReport["workItemSummary"],
  errors: MissionReport["errorPatterns"],
  timeline: MissionReport["timeline"],
  elapsedMs: number
): string {
  const lines: string[] = [];
  lines.push(`# Mission Report: ${mission.title}`);
  lines.push("");
  lines.push(`**Status:** ${mission.status} | **Duration:** ${formatDuration(elapsedMs)} | **Rounds:** ${stats.roundsCompleted}`);
  lines.push(`**Completion:** ${stats.completionPercent}% (${stats.done} done, ${stats.failed} failed, ${stats.blocked} blocked, ${stats.skipped} skipped of ${stats.totalWorkItems} total)`);
  if (stats.retried > 0) lines.push(`**Retried:** ${stats.retried} work item(s)`);
  if (mission.dryRun) lines.push("**Mode:** Dry run (no mutations executed)");
  lines.push("");

  if (files.length > 0) {
    lines.push("## Files Modified");
    lines.push("");
    for (const f of files) lines.push(`- \`${f}\``);
    lines.push("");
  }

  lines.push("## Work Items");
  lines.push("");
  lines.push("| # | Role | Title | Status | Retries |");
  lines.push("|---|------|-------|--------|---------|");
  items.forEach((w, i) => {
    const statusIcon = w.status === "done" ? "done" : w.status === "failed" ? "FAILED" : w.status;
    lines.push(`| ${i + 1} | ${w.role} | ${w.title.slice(0, 50)} | ${statusIcon} | ${w.retryCount} |`);
  });
  lines.push("");

  if (errors.length > 0) {
    lines.push("## Error Patterns");
    lines.push("");
    for (const e of errors) {
      lines.push(`- **${e.count}x** \`${e.pattern}\` (first: ${e.firstSeen})`);
    }
    lines.push("");
  }

  if (timeline.length > 0) {
    lines.push("## Key Events");
    lines.push("");
    for (const t of timeline) {
      lines.push(`- \`${t.ts}\` [${t.source}] ${t.message}`);
    }
    lines.push("");
  }

  if (mission.result) {
    lines.push("## Result");
    lines.push("");
    lines.push(mission.result.slice(0, 2000));
    lines.push("");
  }

  return lines.join("\n");
}
