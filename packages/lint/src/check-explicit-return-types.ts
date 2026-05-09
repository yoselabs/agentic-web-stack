// Lint: every export from packages/api/src/domains/**/*-{contract,service}.ts
// must declare an Effect.Effect<A, E, R> return type. Inferred returns are
// an error even when inference resolves to Effect.Effect — explicit > inferred.
//
// Why: Effect's three-channel return type IS the AI agent's compile-time
// contract. Inference defeats it. See spec D7 / R073 hardness engineering.

import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { type Node, Project, type SourceFile, SyntaxKind } from "ts-morph";
import { type CheckResult, timeCheck } from "./checks-types.ts";

const DEFAULT_ROOT = process.cwd();
const SCAN_GLOB =
  /^packages\/api\/src\/domains\/[^/]+\/[^/]+-(contract|service)\.ts$/;

type Issue = { file: string; line: number; name: string; reason: string };

function listFiles(root: string): string[] {
  // Tests use synthetic fixtures outside git; fall back to recursive walk
  // when `git ls-files` returns empty.
  let raw = "";
  try {
    raw = execSync('git ls-files -z "*.ts"', {
      cwd: root,
      maxBuffer: 1024 * 1024 * 32,
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
    const full = join(dir, entry);
    let st: ReturnType<typeof statSync> | undefined;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      out.push(...walk(full));
    } else if (st.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function returnTypeText(node: Node): string | undefined {
  if (
    node.isKind(SyntaxKind.FunctionDeclaration) ||
    node.isKind(SyntaxKind.MethodDeclaration) ||
    node.isKind(SyntaxKind.ArrowFunction) ||
    node.isKind(SyntaxKind.FunctionExpression)
  ) {
    // ts-morph: getReturnTypeNode is non-null only when annotated.
    // biome-ignore lint/suspicious/noExplicitAny: ts-morph union typing
    const rtNode = (node as any).getReturnTypeNode?.();
    return rtNode ? rtNode.getText() : undefined;
  }
}

function isEffectEffect(text: string): boolean {
  // Strip whitespace; accept Effect.Effect<...> (and its qualified or aliased forms).
  const t = text.replace(/\s+/g, "");
  return /^Effect\.Effect</.test(t);
}

function inspectExport(sf: SourceFile): Issue[] {
  const rel = sf.getFilePath();
  const issues: Issue[] = [];
  for (const stmt of sf.getStatements()) {
    if (
      !stmt.isKind(SyntaxKind.VariableStatement) &&
      !stmt.isKind(SyntaxKind.FunctionDeclaration) &&
      !stmt.isKind(SyntaxKind.ClassDeclaration)
    )
      continue;
    // biome-ignore lint/suspicious/noExplicitAny: union narrowing
    const exported = (stmt as any).hasExportKeyword?.();
    if (!exported) continue;

    if (stmt.isKind(SyntaxKind.FunctionDeclaration)) {
      const rt = returnTypeText(stmt);
      const name = stmt.getName() ?? "<anonymous>";
      if (!rt || !isEffectEffect(rt)) {
        issues.push({
          file: rel,
          line: stmt.getStartLineNumber(),
          name,
          reason: rt
            ? `return type ${rt} is not Effect.Effect<A, E, R>`
            : "no return type annotation",
        });
      }
    } else if (stmt.isKind(SyntaxKind.VariableStatement)) {
      for (const decl of stmt.getDeclarations()) {
        const init = decl.getInitializer();
        if (!init) continue;
        if (
          init.isKind(SyntaxKind.ArrowFunction) ||
          init.isKind(SyntaxKind.FunctionExpression)
        ) {
          const rt = returnTypeText(init);
          if (!rt || !isEffectEffect(rt)) {
            issues.push({
              file: rel,
              line: decl.getStartLineNumber(),
              name: decl.getName(),
              reason: rt
                ? `return type ${rt} is not Effect.Effect<A, E, R>`
                : "no return type annotation",
            });
          }
        }
      }
    } else if (stmt.isKind(SyntaxKind.ClassDeclaration)) {
      for (const m of stmt.getMethods()) {
        const rt = returnTypeText(m);
        if (!rt || !isEffectEffect(rt)) {
          issues.push({
            file: rel,
            line: m.getStartLineNumber(),
            name: m.getName(),
            reason: rt
              ? `return type ${rt} is not Effect.Effect<A, E, R>`
              : "no return type annotation",
          });
        }
      }
    }
  }
  return issues;
}

export function runExplicitReturnTypes(root: string = DEFAULT_ROOT): {
  errors: string[];
} {
  const files = listFiles(root);
  if (files.length === 0) return { errors: [] };
  const project = new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: false, noEmit: true },
  });
  const errors: string[] = [];
  for (const rel of files) {
    const full = join(root, rel);
    const src = readFileSync(full, "utf8");
    if (src.startsWith("// lint-disable-file check-explicit-return-types"))
      continue;
    const sf = project.createSourceFile(full, src, { overwrite: true });
    for (const i of inspectExport(sf)) {
      errors.push(
        `${rel}:${i.line}  ${i.name} must declare Effect.Effect<A, E, R> (${i.reason})`,
      );
    }
  }
  return { errors };
}

export function checkExplicitReturnTypes(): Promise<CheckResult> {
  return timeCheck(
    "check-explicit-return-types",
    () => runExplicitReturnTypes().errors,
  );
}

if (import.meta.main) {
  const result = await checkExplicitReturnTypes();
  if (!result.ok) {
    for (const e of result.errors)
      console.error(`[check-explicit-return-types] ${e}`);
    process.exit(1);
  }
  console.log("[check-explicit-return-types] OK");
}
