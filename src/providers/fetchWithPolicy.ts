export interface FetchPolicy {
  timeoutMs: number;
  retries: number;
  retryDelayMs: number;
  /** When aborted, in-flight fetch and retry loop stop. */
  abortSignal?: AbortSignal;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isFetchAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string };
  if (e.name === "AbortError") return true;
  if (typeof e.message === "string" && (e.message.includes("aborted") || e.message === "Request aborted.")) return true;
  return false;
}

export async function fetchWithPolicy(url: string, init: RequestInit, policy: FetchPolicy): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= policy.retries; attempt += 1) {
    if (policy.abortSignal?.aborted) {
      throw new Error("Request aborted.");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), policy.timeoutMs);
    const ext = policy.abortSignal;
    const onExtAbort = () => controller.abort();
    if (ext) {
      if (ext.aborted) {
        clearTimeout(timer);
        throw new Error("Request aborted.");
      }
      ext.addEventListener("abort", onExtAbort, { once: true });
    }
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (response.ok || attempt >= policy.retries) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (err) {
      lastError = err;
      if (policy.abortSignal?.aborted || isFetchAbortError(err)) break;
      if (attempt >= policy.retries) break;
    } finally {
      clearTimeout(timer);
      ext?.removeEventListener("abort", onExtAbort);
    }
    await sleep(policy.retryDelayMs * Math.max(1, attempt + 1));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
