// Lint: every exported class in packages/api/src/domains/**/*-errors.ts
// must extend `Data.TaggedError("X")<{...}>` where the tag literal "X"
// equals the class name.
//
// Why: tagged errors are the only error shape Effect's E channel can
// discriminate. Plain Error classes break exhaustive .catchTag handling.

import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  Project,
  SyntaxKind,
  type ClassDeclaration,
  type SourceFile,
} from "ts-morph";
import { type CheckResult, timeCheck } from "./checks-types.ts";

const DEFAULT_ROOT = process.cwd();
const SCAN_GLOB = /^packages\/api\/src\/domains\/[^/]+\/[^/]+-errors\.ts$/;

function listFiles(root: string): string[] {
  let raw = "";
  try {
    raw = execSync('git ls-files -z "*.ts"', {
      cwd: root,
      maxBuffer: 32 << 20,
    }).toString("utf8");
  } catch {
    raw = "";
  }
  let files = raw.split("\0").filter(Boolean);
  if (files.length === 0) {
    files = walk(root).map((p) => p.slice(root.length + 1));
  }
  return files.filter((p) => SCAN_GLOB.test(p));
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    let st: ReturnType<typeof statSync> | undefined;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...walk(full));
    } else if (st.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function inspectClass(cls: ClassDeclaration, rel: string): string | undefined {
  if (!cls.isExported()) return;
  const className = cls.getName() ?? "<anonymous>";
  const line = cls.getStartLineNumber();

  const heritage = cls
    .getHeritageClauses()
    .find((h) => h.getToken() === SyntaxKind.ExtendsKeyword);

  if (!heritage) {
    return `${rel}:${line}  ${className} must extend Data.TaggedError("${className}")<{...}>`;
  }

  const typeNode = heritage.getTypeNodes()[0];
  const expr = typeNode?.getExpression();

  if (!expr?.isKind(SyntaxKind.CallExpression)) {
    return `${rel}:${line}  ${className} must extend Data.TaggedError("${className}")<{...}>`;
  }

  const callee = expr.getExpression().getText();
  if (callee !== "Data.TaggedError") {
    return `${rel}:${line}  ${className} must extend Data.TaggedError (got ${callee})`;
  }

  const arg = expr.getArguments()[0];
  if (!arg?.isKind(SyntaxKind.StringLiteral)) {
    return `${rel}:${line}  ${className} Data.TaggedError requires a string literal tag`;
  }

  const tag = arg.getLiteralValue();
  if (tag !== className) {
    return `${rel}:${line}  ${className} tag "${tag}" does not match class name ${className}`;
  }
}

function inspect(sf: SourceFile, rel: string): string[] {
  const errors: string[] = [];
  for (const cls of sf.getClasses()) {
    const issue = inspectClass(cls, rel);
    if (issue) errors.push(issue);
  }
  return errors;
}

export function runTaggedErrors(root: string = DEFAULT_ROOT): {
  errors: string[];
} {
  const files = listFiles(root);
  if (files.length === 0) return { errors: [] };
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: false, noEmit: true },
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

export function checkTaggedErrors(): Promise<CheckResult> {
  return timeCheck("check-tagged-errors", () => runTaggedErrors().errors);
}

if (import.meta.main) {
  const r = await checkTaggedErrors();
  if (!r.ok) {
    for (const e of r.errors) console.error(`[check-tagged-errors] ${e}`);
    process.exit(1);
  }
  console.log("[check-tagged-errors] OK");
}
