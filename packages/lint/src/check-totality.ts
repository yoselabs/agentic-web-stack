// Lint (opt-in): for every method tagged @totality in
// packages/api/src/domains/**/*-contract.ts, the E channel union must
// contain a variant matching /Skipped[A-Z]\w*Error$/.
//
// Why: R023's record-level accountability principle — a method that
// processes records must declare the "skipped with reason" disposition
// in the type system, not just the success/error split.

import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Project, type SourceFile, SyntaxKind } from "ts-morph";
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
    // (1) Scan class prototype methods (e.g. class body method declarations).
    for (const m of cls.getMethods()) {
      const jsdocs = m.getJsDocs();
      const hasTotality = jsdocs.some((d) =>
        d.getTags().some((t) => t.getTagName() === "totality"),
      );
      if (!hasTotality) continue;
      const rtNode = m.getReturnTypeNode();
      const rtText = rtNode?.getText() ?? "";
      const eChannel = extractEChannel(rtText);
      if (!eChannel || !SKIPPED_RE.test(eChannel)) {
        errors.push(
          `${rel}:${m.getStartLineNumber()}  ${cls.getName()}.${m.getName()} is @totality but its E channel does not include a *SkippedError variant (got: ${eChannel ?? "<no annotation>"})`,
        );
      }
    }

    // (2) Scan property methods inside Effect.Service succeed:/sync:/effect:
    // object literals. These appear when the service is defined as:
    //   class Foo extends Effect.Service<Foo>()("key", { succeed: { method: ... } }) {}
    // The methods are object literal properties, not class prototype methods,
    // so getMethods() above doesn't find them. We walk the class heritage
    // call expression arguments to find the options object.
    for (const heritageClause of cls.getHeritageClauses()) {
      for (const type of heritageClause.getTypeNodes()) {
        // The heritage node for Effect.Service<Foo>()("key", opts) is a
        // CallExpression. Walk the call chain to find the options argument.
        const expr = type.getExpression();
        if (!expr.isKind(SyntaxKind.CallExpression)) continue;
        const callExpr = expr.asKind(SyntaxKind.CallExpression);
        if (!callExpr) continue;
        const args = callExpr.getArguments();
        // Second argument (index 1) is the options object: { succeed: {...} }
        const optsArg = args[1];
        if (!optsArg || !optsArg.isKind(SyntaxKind.ObjectLiteralExpression))
          continue;
        const opts = optsArg.asKind(SyntaxKind.ObjectLiteralExpression);
        if (!opts) continue;
        for (const prop of opts.getProperties()) {
          if (!prop.isKind(SyntaxKind.PropertyAssignment)) continue;
          const propAssign = prop.asKind(SyntaxKind.PropertyAssignment);
          if (!propAssign) continue;
          const propName = propAssign.getName();
          // Only scan succeed:/sync:/effect: option values
          if (
            propName !== "succeed" &&
            propName !== "sync" &&
            propName !== "effect"
          )
            continue;
          const init = propAssign.getInitializer();
          if (!init || !init.isKind(SyntaxKind.ObjectLiteralExpression))
            continue;
          const serviceObj = init.asKind(SyntaxKind.ObjectLiteralExpression);
          if (!serviceObj) continue;
          for (const methodProp of serviceObj.getProperties()) {
            if (!methodProp.isKind(SyntaxKind.PropertyAssignment)) continue;
            const methodAssign = methodProp.asKind(
              SyntaxKind.PropertyAssignment,
            );
            if (!methodAssign) continue;
            // PropertyAssignment nodes don't have getJsDocs(); use
            // getLeadingCommentRanges() and scan the raw comment text.
            const comments = methodAssign.getLeadingCommentRanges();
            const hasTotality = comments.some((c) =>
              /@totality/.test(c.getText()),
            );
            if (!hasTotality) continue;
            // Inspect the return type of the method's arrow/function value.
            const methodInit = methodAssign.getInitializer();
            if (
              !methodInit ||
              (!methodInit.isKind(SyntaxKind.ArrowFunction) &&
                !methodInit.isKind(SyntaxKind.FunctionExpression))
            )
              continue;
            const fnNode = methodInit.isKind(SyntaxKind.ArrowFunction)
              ? methodInit.asKind(SyntaxKind.ArrowFunction)
              : methodInit.asKind(SyntaxKind.FunctionExpression);
            if (!fnNode) continue;
            const rtNode = fnNode.getReturnTypeNode();
            const rtText = rtNode?.getText() ?? "";
            const eChannel = extractEChannel(rtText);
            const methodName = methodAssign.getName();
            if (!eChannel || !SKIPPED_RE.test(eChannel)) {
              errors.push(
                `${rel}:${methodAssign.getStartLineNumber()}  ${cls.getName()}.${methodName} is @totality but its E channel does not include a *SkippedError variant (got: ${eChannel ?? "<no annotation>"})`,
              );
            }
          }
        }
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
