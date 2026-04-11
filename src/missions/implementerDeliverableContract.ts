import type { Mission, WorkItem } from "../types";
import { isCompiledMissionInputPath, isCompiledMissionOutputPath } from "./missionCompiler";
import { normalizeWorkspaceRelPath } from "./missionReviewReadScope";

const FILE_PATH_LIKE =
  /<MISSION_ROOT>\/[\w./-]+\.(?:md|txt|json|ts|tsx|py|yaml|yml|toml)|(?:^|[\s`'"(])((?:\.?\/)?[\w./-]+\.(?:md|txt|json|ts|tsx|py|yaml|yml|toml))(?:\b|$)/gi;
const GENERIC_PATH_LIKE = /(?:^|[\s`'"(])((?:\.?\/)?[\w.-]+(?:\/[\w.-]+){1,})(?=[\s`'"),]|$)/g;
const PHASE_REF_RE = /\bphase\s*([0-9]+)\b/gi;
const ROOT_PLACEHOLDER = "<MISSION_ROOT>/";

function cleanPathToken(raw: string): string | undefined {
  const trimmed = String(raw || "")
    .trim()
    .replace(/^[("'`]+/, "")
    .replace(/[),.:;`"']+$/, "")
    .replace(/\\/g, "/");
  if (!trimmed || trimmed.includes("..") || !trimmed.includes("/")) return undefined;
  return trimmed.replace(/^\.\/+/, "");
}

function collectMatches(text: string | undefined, regex: RegExp, target: Set<string>, max = 80): void {
  if (!text?.trim()) return;
  regex.lastIndex = 0;
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null && count < max) {
    const token = cleanPathToken(match[1] || match[0]);
    if (token) target.add(token);
    count += 1;
  }
}

function extractFileLikePaths(text: string | undefined): string[] {
  const out = new Set<string>();
  collectMatches(text, FILE_PATH_LIKE, out);
  return [...out];
}

function extractConcretePathTokens(text: string | undefined): string[] {
  const out = new Set<string>();
  collectMatches(text, GENERIC_PATH_LIKE, out);
  return [...out].filter((p) => !p.startsWith(ROOT_PLACEHOLDER));
}

function extractPhaseRefs(text: string | undefined): number[] {
  if (!text?.trim()) return [];
  const phases = new Set<number>();
  PHASE_REF_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PHASE_REF_RE.exec(text)) !== null) {
    const n = Number(match[1]);
    if (Number.isFinite(n)) phases.add(n);
  }
  return [...phases].sort((a, b) => a - b);
}

function extractMissionPromptPhaseSections(prompt: string | undefined): Map<number, string[]> {
  const sections = new Map<number, string[]>();
  if (!prompt?.trim()) return sections;
  let currentPhase: number | undefined;
  for (const line of prompt.split(/\r?\n/)) {
    const phaseMatch = /^\s*Phase\s+([0-9]+)\b/i.exec(line);
    if (phaseMatch) {
      currentPhase = Number(phaseMatch[1]);
      if (!sections.has(currentPhase)) sections.set(currentPhase, []);
    }
    if (currentPhase !== undefined) {
      sections.get(currentPhase)!.push(line);
    }
  }
  return sections;
}

function extractRelevantMissionPhaseDeliverables(prompt: string | undefined, phases: readonly number[]): string[] {
  if (!prompt?.trim() || phases.length === 0) return [];
  const sections = extractMissionPromptPhaseSections(prompt);
  const out = new Set<string>();
  for (const phase of phases) {
    const lines = sections.get(phase);
    if (!lines?.length) continue;
    for (const path of extractFileLikePaths(lines.join("\n"))) out.add(path);
  }
  return [...out];
}

export function inferArtifactRootFromTextBlobs(blobs: readonly string[]): string | undefined {
  const paths = new Set<string>();
  for (const blob of blobs) {
    for (const path of extractConcretePathTokens(blob)) {
      const normalized = normalizeWorkspaceRelPath(path);
      if (normalized) paths.add(normalized);
    }
  }
  if (paths.size < 2) return undefined;

  const prefixCounts = new Map<string, number>();
  for (const path of paths) {
    const parts = path.split("/").filter(Boolean);
    for (let i = 2; i < parts.length; i += 1) {
      const prefix = parts.slice(0, i).join("/");
      prefixCounts.set(prefix, (prefixCounts.get(prefix) || 0) + 1);
    }
  }

  const ranked = [...prefixCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => {
      const countDelta = b[1] - a[1];
      if (countDelta !== 0) return countDelta;
      return b[0].split("/").length - a[0].split("/").length;
    });

  return ranked[0]?.[0];
}

function resolveMissionRootPlaceholder(path: string, rootHint: string | undefined): string | undefined {
  if (!path.startsWith(ROOT_PLACEHOLDER)) return path;
  if (!rootHint) return undefined;
  return `${rootHint}/${path.slice(ROOT_PLACEHOLDER.length)}`;
}

export function resolveExpectedDeliverableRelPathsForImplementer(args: {
  mission: Mission;
  item: WorkItem;
  summary?: string;
}): string[] {
  const { mission, item, summary } = args;
  if (item.role !== "implementer") return item.expectedDeliverableRelPaths || [];

  const stepTexts = [item.prompt, item.scopeSummary, item.validationHint, summary].filter(
    (v): v is string => Boolean(v?.trim())
  );
  const phaseRefs = extractPhaseRefs(stepTexts.join("\n"));
  const rootHint =
    mission.runtime?.resolvedArtifactRootRelative ||
    inferArtifactRootFromTextBlobs(stepTexts);

  const raw = new Set<string>();
  for (const path of item.expectedDeliverableRelPaths || []) raw.add(path);
  for (const text of stepTexts) {
    for (const path of extractFileLikePaths(text)) raw.add(path);
  }
  for (const path of extractRelevantMissionPhaseDeliverables(mission.prompt, phaseRefs)) raw.add(path);

  const resolved: string[] = [];
  for (const candidate of raw) {
    const withRoot = resolveMissionRootPlaceholder(candidate, rootHint);
    if (!withRoot) continue;
    const normalized = normalizeWorkspaceRelPath(withRoot);
    if (normalized) resolved.push(normalized);
  }

  return [...new Set(resolved)]
    .filter((relPath) => {
      if (isCompiledMissionInputPath(mission, relPath) && !isCompiledMissionOutputPath(mission, relPath)) {
        return false;
      }
      return true;
    })
    .slice(0, 48);
}
