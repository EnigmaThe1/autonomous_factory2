export type Risk = {
  id: string;
  severity: "low" | "medium" | "high";
  title: string;
  mitigation?: string;
};

export function summarizeRisks(risks: Risk[]): string {
  const bySeverity = risks.reduce(
    (acc, r) => {
      acc[r.severity] = (acc[r.severity] || 0) + 1;
      return acc;
    },
    {} as Record<Risk["severity"], number>
  );
  return `Risks: high=${bySeverity.high || 0}, medium=${bySeverity.medium || 0}, low=${bySeverity.low || 0}`;
}

