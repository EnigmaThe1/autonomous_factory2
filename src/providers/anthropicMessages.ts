import type { ChatRequest } from "../types";
import { renderChatContext } from "./providerContextRender";

export type AnthropicMessage = { role: "user" | "assistant"; content: string };

function mergeConsecutive(msgs: AnthropicMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const m of msgs) {
    const content = m.content.trim();
    if (!content) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) {
      last.content += "\n\n" + content;
    } else {
      out.push({ role: m.role, content });
    }
  }
  return out;
}

/**
 * Anthropic Messages API requires the first message to be from `user` and strict user/assistant alternation.
 * Chat UIs often send history that starts with `assistant` or has consecutive same-role turns; normalize here.
 */
export function normalizeAnthropicMessages(msgs: AnthropicMessage[]): AnthropicMessage[] {
  let out = mergeConsecutive(msgs.map((m) => ({ role: m.role, content: m.content })));

  while (out[0]?.role === "assistant") {
    const a = out.shift()!;
    let userContent = `Prior assistant output:\n\n${a.content.trim()}`;
    const next = out[0];
    const nextRole: AnthropicMessage["role"] | undefined = next?.role;
    if (nextRole === "user" && next) {
      userContent += "\n\n" + next.content.trim();
      out.shift();
    }
    out.unshift({ role: "user", content: userContent });
    out = mergeConsecutive(out);
  }

  if (out.length === 0) {
    return [{ role: "user", content: "(no content)" }];
  }
  return out;
}

export function anthropicMessagesFromChatRequest(req: ChatRequest): AnthropicMessage[] {
  const msgs: AnthropicMessage[] = [];
  if (req.history?.length) {
    for (const turn of req.history) {
      msgs.push({ role: turn.role, content: turn.content });
    }
  }
  msgs.push({ role: "user", content: renderChatContext(req) });
  return normalizeAnthropicMessages(msgs);
}

/** Parse `error.message` (or short raw body) from Anthropic JSON error responses. */
export function parseAnthropicErrorBody(bodyText: string): string | undefined {
  const t = bodyText.trim();
  if (!t) return undefined;
  try {
    const j = JSON.parse(t) as { error?: { message?: string; type?: string } };
    const msg = j.error?.message?.trim();
    if (msg) return msg;
    const typ = j.error?.type?.trim();
    if (typ) return typ;
  } catch {
    /* ignore */
  }
  if (t.length <= 280) return t;
  return `${t.slice(0, 277)}…`;
}
