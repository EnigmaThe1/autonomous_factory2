/**
 * Shared, host-owned fragments appended to agent instructions (modularity defaults).
 */

export const CODING_STANDARDS_FRAGMENT = [
  "Engineering defaults: prefer small, focused modules; avoid files growing beyond ~400 lines without strong reason.",
  "Keep public APIs narrow; colocate tests near features when the workspace already does so.",
  "Match existing project patterns (naming, folders, test runner) before inventing new structure."
].join(" ");

export const ARCHITECTURE_DISCIPLINE_FRAGMENT = [
  "Respect the agreed mission scope; do not silently expand product surface area.",
  "When the mission includes a stored blueprint, align changes with blueprint step intent and acceptance criteria."
].join(" ");
