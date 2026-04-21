#!/usr/bin/env bun
// Single-CLI dispatcher for @project/lint checks.
//
// Usage: lint-check <name>
//   e.g. `pnpm --filter @project/lint exec lint-check no-barrel`
//
// Dispatch is by filename — forwards to `bun ../src/check-<name>.ts`
// (or `../src/lint-<name>.ts` for the `lint-*` family). Each check script
// has its own `if (import.meta.main)` top-level runner that prints errors
// and sets the exit code. The dispatcher is a thin name→file mapper so
// the package can expose `lint-check <name>` as its single CLI.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

const ALIASES: Record<string, string> = {
  // checks named with the `lint-` prefix historically
  "state-machines": "lint-state-machines.ts",
};

const name = process.argv[2];
if (!name) {
  console.error("usage: lint-check <name>");
  process.exit(2);
}

const filename = ALIASES[name] ?? `check-${name}.ts`;
const scriptPath = join(SRC_DIR, filename);
if (!existsSync(scriptPath)) {
  console.error(`unknown check: ${name} (looked for ${filename})`);
  process.exit(2);
}

const result = spawnSync("bun", [scriptPath, ...process.argv.slice(3)], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
