import type { ChatRequest } from "../types";

/**
 * Renders a user-facing context string from a ChatRequest, assembling
 * workspace name, file name, selection, diagnostics, and user prompt
 * into a single formatted block.
 *
 * Shared across all HTTP-based providers to avoid divergent formatting.
 */
export function renderChatContext(req: ChatRequest, separator = "\n\n"): string {
  return [
    req.context.workspaceName ? `Workspace: ${req.context.workspaceName}` : "",
    req.context.fileName ? `File: ${req.context.fileName}` : "",
    req.context.selection ? `Selection:\n${req.context.selection}` : "",
    req.context.activeFileText ? `Active file:\n${req.context.activeFileText}` : "",
    req.context.diagnostics?.length
      ? `Diagnostics:\n${req.context.diagnostics.map((d) => `${d.severity}@${d.line}: ${d.message}`).join("\n")}`
      : "",
    `User request:\n${req.prompt}`
  ]
    .filter(Boolean)
    .join(separator);
}
