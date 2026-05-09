// Lint (opt-in): for every method tagged @totality in
// packages/api/src/domains/**/*-contract.ts, the E channel union must
// contain a variant matching /Skipped[A-Z]\w*Error$/.
//
// Why: R023's record-level accountability principle — a method that
// processes records must declare the "skipped with reason" disposition
// in the type system, not just the success/error split.

import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Project, type SourceFile } from "ts-morph";
import { type CheckResult, timeCheck } from "./checks-types.ts";

const DEFAULT_ROOT = process.cwd();
const SCAN_GLOB = /^packages\/api\/src\/domains\/[^/]+\/[^/]+-contract\.ts$/;
const SKIPPED_RE = /Skipped\w*Error/;

function listFiles(root: string): string[] {
  let raw = "";
  try {
    raw = execSync('git ls-files -z "*.ts"', {
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
  return files.filter((p) => SCAN_GLOB.test(p));
}

function inspect(sf: SourceFile, rel: string): string[] {
  const errors: string[] = [];
  for (const cls of sf.getClasses()) {
    for (const m of cls.getMethods()) {
      const jsdocs = m.getJsDocs();
      const hasTotality = jsdocs.some((d) =>
        d.getTags().some((t) => t.getTagName() === "totality"),
      );
      if (!hasTotality) continue;
      const rtNode = m.getReturnTypeNode();
      const rtText = rtNode?.getText() ?? "";
      // Pull out the second type argument of Effect.Effect<A, E, R>.
      // Cheap parse: split at `,` at depth 1 inside the outer <...>.
      const eChannel = extractEChannel(rtText);
      if (!eChannel || !SKIPPED_RE.test(eChannel)) {
        errors.push(
          `${rel}:${m.getStartLineNumber()}  ${cls.getName()}.${m.getName()} is @totality but its E channel does not include a *SkippedError variant (got: ${eChannel ?? "<no annotation>"})`,
        );
      }
    }
  }
  return errors;
}

function extractEChannel(rt: string): string | null {
  const m = rt.match(/^Effect\.Effect\s*<([\s\S]+)>\s*$/);
  if (!m) return null;
  const inner = m[1];
  const parts: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of inner) {
    if (ch === "<") depth++;
    if (ch === ">") depth--;
    if (ch === "," && depth === 0) {
      parts.push(buf.trim());
      buf = "";
    } else {
      buf += ch;
    }
  }
  parts.push(buf.trim());
  return parts[1] ?? null;
}

export function runTotality(root: string = DEFAULT_ROOT): { errors: string[] } {
  const files = listFiles(root);
  if (files.length === 0) return { errors: [] };
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { noEmit: true },
  });
  const errors: string[] = [];
  for (const rel of files) {
    const full = join(root, rel);
    const sf = project.createSourceFile(full, readFileSync(full, "utf8"), {
      overwrite: true,
    });
    errors.push(...inspect(sf, rel));
  }
  return { errors };
}

export function checkTotality(): Promise<CheckResult> {
  return timeCheck("check-totality", () => runTotality().errors);
}

if (import.meta.main) {
  const r = await checkTotality();
  if (!r.ok) {
    for (const e of r.errors) console.error(`[check-totality] ${e}`);
    process.exit(1);
  }
  console.log("[check-totality] OK");
}
