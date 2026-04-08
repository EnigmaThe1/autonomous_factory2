import { trimText } from "../util";

export type EvidenceFreshnessClass = "volatile" | "short" | "medium" | "long" | "persistent";

export function inferFreshnessForUrl(url: string): EvidenceFreshnessClass {
  const u = (url || "").toLowerCase();
  if (!u) return "short";
  if (u.includes("localhost") || u.includes("127.0.0.1")) return "volatile";
  if (u.includes("/releases") || u.includes("/changelog") || u.includes("/release-notes")) return "short";
  if (u.includes("/blog") || u.includes("/news") || u.includes("/posts")) return "short";
  if (u.includes("/docs") || u.includes("readthedocs") || u.includes("developer.") || u.includes("docs.")) return "long";
  if (u.includes("github.com") || u.includes("gitlab.com")) return "medium";
  return "medium";
}

export function formatResearchEvidenceFinding(input: {
  tool: "webSearch" | "fetchWebPage";
  ts: number;
  query?: string;
  url?: string;
  provider?: string;
  excerpt?: string;
  topUrls?: string[];
  status?: number;
  contentType?: string;
}): { text: string; freshness: EvidenceFreshnessClass } {
  const freshness = input.url ? inferFreshnessForUrl(input.url) : "volatile";
  const header =
    input.tool === "webSearch"
      ? `Research evidence (webSearch)\nQuery: ${trimText(String(input.query || ""), 300)}`
      : `Research evidence (fetchWebPage)\nURL: ${trimText(String(input.url || ""), 600)}`;
  const meta: string[] = [];
  if (input.provider) meta.push(`Provider: ${input.provider}`);
  if (typeof input.status === "number") meta.push(`HTTP: ${input.status}`);
  if (input.contentType) meta.push(`Content-Type: ${trimText(input.contentType, 120)}`);
  meta.push(`Freshness: ${freshness}`);
  meta.push(`Captured: ${new Date(input.ts).toISOString()}`);

  const excerpt = trimText(String(input.excerpt || ""), 1600);
  const urls = (input.topUrls || []).slice(0, 8).filter(Boolean);
  const urlsBlock = urls.length ? `Top URLs:\n- ${urls.join("\n- ")}` : "";
  const body = excerpt ? `Excerpt:\n${excerpt}` : "";

  return {
    freshness,
    text: [header, meta.join(" | "), "", urlsBlock, urlsBlock && body ? "" : "", body]
      .filter((x) => String(x || "").trim().length > 0)
      .join("\n")
      .trim()
  };
}

