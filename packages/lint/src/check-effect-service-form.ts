// Lint: ban Context.Tag(...) and Context.GenericTag(...) calls in src code.
// New services must use `class X extends Effect.Service<X>()(...)` form.
//
// Allowlist:
//   - test files (paths matching /\/__tests__\// or .test.ts(x)?)
//   - files with a top-of-file `// lint-disable-file check-effect-service-form — <reason>` directive
//
// Why: Effect.Service collapses tag + layer + class into one declaration;
// the older Context.Tag form has three places to drift.

import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { type CheckResult, timeCheck } from "./checks-types.ts";

const DEFAULT_ROOT = process.cwd();
const SCAN_ROOTS = ["apps/", "packages/"];
const EXEMPT_PATTERNS: RegExp[] = [
  /\/__tests__\//,
  /\.test\.(ts|tsx)$/,
  /^packages\/lint\//, // lint package's own checks may inspect Tag patterns
  /^node_modules\//,
  /^packages\/[^/]+\/dist\//,
];
const TAG_RE = /\bContext\s*\.\s*(GenericTag|Tag)\s*[(<]/g;
const DISABLE_DIRECTIVE =
  /^\/\/\s*lint-disable-file\s+check-effect-service-form\b/m;

function listFiles(root: string): string[] {
  let raw = "";
  try {
    raw = execSync('git ls-files -z "*.ts" "*.tsx"', {
      cwd: root,
      maxBuffer: 32 << 20,
    }).toString("utf8");
  } catch {}
  let files = raw.split("\0").filter(Boolean);
  if (files.length === 0) {
    const out: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        if (e === "node_modules" || e.startsWith(".")) continue;
        const f = join(d, e);
        const st = statSync(f);
        if (st.isDirectory()) walk(f);
        else out.push(f.slice(root.length + 1));
      }
    };
    walk(root);
    files = out;
  }
  return files
    .filter((p) => SCAN_ROOTS.some((r) => p.startsWith(r)))
    .filter((p) => !EXEMPT_PATTERNS.some((re) => re.test(p)));
}

export function runEffectServiceForm(root: string = DEFAULT_ROOT): {
  errors: string[];
} {
  const errors: string[] = [];
  for (const rel of listFiles(root)) {
    const src = readFileSync(join(root, rel), "utf8");
    if (DISABLE_DIRECTIVE.test(src)) continue;
    TAG_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: canonical regex loop
    while ((m = TAG_RE.exec(src))) {
      const line = src.slice(0, m.index).split("\n").length;
      errors.push(
        `${rel}:${line}  Context.${m[1]} is banned in src; use \`class X extends Effect.Service<X>()(...)\` instead`,
      );
    }
  }
  return { errors };
}

export function checkEffectServiceForm(): Promise<CheckResult> {
  return timeCheck(
    "check-effect-service-form",
    () => runEffectServiceForm().errors,
  );
}

if (import.meta.main) {
  const r = await checkEffectServiceForm();
  if (!r.ok) {
    for (const e of r.errors) console.error(`[check-effect-service-form] ${e}`);
    process.exit(1);
  }
  console.log("[check-effect-service-form] OK");
}
