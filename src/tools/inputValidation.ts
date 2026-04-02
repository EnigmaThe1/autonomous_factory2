/**
 * Input validation and sanitization for security-sensitive tool calls.
 * Prevents common injection vectors while allowing legitimate operations.
 */

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  sanitized?: string;
}

const COMMAND_DENY_PATTERNS = [
  /;\s*rm\s+-rf\s+\//,
  /;\s*dd\s+if=/,
  /\|\s*sh\b/,
  /\$\(\s*curl\b/,
  /`\s*curl\b/,
  /mkfs\./,
  />\s*\/dev\/sd[a-z]/,
  /:\s*\(\s*\)\s*\{.*\|.*&\s*\}\s*;/,
];

export function validateCommand(command: string): ValidationResult {
  if (!command.trim()) {
    return { valid: false, reason: "Empty command" };
  }
  if (command.length > 10_000) {
    return { valid: false, reason: "Command exceeds 10,000 character limit" };
  }
  for (const pattern of COMMAND_DENY_PATTERNS) {
    if (pattern.test(command)) {
      return { valid: false, reason: `Command contains blocked pattern: ${pattern.source.slice(0, 40)}` };
    }
  }
  return { valid: true };
}

export function validateContainerName(name: string): ValidationResult {
  if (!name.trim()) {
    return { valid: false, reason: "Empty container name" };
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(name)) {
    return { valid: false, reason: "Invalid container name (must match Docker naming rules)" };
  }
  return { valid: true };
}

export function validateDbEngine(engine: string): ValidationResult {
  const allowed = new Set(["postgres", "postgresql", "mysql", "sqlite"]);
  if (!allowed.has(engine.toLowerCase())) {
    return { valid: false, reason: `Unsupported database engine: ${engine}. Allowed: ${[...allowed].join(", ")}` };
  }
  return { valid: true };
}

const SQL_DENY_PATTERNS = [
  /;\s*DROP\s+(DATABASE|SCHEMA)\s/i,
  /;\s*TRUNCATE\s+/i,
  /GRANT\s+ALL\s+/i,
  /ALTER\s+SYSTEM\s+/i,
  /CREATE\s+EXTENSION\s+/i,
];

export function validateSqlQuery(query: string): ValidationResult {
  if (!query.trim()) {
    return { valid: false, reason: "Empty SQL query" };
  }
  if (query.length > 50_000) {
    return { valid: false, reason: "SQL query exceeds 50,000 character limit" };
  }
  for (const pattern of SQL_DENY_PATTERNS) {
    if (pattern.test(query)) {
      return { valid: false, reason: `SQL query contains blocked pattern: ${pattern.source.slice(0, 50)}` };
    }
  }
  return { valid: true };
}

export function validateSearchQuery(query: string): ValidationResult {
  const t = query.trim();
  if (!t) {
    return { valid: false, reason: "Empty search query" };
  }
  if (t.length > 400) {
    return { valid: false, reason: "Search query exceeds 400 characters" };
  }
  if (t.includes("\0")) {
    return { valid: false, reason: "Invalid search query" };
  }
  return { valid: true };
}

export function validateUrl(url: string): ValidationResult {
  if (!url.trim()) {
    return { valid: false, reason: "Empty URL" };
  }
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { valid: false, reason: `Unsupported protocol: ${parsed.protocol}. Only http/https allowed.` };
    }
    const blockedHosts = ["169.254.169.254", "metadata.google.internal"];
    if (blockedHosts.includes(parsed.hostname)) {
      return { valid: false, reason: "Access to cloud metadata endpoints is blocked" };
    }
    return { valid: true };
  } catch {
    return { valid: false, reason: "Invalid URL format" };
  }
}

export function validateFilePath(filePath: string): ValidationResult {
  if (!filePath.trim()) {
    return { valid: false, reason: "Empty file path" };
  }
  if (filePath.includes("\0")) {
    return { valid: false, reason: "File path contains null byte" };
  }
  return { valid: true };
}
