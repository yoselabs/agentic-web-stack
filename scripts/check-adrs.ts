// MADR ADR bidirectional cite check.
//
// For each `docs/adrs/*.md` with `status: accepted` (front-matter), require:
//   - at least one `verified_by:` entry, each listing a file that exists AND
//     contains either `ADR-NNNN` or `@adr NNNN` (NNNN from the ADR filename).
//   - every `@adr NNNN` / `ADR-NNNN` reference in apps/**, packages/**,
//     scripts/**, docs/** resolves to an existing ADR file.
//
// Motivating rule (from prevention-stack handover): "documented = checked" —
// ADRs rot when the code they claim to govern stops citing them. This keeps
// the link bidirectional.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import matter from "gray-matter";
import { type CheckResult, timeCheck } from "./checks-types.ts";

const DEFAULT_ROOT = process.cwd();
const ADR_DIR = "docs/adrs";
const SCAN_ROOTS = ["apps/", "packages/", "scripts/", "docs/"];

// Matches `ADR-001`, `ADR-0001`, `@adr 001`, `@adr 0001` — normalized to
// a 4-digit number for comparison against filenames.
const CITE_RE = /(?:@adr\s+|ADR-)(\d{3,4})\b/g;

function normalize(num: string): string {
  return num.padStart(4, "0");
}

type AdrFront = {
  status?: string;
  verified_by?: string[] | string;
};

function adrNumberFromPath(rel: string): string | null {
  const name = basename(rel);
  const m = /^(\d{4})-/.exec(name);
  return m?.[1] ?? null;
}

export function runAdrs(root: string = DEFAULT_ROOT): { errors: string[] } {
  const errors: string[] = [];
  const adrDirAbs = join(root, ADR_DIR);

  if (!existsSync(adrDirAbs)) return { errors };

  // 1. Collect ADR files + their numbers.
  const adrFilesRaw = execSync(`git ls-files -z "${ADR_DIR}/*.md"`, {
    cwd: root,
    maxBuffer: 1024 * 1024 * 4,
  });
  const adrFiles = adrFilesRaw.toString("utf8").split("\0").filter(Boolean);
  const knownNumbers = new Set<string>();
  for (const rel of adrFiles) {
    const n = adrNumberFromPath(rel);
    if (n) knownNumbers.add(n);
  }

  // 2. For each accepted ADR, check verified_by entries.
  for (const rel of adrFiles) {
    const abs = join(root, rel);
    const src = readFileSync(abs, "utf8");
    const { data } = matter(src) as { data: AdrFront };
    if ((data.status ?? "").toLowerCase() !== "accepted") continue;

    const num = adrNumberFromPath(rel);
    if (!num) {
      errors.push(`${rel}  ADR filename must start with NNNN-`);
      continue;
    }

    const verified = Array.isArray(data.verified_by)
      ? data.verified_by
      : typeof data.verified_by === "string"
        ? [data.verified_by]
        : [];

    if (verified.length === 0) {
      errors.push(
        `${rel}  accepted ADR missing \`verified_by:\` — list files that cite ADR-${num} or @adr ${num}.`,
      );
      continue;
    }

    for (const v of verified) {
      const target = join(root, v);
      if (!existsSync(target)) {
        errors.push(
          `${rel}  verified_by entry \`${v}\` does not exist on disk.`,
        );
        continue;
      }
      const body = readFileSync(target, "utf8");
      const shortNum = num.replace(/^0+/, "") || "0";
      const hasCite =
        new RegExp(`ADR-0*${shortNum}\\b`).test(body) ||
        new RegExp(`@adr\\s+0*${shortNum}\\b`).test(body);
      if (!hasCite) {
        errors.push(
          `${rel}  verified_by entry \`${v}\` does not contain \`ADR-${num}\` or \`@adr ${num}\`.`,
        );
      }
    }
  }

  // 3. Every @adr / ADR- cite in scan roots must resolve.
  const rawAll = execSync('git ls-files -z "*.ts" "*.tsx" "*.md" "*.sh"', {
    cwd: root,
    maxBuffer: 1024 * 1024 * 64,
  });
  const allFiles = rawAll
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((p) => SCAN_ROOTS.some((r) => p.startsWith(r)))
    .filter((p) => !p.startsWith(`${ADR_DIR}/`)) // ADRs self-cite; handled above
    .filter((p) => !/\/__tests__\//.test(p)) // fixture tests contain synthetic cites
    .filter((p) => !/\.test\.(ts|tsx)$/.test(p))
    .filter((p) => p !== "scripts/check-adrs.ts"); // the regex lives here

  for (const rel of allFiles) {
    const src = readFileSync(join(root, rel), "utf8");
    CITE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: canonical regex loop
    while ((m = CITE_RE.exec(src))) {
      const raw = m[1];
      if (!raw) continue;
      const num = normalize(raw);
      if (knownNumbers.has(num)) continue;
      const line = src.slice(0, m.index).split("\n").length;
      errors.push(
        `${rel}:${line}  cite ADR-${num} does not resolve — no matching file in ${ADR_DIR}/.`,
      );
    }
  }

  return { errors };
}

export function checkAdrs(): Promise<CheckResult> {
  return timeCheck("check-adrs", () => runAdrs().errors);
}

if (import.meta.main) {
  const result = await checkAdrs();
  if (!result.ok) {
    for (const e of result.errors) console.error(`[check-adrs] ${e}`);
    process.exit(1);
  }
  console.log("[check-adrs] OK");
}
