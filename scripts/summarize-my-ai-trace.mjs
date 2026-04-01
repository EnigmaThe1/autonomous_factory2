#!/usr/bin/env node
/**
 * Summarize My AI Trace JSONL (exported via "My AI: Export Trace Log" or
 * my-ai-trace-append.jsonl when myAi.trace.persistToFile is on).
 *
 * Usage:
 *   node scripts/summarize-my-ai-trace.mjs /path/to/my-ai-trace-....jsonl
 *   cat trace.jsonl | node scripts/summarize-my-ai-trace.mjs -
 */

import * as fs from "fs";
import * as readline from "readline";

const argv = process.argv.slice(2);
const pathArg = argv[0];

if (!pathArg || pathArg === "-h" || pathArg === "--help") {
  console.error(
    "Usage: node scripts/summarize-my-ai-trace.mjs <file.jsonl | ->\n" +
      "  Reads JSON lines (TraceRecord) and prints counts + notable events."
  );
  process.exit(pathArg ? 0 : 1);
}

/** @type {NodeJS.ReadableStream} */
let input;
if (pathArg === "-") {
  input = process.stdin;
} else {
  input = fs.createReadStream(pathArg, { encoding: "utf8" });
}

const byEvent = new Map();
const bySide = new Map();
const byLevel = new Map();
const problems = [];
let lines = 0;
let parseErrors = 0;

const WATCH = new Set([
  "render_snapshot_ignored_stale",
  "trace_session_changed_reset_stale_guard",
  "render_snapshot_apply",
  "refresh_dashboard_posting",
  "webview_post_message_error",
  "ui_receive_message",
  "checkbox_change",
  "set_include_archived",
]);

function bump(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

const rl = readline.createInterface({ input, crlfDelay: Infinity });
for await (const line of rl) {
  const t = line.trim();
  if (!t) continue;
  lines++;
  let rec;
  try {
    rec = JSON.parse(t);
  } catch {
    parseErrors++;
    continue;
  }
  const ev = rec.event ?? "(no event)";
  bump(byEvent, ev);
  bump(bySide, rec.side ?? "(no side)");
  bump(byLevel, rec.level ?? "(no level)");
  if (rec.level === "error" || rec.ok === false) {
    problems.push({ ts: rec.ts, seq: rec.seq, event: ev, side: rec.side, data: rec.data });
  }
}

console.log(`Lines read: ${lines}  parse errors: ${parseErrors}`);
console.log("\nBy level:");
for (const [k, v] of [...byLevel.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${v}`);
}
console.log("\nBy side:");
for (const [k, v] of [...bySide.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${v}`);
}
console.log("\nWatched events:");
for (const w of WATCH) {
  const n = byEvent.get(w) || 0;
  if (n) console.log(`  ${w}: ${n}`);
}
console.log("\nTop events:");
for (const [k, v] of [...byEvent.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
  console.log(`  ${k}: ${v}`);
}
if (problems.length) {
  console.log(`\nProblems (${problems.length}):`);
  for (const p of problems.slice(0, 40)) {
    console.log(`  ${p.ts} seq=${p.seq} ${p.side ?? ""} ${p.event}`, p.data ? JSON.stringify(p.data).slice(0, 200) : "");
  }
  if (problems.length > 40) console.log(`  ... +${problems.length - 40} more`);
}
