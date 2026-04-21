// Repo-root-anchored path resolution for env schemas.
//
// Motivating bug (inherited from the prevention-stack handover): relative
// filesystem paths in env vars resolve against `process.cwd()`, which differs
// per invocation — server from apps/server/ vs a seed script from repo root
// produce two different directories for the same literal value. Always
// anchor to the workspace root instead.
//
// Semantics: transform only — NO existsSync check at parse time. Env
// validation must be pure (no filesystem I/O). A missing directory is an
// application-level concern surfaced on first use, not a boot-time validation
// error. This keeps `packages/env` safe to import in any context.

import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

function findRepoRoot(startDir: string): string {
  let dir = startDir;
  while (dir !== dirname(dir)) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(
    `pnpm-workspace.yaml not found walking up from ${startDir}. ` +
      `@project/env/paths expects to run inside the template monorepo.`,
  );
}

export const REPO_ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

/**
 * Zod string transform that resolves relative paths against the repo root.
 * Use for every filesystem-path env var (`STORAGE_ROOT`, `UPLOADS_TMP`, etc.).
 * Absolute inputs pass through unchanged; relative inputs resolve against
 * the workspace root, not `process.cwd()`.
 */
export const absPath = (): z.ZodEffects<z.ZodString, string, string> =>
  z.string().transform((p) => (isAbsolute(p) ? p : resolve(REPO_ROOT, p)));
