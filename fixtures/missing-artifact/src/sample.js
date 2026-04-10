"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.summarizeRisks = summarizeRisks;
function summarizeRisks(risks) {
    const bySeverity = risks.reduce((acc, r) => {
        acc[r.severity] = (acc[r.severity] || 0) + 1;
        return acc;
    }, {});
    return `Risks: high=${bySeverity.high || 0}, medium=${bySeverity.medium || 0}, low=${bySeverity.low || 0}`;
}
//# sourceMappingURL=sample.js.map