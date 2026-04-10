export class RecoveryBudget {
  private readonly attempts = new Map<string, number>();

  /**
   * Consume one attempt for a key if under max.
   * Returns the updated count and whether another attempt was allowed.
   */
  consume(key: string, maxAttempts: number): { allowed: boolean; attempt: number } {
    const prev = this.attempts.get(key) || 0;
    const next = prev + 1;
    if (next > maxAttempts) return { allowed: false, attempt: prev };
    this.attempts.set(key, next);
    return { allowed: true, attempt: next };
  }

  peek(key: string): number {
    return this.attempts.get(key) || 0;
  }
}

