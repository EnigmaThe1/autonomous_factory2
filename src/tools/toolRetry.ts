import type { ToolResult } from "./ToolRegistry";

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableErrors: RegExp[];
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 5000,
  retryableErrors: [
    /ECONNRESET/i,
    /ECONNREFUSED/i,
    /ETIMEDOUT/i,
    /socket hang up/i,
    /EPIPE/i,
    /ENOTFOUND/i,
    /timed out/i,
    /network/i,
  ],
};

function isRetryable(error: unknown, patterns: RegExp[]): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return patterns.some((p) => p.test(msg));
}

function isRetryableResult(result: ToolResult, patterns: RegExp[]): boolean {
  if (result.ok) return false;
  if (result.requiresApproval || result.blockedByPolicy) return false;
  return patterns.some((p) => p.test(result.summary));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number, base: number, max: number): number {
  const jitter = Math.random() * 0.3 + 0.85;
  return Math.min(base * Math.pow(2, attempt) * jitter, max);
}

/**
 * Wraps an async tool call with exponential-backoff retry for transient failures.
 * Only retries on network-like errors; policy blocks and approval requests pass through immediately.
 */
export async function withRetry(
  fn: () => Promise<ToolResult>,
  opts?: Partial<RetryOptions>
): Promise<ToolResult & { _retryAttempts?: number }> {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  let lastResult: ToolResult | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt < o.maxAttempts; attempt++) {
    try {
      const result = await fn();
      if (!isRetryableResult(result, o.retryableErrors) || attempt === o.maxAttempts - 1) {
        return attempt > 0 ? { ...result, _retryAttempts: attempt + 1 } : result;
      }
      lastResult = result;
    } catch (err) {
      if (!isRetryable(err, o.retryableErrors) || attempt === o.maxAttempts - 1) {
        throw err;
      }
      lastError = err;
    }

    if (attempt < o.maxAttempts - 1) {
      await delay(backoffMs(attempt, o.baseDelayMs, o.maxDelayMs));
    }
  }

  if (lastResult) return { ...lastResult, _retryAttempts: o.maxAttempts };
  throw lastError;
}
