import type { MissionEvent } from "../types";
import { uid } from "../util";

/**
 * Compacts a mission's event log by summarizing older events into
 * digest entries, keeping recent events verbatim. This reduces
 * memory and context window consumption for long-running missions.
 */

export interface CompactionResult {
  events: MissionEvent[];
  compactedCount: number;
}

interface EventGroup {
  source: string;
  level: MissionEvent["level"];
  count: number;
  firstTs: number;
  lastTs: number;
  messages: string[];
}

/**
 * Compacts events older than the retention window into grouped summaries.
 * Recent events (within `retainRecentCount`) are kept verbatim.
 * Error-level events are always preserved individually.
 */
export function compactEvents(
  events: MissionEvent[],
  retainRecentCount: number = 100,
  groupWindowMs: number = 60_000
): CompactionResult {
  if (events.length <= retainRecentCount) {
    return { events, compactedCount: 0 };
  }

  const cutoff = events.length - retainRecentCount;
  const oldEvents = events.slice(0, cutoff);
  const recentEvents = events.slice(cutoff);

  const preserved: MissionEvent[] = [];
  const groupable: MissionEvent[] = [];

  for (const e of oldEvents) {
    if (e.level === "error") {
      preserved.push(e);
    } else {
      groupable.push(e);
    }
  }

  const groups = groupEvents(groupable, groupWindowMs);
  const digests = groups.map(renderGroupDigest);

  const compacted = [...preserved, ...digests, ...recentEvents];
  compacted.sort((a, b) => a.ts - b.ts);

  return {
    events: compacted,
    compactedCount: groupable.length - digests.length,
  };
}

function groupEvents(events: MissionEvent[], windowMs: number): EventGroup[] {
  if (!events.length) return [];

  const groups: EventGroup[] = [];
  let current: EventGroup = {
    source: events[0].source,
    level: events[0].level,
    count: 1,
    firstTs: events[0].ts,
    lastTs: events[0].ts,
    messages: [events[0].message],
  };

  for (let i = 1; i < events.length; i++) {
    const e = events[i];
    const sameSource = e.source === current.source;
    const sameLevel = e.level === current.level;
    const withinWindow = e.ts - current.lastTs < windowMs;

    if (sameSource && sameLevel && withinWindow) {
      current.count++;
      current.lastTs = e.ts;
      if (current.messages.length < 5) {
        current.messages.push(e.message);
      }
    } else {
      groups.push(current);
      current = {
        source: e.source,
        level: e.level,
        count: 1,
        firstTs: e.ts,
        lastTs: e.ts,
        messages: [e.message],
      };
    }
  }
  groups.push(current);
  return groups;
}

function renderGroupDigest(group: EventGroup): MissionEvent {
  const uniqueMessages = [...new Set(group.messages)];
  const preview = uniqueMessages.slice(0, 3).join("; ");
  const summary = group.count === 1
    ? preview
    : `[${group.count} events] ${preview}${uniqueMessages.length > 3 ? ` (+${uniqueMessages.length - 3} more)` : ""}`;

  return {
    id: uid("compact"),
    ts: group.firstTs,
    level: group.level,
    source: group.source,
    message: summary.slice(0, 500),
  };
}
