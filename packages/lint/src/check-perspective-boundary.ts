// Perspective-boundary guard — config-driven.
//
// When a domain has a self-varying field (i.e. one row's value is different
// per viewer — classic example: `presence`), direct access to that field
// leaks perspective. Owner code should read it once and the rest of the
// app should consume a derived `{ self, others }` shape instead.
//
// This check is opt-in: ships with an empty config on this template. Add
// entries to `.config/allowlists/perspective-boundary.json` when a domain introduces such a
// field.
//
// Config schema:
//   {
//     "fields": ["presence", "lastSeenAt"],   // forbidden field names
//     "ownerFiles": [                         // files that legitimately read them
//       "packages/api/src/domains/presence/presence-service.ts"
//     ]
//   }
//
// Motivating bug (prevention-stack handover #9): presence field leaking
// the requesting user's perspective into every consumer.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type CheckResult, timeCheck } from "./checks-types.ts";

const DEFAULT_ROOT = process.cwd();
const CONFIG_FILE = ".config/allowlists/perspective-boundary.json";
const SCAN_ROOTS = ["apps/", "packages/"];

type Config = {
  fields?: string[];
  ownerFiles?: string[];
};

export function runPerspectiveBoundary(root: string = DEFAULT_ROOT): {
  errors: string[];
} {
  const errors: string[] = [];
  const cfgPath = join(root, CONFIG_FILE);
  if (!existsSync(cfgPath)) return { errors };
  let cfg: Config;
  try {
    cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  } catch (err) {
    errors.push(
      `${CONFIG_FILE}  parse error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { errors };
  }

  const fields = (cfg.fields ?? []).filter(Boolean);
  if (fields.length === 0) return { errors };
  const ownerFiles = new Set((cfg.ownerFiles ?? []).filter(Boolean));

  let raw: Buffer;
  try {
    raw = execSync('git ls-files -z "*.ts" "*.tsx"', {
      cwd: root,
      maxBuffer: 1024 * 1024 * 32,
    });
  } catch {
    return { errors };
  }
  const files = raw
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((p) => SCAN_ROOTS.some((r) => p.startsWith(r)))
    .filter((p) => !/\/__tests__\//.test(p))
    .filter((p) => !/\.test\.(ts|tsx)$/.test(p))
    .filter((p) => !/\/generated\//.test(p));

  // Match `<ident>.<field>` — a conservative heuristic. The field must be in
  // the configured list; owner files are exempt.
  const fieldAlt = fields
    .map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const re = new RegExp(`\\b\\w+\\s*\\.\\s*(${fieldAlt})\\b`, "g");

  for (const rel of files) {
    if (ownerFiles.has(rel)) continue;
    const src = readFileSync(join(root, rel), "utf8");
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: canonical regex loop
    while ((m = re.exec(src))) {
      const field = m[1];
      const line = src.slice(0, m.index).split("\n").length;
      errors.push(
        `${rel}:${line}  perspective-boundary: direct access to \`.${field}\` is restricted — add this file to \`ownerFiles\` in ${CONFIG_FILE} or consume a \`{ self, others }\`-derived shape instead.`,
      );
    }
  }

  return { errors };
}

export function checkPerspectiveBoundary(): Promise<CheckResult> {
  return timeCheck(
    "check-perspective-boundary",
    () => runPerspectiveBoundary().errors,
  );
}

if (import.meta.main) {
  // TODO(Phase-3): remove WIPE_IN_PROGRESS guard once perspective-bounded fields in apps/ and packages/ exist.
  // See docs/superpowers/specs/2026-04-28-effect-rewrite-phase-1-design.md
  if (process.env.WIPE_IN_PROGRESS === "1") {
    console.log(
      "[check-perspective-boundary] skipped — wipe in progress (Phase 1 design doc)",
    );
    process.exit(0);
  }

  const result = await checkPerspectiveBoundary();
  if (!result.ok) {
    for (const e of result.errors)
      console.error(`[check-perspective-boundary] ${e}`);
    process.exit(1);
  }
  console.log("[check-perspective-boundary] OK");
}
