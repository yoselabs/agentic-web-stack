// Ban `process.cwd()` outside `scripts/` and the two infra modules that
// legitimately need it.
//
// Motivating bug (inherited from prevention-stack handover): env vars with
// relative paths silently resolved against `process.cwd()`, which varied
// per invocation. Runtime code should anchor to `import.meta.url` or the
// repo root (see `@project/env/paths`).

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type CheckResult, timeCheck } from "./checks-types.ts";

const DEFAULT_ROOT = process.cwd();
const SCAN_ROOTS = ["apps/", "packages/", "e2e/"];
const EXEMPT_PATTERNS: RegExp[] = [
  /^scripts\//,
  /^packages\/env\/src\/paths\.ts$/,
  /^packages\/test-infra\//,
  /\/__tests__\//,
  /\.test\.(ts|tsx)$/,
];

const CWD_RE = /\bprocess\s*\.\s*cwd\s*\(/g;

export function runNoCwd(root: string = DEFAULT_ROOT): { errors: string[] } {
  const raw = execSync('git ls-files -z "*.ts" "*.tsx"', {
    cwd: root,
    maxBuffer: 1024 * 1024 * 32,
  });
  const files = raw
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((p) => SCAN_ROOTS.some((r) => p.startsWith(r)))
    .filter((p) => !EXEMPT_PATTERNS.some((re) => re.test(p)));

  const errors: string[] = [];
  for (const rel of files) {
    const src = readFileSync(join(root, rel), "utf8");
    CWD_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: canonical regex loop
    while ((m = CWD_RE.exec(src))) {
      const line = src.slice(0, m.index).split("\n").length;
      errors.push(
        `${rel}:${line}  process.cwd() is banned in runtime code. Use @project/env/paths' absPath() or import.meta.url-anchored resolution.`,
      );
    }
  }
  return { errors };
}

export function checkNoCwd(): Promise<CheckResult> {
  return timeCheck("check-no-cwd", () => runNoCwd().errors);
}

if (import.meta.main) {
  const result = await checkNoCwd();
  if (!result.ok) {
    for (const e of result.errors) console.error(`[check-no-cwd] ${e}`);
    process.exit(1);
  }
  console.log("[check-no-cwd] OK");
}
