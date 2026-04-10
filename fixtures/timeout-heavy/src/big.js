"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeBigString = makeBigString;
function makeBigString(n) {
    const parts = [];
    for (let i = 0; i < n; i++) {
        parts.push(`line-${i}`);
    }
    return parts.join("\n");
}
//# sourceMappingURL=big.js.map