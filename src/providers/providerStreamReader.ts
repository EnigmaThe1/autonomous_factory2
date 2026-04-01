/**
 * Shared async generator that reads a streaming response body line-by-line,
 * delegates parsing to a provider-specific parse function, and yields text chunks.
 *
 * Handles abort signal, text decoding, and newline buffering identically
 * across all HTTP-based providers.
 */
export async function* readStreamChunks(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
  parseLines: (lines: string[]) => { chunks: string[]; done?: boolean }
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Request aborted.");
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      const parsed = parseLines(lines);
      for (const chunk of parsed.chunks) yield chunk;
      if (parsed.done) return;
    }
  } finally {
    reader.releaseLock();
  }
}
