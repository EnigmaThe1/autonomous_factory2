import { trimText } from "../util";

export interface HttpRequestOptions {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Override default trimmed body size (default 8192 chars). */
  maxResponseBodyChars?: number;
}

export interface HttpRequestResult {
  ok: boolean;
  summary: string;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BODY_CHARS = 8192;

export async function httpRequest(opts: HttpRequestOptions): Promise<HttpRequestResult> {
  const method = (opts.method || "GET").toUpperCase();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const fetchOpts: RequestInit = {
      method,
      headers: opts.headers,
      signal: ac.signal,
    };
    if (opts.body && method !== "GET" && method !== "HEAD") {
      fetchOpts.body = opts.body;
    }

    const response = await fetch(opts.url, fetchOpts);
    clearTimeout(timer);

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((v, k) => { responseHeaders[k] = v; });

    let bodyText = "";
    try {
      bodyText = await response.text();
    } catch {
      bodyText = "(could not read response body)";
    }

    return {
      ok: response.ok,
      summary: `${method} ${opts.url} → ${response.status} ${response.statusText}`,
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: trimText(bodyText, opts.maxResponseBodyChars ?? DEFAULT_MAX_BODY_CHARS),
    };
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.includes("abort") || msg.includes("timeout");
    return {
      ok: false,
      summary: isTimeout
        ? `${method} ${opts.url} → timed out after ${timeoutMs}ms`
        : `${method} ${opts.url} → error: ${msg}`,
    };
  }
}
