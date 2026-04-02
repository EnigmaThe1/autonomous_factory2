/**
 * After `tsc`, remove `dist/test/*.test.js` (and `.map`) when the matching
 * `src/test/*.test.ts` no longer exists. Prevents deleted tests from still running.
 */
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const srcDir = join(root, "src", "test");
const distDir = join(root, "dist", "test");

if (!existsSync(distDir)) process.exit(0);
if (!existsSync(srcDir)) {
  console.warn("[sync-dist-tests] src/test missing; skip orphan prune");
  process.exit(0);
}

const srcBasenames = new Set(
  readdirSync(srcDir)
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => f.replace(/\.ts$/, ".js"))
);

for (const f of readdirSync(distDir)) {
  if (!f.endsWith(".test.js")) continue;
  if (srcBasenames.has(f)) continue;
  const jsPath = join(distDir, f);
  console.warn(`[sync-dist-tests] removing orphan ${jsPath}`);
  try {
    unlinkSync(jsPath);
  } catch {
    /* ignore */
  }
  try {
    unlinkSync(`${jsPath}.map`);
  } catch {
    /* ignore */
  }
}
