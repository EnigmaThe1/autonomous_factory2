export function parseOpenAiSseLines(lines: string[]): { chunks: string[]; done: boolean; malformedCount: number } {
  const chunks: string[] = [];
  let done = false;
  let malformedCount = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    if (payload === "[DONE]") {
      done = true;
      continue;
    }
    try {
      const parsed = JSON.parse(payload);
      const delta = parsed?.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta.length) chunks.push(delta);
    } catch {
      malformedCount += 1;
    }
  }
  return { chunks, done, malformedCount };
}

export function parseOllamaNdjsonLines(lines: string[]): { chunks: string[]; malformedCount: number } {
  const chunks: string[] = [];
  let malformedCount = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed?.response === "string" && parsed.response.length) chunks.push(parsed.response);
    } catch {
      malformedCount += 1;
    }
  }
  return { chunks, malformedCount };
}

export function parseAnthropicSseLines(lines: string[]): { chunks: string[]; done: boolean; malformedCount: number } {
  const chunks: string[] = [];
  let done = false;
  let malformedCount = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      const parsed = JSON.parse(payload) as {
        type?: string;
        delta?: { type?: string; text?: string; stop_reason?: string };
      };
      if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta" && typeof parsed.delta.text === "string" && parsed.delta.text.length) {
        chunks.push(parsed.delta.text);
      }
      if (parsed.type === "message_delta" && parsed.delta?.stop_reason) done = true;
    } catch {
      malformedCount += 1;
    }
  }
  return { chunks, done, malformedCount };
}

export function parseGeminiSseLines(lines: string[]): { chunks: string[]; done: boolean; malformedCount: number } {
  const chunks: string[] = [];
  let done = false;
  let malformedCount = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") {
      done = true;
      continue;
    }
    try {
      const parsed = JSON.parse(payload) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const parts = parsed.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) {
        for (const p of parts) {
          if (typeof p?.text === "string" && p.text.length) chunks.push(p.text);
        }
      }
    } catch {
      malformedCount += 1;
    }
  }
  return { chunks, done, malformedCount };
}
