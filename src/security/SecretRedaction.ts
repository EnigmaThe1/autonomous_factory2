const SENSITIVE_KEYS = ["authorization", "api-key", "apikey", "token", "secret", "password", "bearer"];

export function redactSensitiveObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => redactSensitiveObject(v));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const lowered = key.toLowerCase();
    if (SENSITIVE_KEYS.some((k) => lowered.includes(k))) {
      out[key] = "<redacted>";
      continue;
    }
    out[key] = redactSensitiveObject(v);
  }
  return out;
}
