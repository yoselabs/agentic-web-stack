// Enforce: `process.env.X` is only read inside @project/env (which validates
// every var via Zod) or a small allowlist of infrastructure files that
// genuinely need direct access (Vite config, Playwright config, test runners,
// Prisma config, scripts). App code must import `env` from
// `@project/env/server` or `/client` so schema changes propagate and
// validation runs at module load.
//
// If this check fails, the fix is usually:
//   - import { env } from "@project/env/server";  // server / nodejs code
//   - import { env } from "@project/env/client";  // browser / client code
//
// If the file legitimately belongs in the infra allowlist, add it below.
// Keep the allowlist small and review each addition.

import { spawnSync } from "node:child_process";

const ALLOWED_GLOBS = [
  // @project/env itself — this is where process.env is read + validated
  "packages/env/**",
  // All scripts/ folders — root `scripts/` and any nested (e.g.
  // `packages/api/scripts/`, `e2e/scripts/`). Ripgrep's gitignore-style
  // globs require `**/scripts/**` to match at arbitrary depth, not just root.
  "scripts/**",
  "**/scripts/**",
  // Vite / Playwright / Prisma configs read env directly by design
  "**/vite.config.ts",
  "**/playwright.config.ts",
  "packages/db/prisma.config.ts",
  // Never scan these
  "node_modules",
  "**/*.gen.*",
];

const rgArgs = [
  "process\\.env\\.",
  "--type",
  "ts",
  ...ALLOWED_GLOBS.flatMap((g) => ["-g", `!${g}`]),
];

const result = spawnSync("rg", rgArgs, { encoding: "utf8" });

// rg exit codes: 0 = matches found, 1 = no matches, 2 = error.
// For us, "no matches" is the pass condition.
if (result.status === 1) {
  process.exit(0);
}
if (result.status === 0) {
  console.error(
    "FAIL: process.env.X read outside @project/env — import `env` from @project/env/server (or /client).",
  );
  console.error(result.stdout);
  process.exit(1);
}
console.error(`rg exited ${result.status} with error:`, result.stderr);
process.exit(2);
