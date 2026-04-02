import { httpRequest } from "./HttpClient";
import { trimText } from "../util";

export type WebSearchProviderId = "duckduckgo" | "brave";

export interface RunWebSearchOptions {
  provider: WebSearchProviderId;
  /** Required when provider is `brave`. */
  braveApiKey?: string;
}

/** Strip common HTML to plain text for agent consumption (best-effort, not a full parser). */
export function htmlToPlainTextForAgent(html: string): string {
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

export function summarizeDuckDuckGoInstantAnswer(data: unknown): { text: string; attribution?: string } {
  if (!data || typeof data !== "object") {
    return { text: "" };
  }
  const o = data as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof o.Heading === "string" && o.Heading.trim()) {
    parts.push(o.Heading.trim());
  }
  if (typeof o.AbstractText === "string" && o.AbstractText.trim()) {
    parts.push(o.AbstractText.trim());
  }
  if (typeof o.Answer === "string" && o.Answer.trim()) {
    parts.push(o.Answer.trim());
  }
  const related = o.RelatedTopics;
  if (Array.isArray(related)) {
    const titles = related
      .slice(0, 8)
      .map((t) => {
        if (t && typeof t === "object" && typeof (t as { Text?: string }).Text === "string") {
          return String((t as { Text: string }).Text).replace(/<[^>]+>/g, "").trim();
        }
        return "";
      })
      .filter(Boolean);
    if (titles.length) {
      parts.push(`Related: ${titles.join(" | ")}`);
    }
  }
  const attribution =
    typeof o.AbstractURL === "string" && o.AbstractURL.trim() ? String(o.AbstractURL).trim() : undefined;
  return { text: parts.join("\n\n"), attribution };
}

/** Summarize Brave Search `web` JSON (best-effort). */
export function summarizeBraveWebResults(data: unknown): { text: string; topUrls: string[] } {
  const topUrls: string[] = [];
  if (!data || typeof data !== "object") {
    return { text: "", topUrls };
  }
  const web = (data as Record<string, unknown>).web;
  if (!web || typeof web !== "object") {
    return { text: "", topUrls };
  }
  const results = (web as Record<string, unknown>).results;
  if (!Array.isArray(results)) {
    return { text: "", topUrls };
  }
  const lines: string[] = [];
  for (const item of results.slice(0, 10)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const title = typeof o.title === "string" ? o.title.trim() : "";
    const desc = typeof o.description === "string" ? o.description.trim() : "";
    const url = typeof o.url === "string" ? o.url.trim() : "";
    if (url) topUrls.push(url);
    const head = title || url || "(result)";
    const body = [head, desc].filter(Boolean).join(" — ");
    if (body) lines.push(body);
  }
  return { text: lines.join("\n\n"), topUrls };
}

async function runWebSearchDuckDuckGo(query: string): Promise<{ ok: boolean; summary: string; data?: unknown }> {
  const q = query.trim();
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
  const res = await httpRequest({ method: "GET", url, maxResponseBodyChars: 120_000, timeoutMs: 20_000 });
  if (!res.body) {
    return { ok: false, summary: res.summary };
  }
  try {
    const json = JSON.parse(res.body) as unknown;
    const { text, attribution } = summarizeDuckDuckGoInstantAnswer(json);
    if (!text) {
      return {
        ok: true,
        summary: "No instant answer from search provider (try fetchWebPage on a known docs URL or rephrase).",
        data: { query: q, provider: "duckduckgo_instant" }
      };
    }
    return {
      ok: true,
      summary: trimText(text, 800),
      data: {
        query: q,
        provider: "duckduckgo_instant",
        excerpt: trimText(text, 12_000),
        attribution
      }
    };
  } catch {
    return { ok: false, summary: "Could not parse search response." };
  }
}

async function runWebSearchBrave(query: string, apiKey: string): Promise<{ ok: boolean; summary: string; data?: unknown }> {
  const q = query.trim();
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=8`;
  const res = await httpRequest({
    method: "GET",
    url,
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey
    },
    maxResponseBodyChars: 120_000,
    timeoutMs: 20_000
  });
  if (!res.ok) {
    return {
      ok: false,
      summary: res.status === 401 || res.status === 403
        ? "Brave Search API rejected the request (check API key)."
        : trimText(res.summary, 500)
    };
  }
  if (!res.body) {
    return { ok: false, summary: res.summary };
  }
  try {
    const json = JSON.parse(res.body) as unknown;
    const { text, topUrls } = summarizeBraveWebResults(json);
    if (!text) {
      return {
        ok: true,
        summary: "No web results from Brave (try rephrasing or fetchWebPage on a known URL).",
        data: { query: q, provider: "brave_web", results: [] }
      };
    }
    return {
      ok: true,
      summary: trimText(text, 800),
      data: {
        query: q,
        provider: "brave_web",
        excerpt: trimText(text, 12_000),
        topUrls: topUrls.slice(0, 8)
      }
    };
  } catch {
    return { ok: false, summary: "Could not parse Brave search response." };
  }
}

export async function runWebSearch(
  query: string,
  opts: RunWebSearchOptions = { provider: "duckduckgo" }
): Promise<{ ok: boolean; summary: string; data?: unknown }> {
  if (opts.provider === "brave") {
    const key = opts.braveApiKey?.trim();
    if (!key) {
      return {
        ok: false,
        summary:
          "Brave search requires an API key in Secret Storage (key: myAi.webSearch.braveApiKey). See AGENT_CAPABILITIES_PLAN.md."
      };
    }
    return runWebSearchBrave(query, key);
  }
  return runWebSearchDuckDuckGo(query);
}

export async function runFetchWebPage(url: string): Promise<{ ok: boolean; summary: string; data?: unknown }> {
  const res = await httpRequest({ method: "GET", url, maxResponseBodyChars: 400_000, timeoutMs: 25_000 });
  const ct = (res.headers && (res.headers["content-type"] || res.headers["Content-Type"])) || "";
  let body = res.body || "";
  if (/html/i.test(String(ct))) {
    body = htmlToPlainTextForAgent(body);
  }
  body = trimText(body, 200_000);
  return {
    ok: res.ok,
    summary: res.summary,
    data: {
      url,
      status: res.status,
      contentType: ct,
      body
    }
  };
}
