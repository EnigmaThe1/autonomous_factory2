export function makeBigString(n: number): string {
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    parts.push(`line-${i}`);
  }
  return parts.join("\n");
}

