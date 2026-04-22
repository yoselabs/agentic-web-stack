// Every `apps/web/src/**/use-*.ts(x)` must have a sibling `.test.ts(x)`.
// Ratcheted via `.config/allowlists/test-siblings.json` — pre-existing misses
// grandfathered; new hooks blocked.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type CheckResult, timeCheck } from "./checks-types.ts";

const DEFAULT_ROOT = process.cwd();
const HOOK_PREFIX = "use-";
const SCAN_ROOT = "apps/web/src/";
const ALLOWLIST = ".config/allowlists/test-siblings.json";

function loadAllowlist(root: string): Set<string> {
  const file = join(root, ALLOWLIST);
  if (!existsSync(file)) return new Set();
  const raw = JSON.parse(readFileSync(file, "utf8")) as {
    allow?: { path: string; reason: string }[];
  };
  const allowed = new Set<string>();
  for (const entry of raw.allow ?? []) {
    if (!entry.reason || entry.reason.trim().length < 10) {
      throw new Error(
        `${ALLOWLIST}: every entry needs a \`reason\` of >= 10 chars. Offending: ${JSON.stringify(entry)}`,
      );
    }
    allowed.add(entry.path);
  }
  return allowed;
}

export function runTestSiblings(root: string = DEFAULT_ROOT): {
  missing: string[];
} {
  const allowed = loadAllowlist(root);
  const raw = execSync('git ls-files -z "apps/web/src/**/use-*.ts*"', {
    cwd: root,
    maxBuffer: 1024 * 1024 * 16,
  });
  const files = raw
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((p) => p.startsWith(SCAN_ROOT))
    .filter((p) => p.endsWith(".ts") || p.endsWith(".tsx"))
    .filter((p) => !p.endsWith(".test.ts") && !p.endsWith(".test.tsx"))
    .filter((p) => !p.endsWith(".stories.tsx"))
    .filter((p) => !/\/__tests__\//.test(p));

  const missing: string[] = [];
  for (const rel of files) {
    const base = rel.split("/").pop() ?? "";
    if (!base.startsWith(HOOK_PREFIX)) continue;
    // A .ts hook may use either .test.ts or .test.tsx (if the test wraps
    // renderHook in a React provider it needs JSX). A .tsx hook takes .test.tsx.
    const testSiblingTs = rel.replace(/\.(tsx?)$/, ".test.ts");
    const testSiblingTsx = rel.replace(/\.(tsx?)$/, ".test.tsx");
    if (existsSync(join(root, testSiblingTs))) continue;
    if (existsSync(join(root, testSiblingTsx))) continue;
    if (allowed.has(rel)) continue;
    missing.push(
      `${rel}  missing sibling ${testSiblingTs} (or .tsx) — every use-*.ts hook needs a test.`,
    );
  }
  return { missing };
}

export function checkTestSiblings(): Promise<CheckResult> {
  return timeCheck("check-test-siblings", () => runTestSiblings().missing);
}

if (import.meta.main) {
  const result = await checkTestSiblings();
  if (!result.ok) {
    for (const e of result.errors) console.error(`[check-test-siblings] ${e}`);
    process.exit(1);
  }
  console.log("[check-test-siblings] OK");
}
