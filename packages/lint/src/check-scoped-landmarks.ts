// Scoped-landmark-queries guard for BDD step defs.
//
// Rule: inside `e2e/steps/**/*.ts`, callers like `page.getByTestId(...)`,
// `page.getByText(...)`, `page.getByRole(...)` should be scoped to a
// landmark (navigation / main / dialog / etc.) — e.g. via
// `page.getByRole('navigation').getByTestId(...)`. The bare-page variant
// matches anywhere on the screen, which makes selectors brittle when the
// same element is rendered twice (mobile nav + desktop nav).
//
// Exemption: a `// placement-agnostic:` comment on the previous line
// acknowledges "I really do want the first match anywhere". Use sparingly.
//
// Motivating bug (prevention-stack handover #15): BDD tests passing locally
// but failing intermittently when a mobile/desktop dup rendered the same
// data-testid.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type CheckResult, timeCheck } from "./checks-types.ts";

const DEFAULT_ROOT = process.cwd();
const SCAN_GLOB = "e2e/steps/**/*.ts";
const ALLOWLIST = ".config/allowlists/scoped-landmarks.json";

type AllowEntry = { path: string; reason: string };

function loadAllowlist(root: string): Set<string> {
  const file = join(root, ALLOWLIST);
  if (!existsSync(file)) return new Set();
  const raw = JSON.parse(readFileSync(file, "utf8")) as {
    allow?: AllowEntry[];
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

// Matches `page.getByTestId(`, `page.getByText(`, `page.getByRole(`, etc.
// (method starts with getBy). The `\bpage\b\s*\.` anchor ensures we only
// flag the bare `page` root — `frame.getByTestId` / `dialog.getByTestId`
// are fine (already scoped).
const BARE_PAGE_RE = /\bpage\s*\.\s*getBy[A-Za-z]+\s*\(/g;
const EXEMPT_COMMENT = "// placement-agnostic:";

export function runScopedLandmarks(root: string = DEFAULT_ROOT): {
  errors: string[];
} {
  const errors: string[] = [];
  const allowed = loadAllowlist(root);
  let raw: Buffer;
  try {
    raw = execSync(`git ls-files -z "${SCAN_GLOB}"`, {
      cwd: root,
      maxBuffer: 1024 * 1024 * 8,
    });
  } catch {
    return { errors };
  }
  const files = raw.toString("utf8").split("\0").filter(Boolean);

  for (const rel of files) {
    if (allowed.has(rel)) continue;
    const src = readFileSync(join(root, rel), "utf8");
    const lines = src.split("\n");
    BARE_PAGE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: canonical regex loop
    while ((m = BARE_PAGE_RE.exec(src))) {
      const lineNo = src.slice(0, m.index).split("\n").length;
      // Check the three lines above for exemption comment.
      let exempt = false;
      for (let i = Math.max(0, lineNo - 4); i < lineNo - 1; i++) {
        if ((lines[i] ?? "").trim().startsWith(EXEMPT_COMMENT)) {
          exempt = true;
          break;
        }
      }
      if (exempt) continue;
      errors.push(
        `${rel}:${lineNo}  bare \`page.getBy*(\` — scope to a landmark (page.getByRole('navigation').getByTestId(...)) or add \`${EXEMPT_COMMENT} <reason>\` on the prior line.`,
      );
    }
  }

  return { errors };
}

export function checkScopedLandmarks(): Promise<CheckResult> {
  return timeCheck("check-scoped-landmarks", () => runScopedLandmarks().errors);
}

if (import.meta.main) {
  const result = await checkScopedLandmarks();
  if (!result.ok) {
    for (const e of result.errors)
      console.error(`[check-scoped-landmarks] ${e}`);
    process.exit(1);
  }
  console.log("[check-scoped-landmarks] OK");
}
