# Effect Contract-First — Day 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the hardness-engineering foundation for the Effect contract-first rewrite — five custom lint checks + the conventions doc + migrating four infrastructure services (`Db`, `Auth`, `CurrentSession`, `QueueTag`) to the modern `Effect.Service` form. After Day 1, `make lint` enforces the rules; Days 2–7 retrofit domains under those rules.

**Architecture:** Each lint check is a standalone TS file under `packages/lint/src/check-<name>.ts` exporting `check<Name>(): Promise<CheckResult>` via the established `timeCheck()` helper, with a Bun-test fixture under `packages/lint/src/__tests__/`. Each check is wired into root `package.json` scripts, `turbo.json` tasks (with narrow `inputs` globs), and `Makefile`'s `TURBO_LINT_TASKS`. Service migration replaces `Context.Tag(...)` + `Layer.effect(...)` boilerplate with `class X extends Effect.Service<X>()(...)` declarations; consumers swap `XLive` imports for `X.Default`.

**Tech Stack:** TypeScript, Bun (test runner for lint package), Effect 3.x, ts-morph (already in `@project/lint`), turbo, BullMQ.

**Source spec:** `docs/superpowers/specs/2026-05-07-effect-contract-first-design.md`

**Branch:** `rewrite/contract-first` (cut from `main@0131caf`).

**Pre-Day-1 setup (do this once before Task 1):**

```bash
git tag stable-pre-effect 0131caf
git push origin stable-pre-effect
git checkout -b rewrite/contract-first
```

The `stable-pre-effect` tag is the hard-rollback anchor referenced in the spec.

---

## File Structure

| File | Responsibility | New / Modified |
|---|---|---|
| `packages/lint/src/check-explicit-return-types.ts` | Lint: domain exports declare `Effect.Effect<A, E, R>` return types | Create |
| `packages/lint/src/__tests__/check-explicit-return-types.test.ts` | Fixture tests | Create |
| `packages/lint/src/check-tagged-errors.ts` | Lint: `*-errors.ts` exports extend `Data.TaggedError(...)` | Create |
| `packages/lint/src/__tests__/check-tagged-errors.test.ts` | Fixture tests | Create |
| `packages/lint/src/check-effect-service-form.ts` | Lint: ban `Context.Tag` / `Context.GenericTag` outside allowlist | Create |
| `packages/lint/src/__tests__/check-effect-service-form.test.ts` | Fixture tests | Create |
| `packages/lint/src/check-contract-before-impl.ts` | Lint: `<name>-service.ts` requires sibling contract/schema/errors | Create |
| `packages/lint/src/__tests__/check-contract-before-impl.test.ts` | Fixture tests | Create |
| `packages/lint/src/check-totality.ts` | Lint (opt-in): `@totality` methods declare `*SkippedError` variants | Create |
| `packages/lint/src/__tests__/check-totality.test.ts` | Fixture tests | Create |
| `packages/lint/package.json` | Add five `./checks/<name>` exports | Modify |
| `package.json` | Add five `lint:check:<name>` scripts | Modify |
| `turbo.json` | Add five `//#lint:check:<name>` task entries | Modify |
| `Makefile` | Append five tasks to `TURBO_LINT_TASKS` | Modify |
| `docs/conventions/effect-contract-first.md` | ALWAYS/NEVER conventions doc | Create |
| `CLAUDE.md` | Link to new conventions doc | Modify |
| `packages/api/src/runtime/db-layer.ts` | Migrate `Db` to `Effect.Service` form | Modify |
| `packages/api/src/runtime/auth-layer.ts` | Migrate `Auth` + `CurrentSession` to `Effect.Service` form | Modify |
| `packages/api/src/runtime/app-layer.ts` | Compose via `.Default` instead of `*Live` | Modify |
| `packages/jobs/src/queue-layer.ts` | Migrate `QueueTag` → `Queue` (`Effect.Service` form) | Modify |
| Consumers of `DbLive`/`AuthLive`/`CurrentSessionLive`/`QueueLive`/`QueueTag` | Swap imports to `.Default` form | Modify |

**Note on Logger.** `packages/api/src/runtime/logger-layer.ts` uses Effect's built-in `Logger` (per ADR-0017) — it's not a custom tag and does not need migration. Spec D5 listed Logger by inertia; Day 1 migration scope is `Db`, `Auth`, `CurrentSession`, `QueueTag→Queue`.

---

### Task 1: `check-explicit-return-types`

**What it enforces.** Every `export` from `packages/api/src/domains/**/*-{contract,service}.ts` declares an `Effect.Effect<A, E, R>` return type. Inferred returns are an error even when inference resolves to `Effect.Effect`.

**Files:**
- Create: `packages/lint/src/check-explicit-return-types.ts`
- Create: `packages/lint/src/__tests__/check-explicit-return-types.test.ts`
- Modify: `packages/lint/package.json` (add export)
- Modify: `package.json` (add script)
- Modify: `turbo.json` (add task)
- Modify: `Makefile` (append to `TURBO_LINT_TASKS`)

- [ ] **Step 1: Write the failing test**

Create `packages/lint/src/__tests__/check-explicit-return-types.test.ts`:

```ts
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runExplicitReturnTypes } from "../check-explicit-return-types.ts";

let root: string;

function makeWorkspace(files: Record<string, string>) {
  root = mkdtempSync(join(tmpdir(), "check-explicit-return-types-"));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
}

describe("runExplicitReturnTypes", () => {
  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("flags an exported function with inferred return", () => {
    makeWorkspace({
      "packages/api/src/domains/foo/foo-service.ts":
        'export const list = (id: string) => ({ id });\n',
    });
    const res = runExplicitReturnTypes(root);
    expect(res.errors.length).toBe(1);
    expect(res.errors[0]).toMatch(/foo-service\.ts/);
    expect(res.errors[0]).toMatch(/list/);
  });

  it("accepts an exported function with Effect.Effect return", () => {
    makeWorkspace({
      "packages/api/src/domains/foo/foo-contract.ts":
        'import { Effect } from "effect";\n' +
        'export const list = (id: string): Effect.Effect<string, never, never> => Effect.succeed(id);\n',
    });
    const res = runExplicitReturnTypes(root);
    expect(res.errors.length).toBe(0);
  });

  it("flags an exported function whose return is annotated but not Effect.Effect", () => {
    makeWorkspace({
      "packages/api/src/domains/foo/foo-service.ts":
        'export const list = (id: string): string => id;\n',
    });
    const res = runExplicitReturnTypes(root);
    expect(res.errors.length).toBe(1);
    expect(res.errors[0]).toMatch(/must declare Effect\.Effect/);
  });

  it("ignores files outside packages/api/src/domains", () => {
    makeWorkspace({
      "packages/api/src/runtime/foo.ts":
        'export const list = (id: string) => ({ id });\n',
    });
    const res = runExplicitReturnTypes(root);
    expect(res.errors.length).toBe(0);
  });

  it("ignores non-contract/non-service files in the domain folder", () => {
    makeWorkspace({
      "packages/api/src/domains/foo/foo-router.ts":
        'export const list = (id: string) => ({ id });\n',
      "packages/api/src/domains/foo/foo-constants.ts":
        'export const MAX = 100;\n',
    });
    const res = runExplicitReturnTypes(root);
    expect(res.errors.length).toBe(0);
  });

  it("flags class methods on exported classes too", () => {
    makeWorkspace({
      "packages/api/src/domains/foo/foo-service.ts":
        'export class FooService {\n  list(id: string) { return id; }\n}\n',
    });
    const res = runExplicitReturnTypes(root);
    expect(res.errors.length).toBe(1);
    expect(res.errors[0]).toMatch(/list/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/lint && bun test src/__tests__/check-explicit-return-types.test.ts`
Expected: FAIL with `Cannot find module '../check-explicit-return-types.ts'`.

- [ ] **Step 3: Write the check**

Create `packages/lint/src/check-explicit-return-types.ts`:

```ts
// Lint: every export from packages/api/src/domains/**/*-{contract,service}.ts
// must declare an Effect.Effect<A, E, R> return type. Inferred returns are
// an error even when inference resolves to Effect.Effect — explicit > inferred.
//
// Why: Effect's three-channel return type IS the AI agent's compile-time
// contract. Inference defeats it. See spec D7 / R073 hardness engineering.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Project, SyntaxKind, type Node, type SourceFile } from "ts-morph";
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
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let st;
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
  return undefined;
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
    if (!stmt.isKind(SyntaxKind.VariableStatement) &&
        !stmt.isKind(SyntaxKind.FunctionDeclaration) &&
        !stmt.isKind(SyntaxKind.ClassDeclaration)) continue;
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
          reason: rt ? `return type ${rt} is not Effect.Effect<A, E, R>` : "no return type annotation",
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
  return timeCheck("check-explicit-return-types", () =>
    runExplicitReturnTypes().errors,
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/lint && bun test src/__tests__/check-explicit-return-types.test.ts`
Expected: PASS, 6/6 tests.

- [ ] **Step 5: Wire into package.json exports**

Edit `packages/lint/package.json`. Add to `exports`:

```json
"./checks/explicit-return-types": {
  "default": "./src/check-explicit-return-types.ts"
},
```

- [ ] **Step 6: Wire into root scripts**

Edit `package.json` (repo root). Add to `scripts`:

```json
"lint:check:explicit-return-types": "bun packages/lint/src/check-explicit-return-types.ts",
```

- [ ] **Step 7: Wire into turbo.json**

Edit `turbo.json`. Add task entry under `tasks` (mirror the shape of `//#lint:check:no-cwd`):

```json
"//#lint:check:explicit-return-types": {
  "inputs": [
    "packages/lint/src/check-explicit-return-types.ts",
    "packages/lint/src/checks-types.ts",
    "packages/api/src/domains/**/*-contract.ts",
    "packages/api/src/domains/**/*-service.ts"
  ],
  "outputs": []
}
```

- [ ] **Step 8: Wire into Makefile**

Edit `Makefile`. Append `lint:check:explicit-return-types` to `TURBO_LINT_TASKS`.

- [ ] **Step 9: Smoke run**

Run: `make lint`
Expected: PASS (existing domain code may have inferred returns — see Step 10 if so).

- [ ] **Step 10: Triage any pre-existing violations**

If `make lint` reports violations in `packages/api/src/domains/todo-list/`, that's expected — the Day 3 retrofit will fix them. **Do not fix them in this commit.** Instead, mark the check as warnings-only on the existing domain files for now: add a top-of-file `// lint-disable-file check-explicit-return-types — Day 3 retrofit (rewrite/contract-first plan)` comment, and update the check to honor that directive (add `if (src.startsWith("// lint-disable-file check-explicit-return-types")) continue;` near the top of the file loop in `runExplicitReturnTypes`).

Re-run: `make lint`. Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/lint/src/check-explicit-return-types.ts \
        packages/lint/src/__tests__/check-explicit-return-types.test.ts \
        packages/lint/package.json package.json turbo.json Makefile \
        packages/api/src/domains/todo-list/
git commit -m "feat(lint): add check-explicit-return-types

Enforces that every export from packages/api/src/domains/**/*-{contract,service}.ts
declares an Effect.Effect<A, E, R> return type. Day 1 of the contract-first
rewrite — see docs/superpowers/specs/2026-05-07-effect-contract-first-design.md.

Existing todo-list domain files carry a temporary lint-disable-file directive;
Day 3 retrofit lifts it."
```

---

### Task 2: `check-tagged-errors`

**What it enforces.** Every `export class` in `packages/api/src/domains/**/*-errors.ts` extends `Data.TaggedError("...")<{...}>`. The string literal in `TaggedError("X")` must equal the class name `X`.

**Files:**
- Create: `packages/lint/src/check-tagged-errors.ts`
- Create: `packages/lint/src/__tests__/check-tagged-errors.test.ts`
- Modify: `packages/lint/package.json`, `package.json`, `turbo.json`, `Makefile`

- [ ] **Step 1: Write the failing test**

Create `packages/lint/src/__tests__/check-tagged-errors.test.ts`:

```ts
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTaggedErrors } from "../check-tagged-errors.ts";

let root: string;

function makeWorkspace(files: Record<string, string>) {
  root = mkdtempSync(join(tmpdir(), "check-tagged-errors-"));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
}

describe("runTaggedErrors", () => {
  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("accepts a properly tagged error class", () => {
    makeWorkspace({
      "packages/api/src/domains/foo/foo-errors.ts":
        'import { Data } from "effect";\n' +
        'export class FooError extends Data.TaggedError("FooError")<{ readonly cause: unknown }> {}\n',
    });
    expect(runTaggedErrors(root).errors.length).toBe(0);
  });

  it("flags a class that does not extend Data.TaggedError", () => {
    makeWorkspace({
      "packages/api/src/domains/foo/foo-errors.ts":
        'export class FooError extends Error {}\n',
    });
    const res = runTaggedErrors(root);
    expect(res.errors.length).toBe(1);
    expect(res.errors[0]).toMatch(/must extend Data\.TaggedError/);
  });

  it("flags a tag-name / class-name mismatch", () => {
    makeWorkspace({
      "packages/api/src/domains/foo/foo-errors.ts":
        'import { Data } from "effect";\n' +
        'export class FooError extends Data.TaggedError("WrongTag")<{}> {}\n',
    });
    const res = runTaggedErrors(root);
    expect(res.errors.length).toBe(1);
    expect(res.errors[0]).toMatch(/tag "WrongTag" does not match class name FooError/);
  });

  it("ignores non-errors files", () => {
    makeWorkspace({
      "packages/api/src/domains/foo/foo-service.ts":
        'export class Helper {}\n',
    });
    expect(runTaggedErrors(root).errors.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/lint && bun test src/__tests__/check-tagged-errors.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write the check**

Create `packages/lint/src/check-tagged-errors.ts`:

```ts
// Lint: every exported class in packages/api/src/domains/**/*-errors.ts
// must extend `Data.TaggedError("X")<{...}>` where the tag literal "X"
// equals the class name.
//
// Why: tagged errors are the only error shape Effect's E channel can
// discriminate. Plain Error classes break exhaustive .catchTag handling.

import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Project, SyntaxKind, type SourceFile } from "ts-morph";
import { type CheckResult, timeCheck } from "./checks-types.ts";

const DEFAULT_ROOT = process.cwd();
const SCAN_GLOB = /^packages\/api\/src\/domains\/[^/]+\/[^/]+-errors\.ts$/;

function listFiles(root: string): string[] {
  let raw = "";
  try {
    raw = execSync('git ls-files -z "*.ts"', { cwd: root, maxBuffer: 32 << 20 }).toString("utf8");
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
    if (!cls.isExported()) continue;
    const heritage = cls.getHeritageClauses().find((h) => h.getToken() === SyntaxKind.ExtendsKeyword);
    const className = cls.getName() ?? "<anonymous>";
    const line = cls.getStartLineNumber();
    if (!heritage) {
      errors.push(`${rel}:${line}  ${className} must extend Data.TaggedError("${className}")<{...}>`);
      continue;
    }
    const expr = heritage.getTypeNodes()[0]?.getExpression();
    if (!expr || !expr.isKind(SyntaxKind.CallExpression)) {
      errors.push(`${rel}:${line}  ${className} must extend Data.TaggedError("${className}")<{...}>`);
      continue;
    }
    const callee = expr.getExpression().getText();
    if (callee !== "Data.TaggedError") {
      errors.push(`${rel}:${line}  ${className} must extend Data.TaggedError (got ${callee})`);
      continue;
    }
    const arg = expr.getArguments()[0];
    if (!arg || !arg.isKind(SyntaxKind.StringLiteral)) {
      errors.push(`${rel}:${line}  ${className} Data.TaggedError requires a string literal tag`);
      continue;
    }
    const tag = arg.getLiteralValue();
    if (tag !== className) {
      errors.push(`${rel}:${line}  ${className} tag "${tag}" does not match class name ${className}`);
    }
  }
  return errors;
}

export function runTaggedErrors(root: string = DEFAULT_ROOT): { errors: string[] } {
  const files = listFiles(root);
  if (files.length === 0) return { errors: [] };
  const project = new Project({ skipAddingFilesFromTsConfig: true, compilerOptions: { noEmit: true } });
  const errors: string[] = [];
  for (const rel of files) {
    const full = join(root, rel);
    const sf = project.createSourceFile(full, readFileSync(full, "utf8"), { overwrite: true });
    errors.push(...inspect(sf, rel));
  }
  return { errors };
}

export function checkTaggedErrors(): Promise<CheckResult> {
  return timeCheck("check-tagged-errors", () => runTaggedErrors().errors);
}

if (import.meta.main) {
  const r = await checkTaggedErrors();
  if (!r.ok) { for (const e of r.errors) console.error(`[check-tagged-errors] ${e}`); process.exit(1); }
  console.log("[check-tagged-errors] OK");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/lint && bun test src/__tests__/check-tagged-errors.test.ts`
Expected: PASS, 4/4.

- [ ] **Step 5: Wire glue (mirror Task 1, Steps 5–8)**

- `packages/lint/package.json` exports: add `"./checks/tagged-errors": { "default": "./src/check-tagged-errors.ts" }`
- root `package.json`: add `"lint:check:tagged-errors": "bun packages/lint/src/check-tagged-errors.ts"`
- `turbo.json`: add `"//#lint:check:tagged-errors"` task with inputs `packages/lint/src/check-tagged-errors.ts`, `packages/lint/src/checks-types.ts`, `packages/api/src/domains/**/*-errors.ts`, outputs `[]`
- `Makefile`: append `lint:check:tagged-errors` to `TURBO_LINT_TASKS`

- [ ] **Step 6: Smoke run**

Run: `make lint`
Expected: PASS (no `*-errors.ts` files exist yet; check returns clean).

- [ ] **Step 7: Commit**

```bash
git add packages/lint/src/check-tagged-errors.ts \
        packages/lint/src/__tests__/check-tagged-errors.test.ts \
        packages/lint/package.json package.json turbo.json Makefile
git commit -m "feat(lint): add check-tagged-errors

Enforces every exported class in packages/api/src/domains/**/*-errors.ts
extends Data.TaggedError(\"X\")<{...}> with tag === class name. Day 1 of
the contract-first rewrite."
```

---

### Task 3: `check-effect-service-form`

**What it enforces.** Ban `Context.Tag(...)` and `Context.GenericTag(...)` calls outside an explicit allowlist. New services must use `class X extends Effect.Service<X>()(...)` form.

**Allowlist (initial — kept minimal on purpose):**
- `packages/lint/src/__tests__/**` (own fixtures)
- Anywhere with a top-of-file `// lint-disable-file check-effect-service-form — <reason>` directive (used for the day-1 service migration commit, then removed in the same commit; serves as escape hatch for genuine non-service tags if any emerge)

**Files:**
- Create: `packages/lint/src/check-effect-service-form.ts`
- Create: `packages/lint/src/__tests__/check-effect-service-form.test.ts`
- Modify: `packages/lint/package.json`, `package.json`, `turbo.json`, `Makefile`

- [ ] **Step 1: Write the failing test**

Create `packages/lint/src/__tests__/check-effect-service-form.test.ts`:

```ts
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEffectServiceForm } from "../check-effect-service-form.ts";

let root: string;

function makeWorkspace(files: Record<string, string>) {
  root = mkdtempSync(join(tmpdir(), "check-effect-service-form-"));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
}

describe("runEffectServiceForm", () => {
  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("flags a Context.Tag call in src code", () => {
    makeWorkspace({
      "packages/api/src/runtime/foo-layer.ts":
        'import { Context } from "effect";\n' +
        'export class Foo extends Context.Tag("Foo")<Foo, FooShape>() {}\n',
    });
    const res = runEffectServiceForm(root);
    expect(res.errors.length).toBe(1);
    expect(res.errors[0]).toMatch(/Context\.Tag/);
  });

  it("flags Context.GenericTag too", () => {
    makeWorkspace({
      "packages/jobs/src/queue.ts":
        'import { Context } from "effect";\n' +
        'export const Q = Context.GenericTag<{}>("Q");\n',
    });
    const res = runEffectServiceForm(root);
    expect(res.errors.length).toBe(1);
    expect(res.errors[0]).toMatch(/Context\.GenericTag/);
  });

  it("accepts Effect.Service form", () => {
    makeWorkspace({
      "packages/api/src/runtime/foo-layer.ts":
        'import { Effect } from "effect";\n' +
        'export class Foo extends Effect.Service<Foo>()("Foo", { effect: Effect.succeed({}) }) {}\n',
    });
    expect(runEffectServiceForm(root).errors.length).toBe(0);
  });

  it("respects file-level disable directive", () => {
    makeWorkspace({
      "packages/api/src/runtime/foo-layer.ts":
        '// lint-disable-file check-effect-service-form — interim during day-1 migration\n' +
        'import { Context } from "effect";\n' +
        'export class Foo extends Context.Tag("Foo")<Foo, {}>() {}\n',
    });
    expect(runEffectServiceForm(root).errors.length).toBe(0);
  });

  it("ignores test files", () => {
    makeWorkspace({
      "packages/api/src/__tests__/foo.test.ts":
        'import { Context } from "effect";\nconst T = Context.GenericTag<{}>("T");\n',
    });
    expect(runEffectServiceForm(root).errors.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/lint && bun test src/__tests__/check-effect-service-form.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the check**

Create `packages/lint/src/check-effect-service-form.ts`:

```ts
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
import { readFileSync, readdirSync, statSync } from "node:fs";
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
const DISABLE_DIRECTIVE = /^\/\/\s*lint-disable-file\s+check-effect-service-form\b/m;

function listFiles(root: string): string[] {
  let raw = "";
  try {
    raw = execSync('git ls-files -z "*.ts" "*.tsx"', { cwd: root, maxBuffer: 32 << 20 }).toString("utf8");
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

export function runEffectServiceForm(root: string = DEFAULT_ROOT): { errors: string[] } {
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
  return timeCheck("check-effect-service-form", () => runEffectServiceForm().errors);
}

if (import.meta.main) {
  const r = await checkEffectServiceForm();
  if (!r.ok) { for (const e of r.errors) console.error(`[check-effect-service-form] ${e}`); process.exit(1); }
  console.log("[check-effect-service-form] OK");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/lint && bun test src/__tests__/check-effect-service-form.test.ts`
Expected: PASS, 5/5.

- [ ] **Step 5: Wire glue (mirror Task 1)**

- `packages/lint/package.json` exports: `"./checks/effect-service-form": { "default": "./src/check-effect-service-form.ts" }`
- root `package.json` script: `"lint:check:effect-service-form": "bun packages/lint/src/check-effect-service-form.ts"`
- `turbo.json` task: `"//#lint:check:effect-service-form"` with inputs `packages/lint/src/check-effect-service-form.ts`, `packages/lint/src/checks-types.ts`, `apps/**/*.ts`, `apps/**/*.tsx`, `packages/**/*.ts`, `packages/**/*.tsx`, outputs `[]`
- `Makefile`: append `lint:check:effect-service-form`

- [ ] **Step 6: Apply the file-level disable directive on existing Context.Tag sites**

`make lint` will fail until Task 6 migrates the services. Add the disable directive to the four files Task 6 will rewrite:

```ts
// lint-disable-file check-effect-service-form — Day-1 migration in progress (Task 6)
```

at the top of:
- `packages/api/src/runtime/db-layer.ts`
- `packages/api/src/runtime/auth-layer.ts`
- `packages/jobs/src/queue-layer.ts`

(Logger is unaffected — it doesn't use `Context.Tag`.)

- [ ] **Step 7: Smoke run**

Run: `make lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/lint/src/check-effect-service-form.ts \
        packages/lint/src/__tests__/check-effect-service-form.test.ts \
        packages/lint/package.json package.json turbo.json Makefile \
        packages/api/src/runtime/db-layer.ts \
        packages/api/src/runtime/auth-layer.ts \
        packages/jobs/src/queue-layer.ts
git commit -m "feat(lint): add check-effect-service-form

Bans Context.Tag / Context.GenericTag in src code; mandates Effect.Service
modern form. Existing Db/Auth/CurrentSession/QueueTag carry an interim
lint-disable-file directive lifted by Task 6. Day 1 of the contract-first
rewrite."
```

---

### Task 4: `check-contract-before-impl`

**What it enforces.** If `<name>-service.ts` exists in a domain folder, sibling `<name>-contract.ts`, `<name>-schema.ts`, `<name>-errors.ts` MUST also exist.

**Files:**
- Create: `packages/lint/src/check-contract-before-impl.ts`
- Create: `packages/lint/src/__tests__/check-contract-before-impl.test.ts`
- Modify: glue files

- [ ] **Step 1: Write the failing test**

Create `packages/lint/src/__tests__/check-contract-before-impl.test.ts`:

```ts
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runContractBeforeImpl } from "../check-contract-before-impl.ts";

let root: string;

function makeWorkspace(files: string[]) {
  root = mkdtempSync(join(tmpdir(), "check-contract-before-impl-"));
  for (const rel of files) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, "// stub\n");
  }
}

describe("runContractBeforeImpl", () => {
  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("accepts a complete domain", () => {
    makeWorkspace([
      "packages/api/src/domains/foo/foo-contract.ts",
      "packages/api/src/domains/foo/foo-schema.ts",
      "packages/api/src/domains/foo/foo-errors.ts",
      "packages/api/src/domains/foo/foo-service.ts",
    ]);
    expect(runContractBeforeImpl(root).errors.length).toBe(0);
  });

  it("flags a service without contract", () => {
    makeWorkspace([
      "packages/api/src/domains/foo/foo-schema.ts",
      "packages/api/src/domains/foo/foo-errors.ts",
      "packages/api/src/domains/foo/foo-service.ts",
    ]);
    const r = runContractBeforeImpl(root);
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]).toMatch(/foo-contract\.ts/);
  });

  it("flags a service without schema", () => {
    makeWorkspace([
      "packages/api/src/domains/foo/foo-contract.ts",
      "packages/api/src/domains/foo/foo-errors.ts",
      "packages/api/src/domains/foo/foo-service.ts",
    ]);
    expect(runContractBeforeImpl(root).errors.length).toBe(1);
  });

  it("flags a service without errors", () => {
    makeWorkspace([
      "packages/api/src/domains/foo/foo-contract.ts",
      "packages/api/src/domains/foo/foo-schema.ts",
      "packages/api/src/domains/foo/foo-service.ts",
    ]);
    expect(runContractBeforeImpl(root).errors.length).toBe(1);
  });

  it("accepts a contract-only domain (post-#2 pre-#4 state)", () => {
    makeWorkspace([
      "packages/api/src/domains/foo/foo-contract.ts",
      "packages/api/src/domains/foo/foo-schema.ts",
      "packages/api/src/domains/foo/foo-errors.ts",
    ]);
    expect(runContractBeforeImpl(root).errors.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/lint && bun test src/__tests__/check-contract-before-impl.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the check**

Create `packages/lint/src/check-contract-before-impl.ts`:

```ts
// Lint: every <name>-service.ts in packages/api/src/domains/<name>/ must have
// sibling <name>-contract.ts, <name>-schema.ts, <name>-errors.ts.
//
// Why: enforces the six-file capability layout from spec D1. The frozen-
// contract AI handoff (D3) is meaningless if the contract files don't
// exist when the service is committed.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { type CheckResult, timeCheck } from "./checks-types.ts";

const DEFAULT_ROOT = process.cwd();
const REQUIRED_SIBLINGS = ["contract", "schema", "errors"] as const;

function domainDirs(root: string): string[] {
  const base = join(root, "packages/api/src/domains");
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .map((n) => join(base, n))
    .filter((p) => {
      try {
        return statSync(p).isDirectory();
      } catch {
        return false;
      }
    });
}

export function runContractBeforeImpl(root: string = DEFAULT_ROOT): { errors: string[] } {
  const errors: string[] = [];
  for (const dir of domainDirs(root)) {
    const name = dir.split("/").pop()!;
    const servicePath = join(dir, `${name}-service.ts`);
    if (!existsSync(servicePath)) continue;
    for (const sibling of REQUIRED_SIBLINGS) {
      const expected = join(dir, `${name}-${sibling}.ts`);
      if (!existsSync(expected)) {
        const rel = expected.slice(root.length + 1);
        errors.push(
          `${dir.slice(root.length + 1)}/${name}-service.ts requires sibling ${rel}`,
        );
      }
    }
  }
  return { errors };
}

export function checkContractBeforeImpl(): Promise<CheckResult> {
  return timeCheck("check-contract-before-impl", () => runContractBeforeImpl().errors);
}

if (import.meta.main) {
  const r = await checkContractBeforeImpl();
  if (!r.ok) { for (const e of r.errors) console.error(`[check-contract-before-impl] ${e}`); process.exit(1); }
  console.log("[check-contract-before-impl] OK");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/lint && bun test src/__tests__/check-contract-before-impl.test.ts`
Expected: PASS, 5/5.

- [ ] **Step 5: Wire glue (mirror Task 1)**

- exports: `"./checks/contract-before-impl": { "default": "./src/check-contract-before-impl.ts" }`
- root script: `"lint:check:contract-before-impl": "bun packages/lint/src/check-contract-before-impl.ts"`
- turbo task `//#lint:check:contract-before-impl` with inputs `packages/lint/src/check-contract-before-impl.ts`, `packages/lint/src/checks-types.ts`, `packages/api/src/domains/**`, outputs `[]`
- Makefile: append

- [ ] **Step 6: Triage existing todo-list domain**

Existing `packages/api/src/domains/todo-list/` has `todo-service.ts` but is missing `todo-contract.ts`/`todo-schema.ts`/`todo-errors.ts` (only `todo-schema.ts` may exist; verify with `ls`). The check will fail on `todo-list`.

Day 3 retrofits this for real. For now, suppress per-domain by adding a placeholder file `packages/api/src/domains/todo-list/.lint-pending` and updating the check to skip a domain whose dir contains `.lint-pending`:

```ts
// Inside runContractBeforeImpl, before the inner loop:
if (existsSync(join(dir, ".lint-pending"))) continue;
```

Re-run test fixtures (add a 6th test for `.lint-pending` skip), then `make lint`. Expected: PASS.

```ts
// Add to test file:
it("skips a domain marked .lint-pending", () => {
  makeWorkspace([
    "packages/api/src/domains/foo/foo-service.ts",
    "packages/api/src/domains/foo/.lint-pending",
  ]);
  expect(runContractBeforeImpl(root).errors.length).toBe(0);
});
```

- [ ] **Step 7: Commit**

```bash
git add packages/lint/src/check-contract-before-impl.ts \
        packages/lint/src/__tests__/check-contract-before-impl.test.ts \
        packages/lint/package.json package.json turbo.json Makefile \
        packages/api/src/domains/todo-list/.lint-pending
git commit -m "feat(lint): add check-contract-before-impl

Enforces every <name>-service.ts has sibling contract/schema/errors files.
todo-list carries .lint-pending until Day 3 retrofit. Day 1 of the
contract-first rewrite."
```

---

### Task 5: `check-totality` (opt-in)

**What it enforces.** For every method in `packages/api/src/domains/**/*-contract.ts` whose JSDoc contains `@totality`, the method's declared E channel union must contain at least one variant whose name matches `/Skipped[A-Z]\w*Error$/`.

**Files:**
- Create: `packages/lint/src/check-totality.ts`
- Create: `packages/lint/src/__tests__/check-totality.test.ts`
- Modify: glue files

- [ ] **Step 1: Write the failing test**

Create `packages/lint/src/__tests__/check-totality.test.ts`:

```ts
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTotality } from "../check-totality.ts";

let root: string;

function makeWorkspace(files: Record<string, string>) {
  root = mkdtempSync(join(tmpdir(), "check-totality-"));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
}

describe("runTotality", () => {
  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("accepts a @totality method declaring a *SkippedError variant", () => {
    makeWorkspace({
      "packages/api/src/domains/foo/foo-contract.ts": `
        import { Effect } from "effect";
        export class FooService {
          /** @totality */
          purge(): Effect.Effect<number, FooError | FooSkippedError, never> { return Effect.die("nyi"); }
        }
      `,
    });
    expect(runTotality(root).errors.length).toBe(0);
  });

  it("flags a @totality method missing *SkippedError", () => {
    makeWorkspace({
      "packages/api/src/domains/foo/foo-contract.ts": `
        import { Effect } from "effect";
        export class FooService {
          /** @totality */
          purge(): Effect.Effect<number, FooError, never> { return Effect.die("nyi"); }
        }
      `,
    });
    const r = runTotality(root);
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]).toMatch(/@totality/);
    expect(r.errors[0]).toMatch(/SkippedError/);
  });

  it("ignores methods without @totality", () => {
    makeWorkspace({
      "packages/api/src/domains/foo/foo-contract.ts": `
        import { Effect } from "effect";
        export class FooService {
          list(): Effect.Effect<number, FooError, never> { return Effect.die("nyi"); }
        }
      `,
    });
    expect(runTotality(root).errors.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/lint && bun test src/__tests__/check-totality.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the check**

Create `packages/lint/src/check-totality.ts`:

```ts
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
import { Project, SyntaxKind, type SourceFile } from "ts-morph";
import { type CheckResult, timeCheck } from "./checks-types.ts";

const DEFAULT_ROOT = process.cwd();
const SCAN_GLOB = /^packages\/api\/src\/domains\/[^/]+\/[^/]+-contract\.ts$/;
const SKIPPED_RE = /\bSkipped[A-Z]\w*Error\b/;

function listFiles(root: string): string[] {
  let raw = "";
  try {
    raw = execSync('git ls-files -z "*.ts"', { cwd: root, maxBuffer: 32 << 20 }).toString("utf8");
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
  const project = new Project({ skipAddingFilesFromTsConfig: true, compilerOptions: { noEmit: true } });
  const errors: string[] = [];
  for (const rel of files) {
    const full = join(root, rel);
    const sf = project.createSourceFile(full, readFileSync(full, "utf8"), { overwrite: true });
    errors.push(...inspect(sf, rel));
  }
  return { errors };
}

export function checkTotality(): Promise<CheckResult> {
  return timeCheck("check-totality", () => runTotality().errors);
}

if (import.meta.main) {
  const r = await checkTotality();
  if (!r.ok) { for (const e of r.errors) console.error(`[check-totality] ${e}`); process.exit(1); }
  console.log("[check-totality] OK");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/lint && bun test src/__tests__/check-totality.test.ts`
Expected: PASS, 3/3.

- [ ] **Step 5: Wire glue (mirror Task 1)**

- exports: `"./checks/totality"`
- root script: `"lint:check:totality"`
- turbo task `//#lint:check:totality` with inputs `packages/lint/src/check-totality.ts`, `packages/lint/src/checks-types.ts`, `packages/api/src/domains/**/*-contract.ts`, outputs `[]`
- Makefile: append `lint:check:totality`

- [ ] **Step 6: Smoke run**

Run: `make lint`
Expected: PASS (no contract files exist yet).

- [ ] **Step 7: Commit**

```bash
git add packages/lint/src/check-totality.ts \
        packages/lint/src/__tests__/check-totality.test.ts \
        packages/lint/package.json package.json turbo.json Makefile
git commit -m "feat(lint): add check-totality (opt-in)

Per-method @totality JSDoc tag requires a *SkippedError variant in the
E channel — R023 record-level accountability at compile time. Day 1 of
the contract-first rewrite."
```

---

### Task 6: Conventions doc + CLAUDE.md link

**Files:**
- Create: `docs/conventions/effect-contract-first.md`
- Modify: `CLAUDE.md` (add cross-reference)

- [ ] **Step 1: Write the conventions doc**

Create `docs/conventions/effect-contract-first.md`:

```markdown
# Effect Contract-First Conventions

> Status: enforced from `rewrite/contract-first` Day 1 (commit `<TBD>`).
> Source spec: `docs/superpowers/specs/2026-05-07-effect-contract-first-design.md`.

## ALWAYS

- ALWAYS declare `Effect.Effect<A, E, R>` return types on every export
  in `packages/api/src/domains/**/*-{contract,service}.ts`. Inferred
  returns are an error (`make lint` → `check-explicit-return-types`).
- ALWAYS define errors with `Data.TaggedError("X")<{...}>` where the tag
  literal equals the class name (`check-tagged-errors`).
- ALWAYS write the `<name>-{contract,schema,errors}.ts` commit BEFORE
  the `<name>-service.ts` commit. The frozen-contract AI handoff
  depends on this order.
- ALWAYS use `class X extends Effect.Service<X>()(...)` for new services.
  `Context.Tag` and `Context.GenericTag` are banned in src
  (`check-effect-service-form`).
- ALWAYS compose layers with `X.Default` (provided by `Effect.Service`),
  not hand-rolled `Layer.effect(Tag, ...)`.
- ALWAYS use Effect Schema (`Schema.Struct(...)`) on the server. Zod
  is permitted only in `apps/web` form code.
- ALWAYS use `Effect.Schedule` for in-process retry composition. BullMQ
  retry stays as the outer envelope.

## NEVER

- NEVER modify `<name>-{contract,schema,errors}.ts` while implementing
  `<name>-service.ts`. Contract changes are separate human-authored
  commits on top of the contract commit.
- NEVER introduce errors not declared in `<name>-errors.ts` from inside
  `<name>-service.ts`. Surface the gap as a question.
- NEVER add services to the `R` channel that are not declared in the
  contract.
- NEVER use Zod on the server. Zod's exception (form input adapters in
  `apps/web/src/lib/forms.ts`) is the only exception.
- NEVER use `Context.Tag` or `Context.GenericTag` for new services.
- NEVER hand-roll BullMQ retry logic inside an Effect — use
  `Effect.Schedule` composed via `Effect.retry`.

## When the AI hits a wall

- If the contract feels wrong, **STOP and ask**. The contract is frozen
  during impl; changing it is a separate human commit on top of the
  contract commit.
- If a new error is needed that is not in `<name>-errors.ts`, the
  contract is wrong (or the service is over-reaching). Same rule: stop
  and ask.
- If the `R` channel needs a new dependency that the contract didn't
  declare, the contract is wrong. Stop and ask.

## @totality opt-in

A method that processes a stream / batch / page of records can opt in
to R023 record-level accountability:

```ts
/** @totality */
purge(): Effect.Effect<PurgeReport, TodoError | TodoSkippedError, Db | Logger> { ... }
```

`check-totality` enforces that the E channel includes at least one
`*SkippedError` variant. Skipping must carry a reason
(`Data.TaggedError("TodoSkippedError")<{ readonly reason: ... }>`).

## Cross-references

- ADR-0009 (full rewrite onto Effect)
- ADR-0014 (schema validation — closed by this rewrite, see D4)
- ADR-0015 (queue — amended, see D5)
- ADR-0017 (logger — unchanged; Effect's built-in `Logger` is already
  idiomatic)
- R023 — Black-Box Module Contracts & Completeness Invariants
- R073 — GRACE / LDD / AI code markup (hardness engineering)
```

- [ ] **Step 2: Link from CLAUDE.md**

Edit `CLAUDE.md`. Add a new section after the existing "Conventions" heading:

```markdown
## Effect Contract-First (rewrite/contract-first)

The Effect contract-first rewrite — see [docs/conventions/effect-contract-first.md](docs/conventions/effect-contract-first.md) — defines ALWAYS/NEVER rules for the six-file capability layout (`<name>-{contract,schema,errors,service,router}.ts` + `__tests__/`). Five custom lint checks enforce it: `check-explicit-return-types`, `check-tagged-errors`, `check-effect-service-form`, `check-contract-before-impl`, `check-totality` (opt-in).

Source spec: `docs/superpowers/specs/2026-05-07-effect-contract-first-design.md`.
```

- [ ] **Step 3: Smoke run**

Run: `make lint`
Expected: PASS (markdown lint may or may not flag — fix per its messages).

- [ ] **Step 4: Commit**

```bash
git add docs/conventions/effect-contract-first.md CLAUDE.md
git commit -m "docs: add Effect contract-first conventions + CLAUDE.md link

ALWAYS/NEVER rules for the six-file capability layout, the five lint
checks, and the @totality opt-in. Day 1 of the contract-first rewrite."
```

---

### Task 7: Migrate `Db` / `Auth` / `CurrentSession` / `QueueTag` to `Effect.Service`

**Files:**
- Modify: `packages/api/src/runtime/db-layer.ts`
- Modify: `packages/api/src/runtime/auth-layer.ts`
- Modify: `packages/api/src/runtime/app-layer.ts`
- Modify: `packages/jobs/src/queue-layer.ts`
- Modify: any consumer importing `DbLive`, `AuthLive`, `CurrentSessionLive`, `QueueTag`, `QueueLive`

**Approach.** Each migration is the same shape:
1. Replace `class X extends Context.Tag("...")<X, Shape>() {}` + `XLive = Layer.effect(X, ...)` with `class X extends Effect.Service<X>()("...", { effect | scoped: ... }) {}`.
2. Update `app-layer.ts` to compose `X.Default` instead of `XLive`.
3. Update consumers' imports.
4. Remove the `// lint-disable-file check-effect-service-form` directive from each migrated file.
5. Run `tsc -b` and `make test-unit` after each migration; commit at end.

- [ ] **Step 1: Inventory consumers**

Run:

```bash
git grep -nE "DbLive|AuthLive|CurrentSessionLive|QueueLive|QueueTag" -- 'apps/**' 'packages/**' \
  | grep -v 'dist/' | grep -v 'node_modules/'
```

Expected: list of files importing the old `*Live` symbols. Save this list — every match becomes an edit in Step 5.

- [ ] **Step 2: Migrate `Db`**

Read `packages/api/src/runtime/db-layer.ts`. Replace the `Context.Tag` declaration + `DbLive` layer with:

```ts
import { Effect } from "effect";
import { PrismaClient } from "@project/db";

export class Db extends Effect.Service<Db>()("@project/api/Db", {
  effect: Effect.gen(function* () {
    const client = new PrismaClient();
    yield* Effect.addFinalizer(() => Effect.promise(() => client.$disconnect()));
    return client;
  }),
  // PrismaClient is process-global → singleton
  accessors: true,
}) {}
```

Remove the `lint-disable-file check-effect-service-form` directive.

Remove the separate `export const DbLive = ...` line. The replacement layer is `Db.Default`.

- [ ] **Step 3: Migrate `Auth` + `CurrentSession`**

Read `packages/api/src/runtime/auth-layer.ts`. Apply the same transform to both classes. `CurrentSession`'s service body keeps whatever per-request value it currently holds; the `Effect.Service` form for a per-request value uses `succeed:` instead of `effect:` and consumers provide it via `Layer.succeed(CurrentSession, value)` or by overriding `CurrentSession.Default` per request — keep current per-request behavior; only the declaration changes.

Concretely, if the current shape is `class CurrentSession extends Context.Tag(...)<...>() {}`, the new shape is:

```ts
export class CurrentSession extends Effect.Service<CurrentSession>()(
  "@project/api/CurrentSession",
  { sync: () => Option.none<SessionShape>() },
) {}
```

`sync: () => initialValue` produces a synchronous default; the request adapter then provides the real session via `Effect.provideService(CurrentSession, realSession)` at the boundary.

Remove the `lint-disable-file` directive.

- [ ] **Step 4: Migrate `QueueTag` → `Queue`**

Read `packages/jobs/src/queue-layer.ts`. The current shape is `Context.Tag` + `Layer.scoped(QueueTag, ...)`. The new shape:

```ts
export class Queue extends Effect.Service<Queue>()("@project/jobs/Queue", {
  scoped: Effect.gen(function* () {
    // ... existing body of QueueLive's effect ...
  }),
  accessors: true,
}) {}
```

Rename `QueueTag` → `Queue` (the symbol is now both tag and service shape). Update the package's exports (`packages/jobs/package.json` if it lists `QueueTag` explicitly).

Remove the `lint-disable-file` directive.

- [ ] **Step 5: Update `app-layer.ts` + all consumers**

Edit `packages/api/src/runtime/app-layer.ts`:

```ts
import { Layer } from "effect";
import { Db } from "./db-layer.ts";
import { Auth } from "./auth-layer.ts";
import { LoggerLive } from "./logger-layer.ts";

export const AppLayer = Layer.mergeAll(Db.Default, Auth.Default, LoggerLive);
```

For each file in the Step 1 inventory, swap `import { DbLive } from "..."` → `import { Db } from "..."` and use `Db.Default` where `DbLive` was used. Same for `AuthLive` → `Auth.Default`, `CurrentSessionLive` → `CurrentSession.Default`, `QueueLive` / `QueueTag` → `Queue` / `Queue.Default`.

`apps/worker/src/main.ts` and any worker entrypoint:

```ts
// Before
runtime.runFork(program.pipe(Effect.provide(QueueLive)))
// After
runtime.runFork(program.pipe(Effect.provide(Queue.Default)))
```

- [ ] **Step 6: Verify types**

Run: `pnpm exec tsc -b`
Expected: zero errors. If `tsc` complains about `accessors: true` ergonomics, drop it — that's a sugar-only flag.

- [ ] **Step 7: Run unit + integration tests**

Run: `make test-unit`
Expected: PASS. Cross-check by running the worker locally: `pnpm --filter @project/worker dev` for ~10 seconds and verify it boots and logs queue connection.

- [ ] **Step 8: Run full lint**

Run: `make lint`
Expected: PASS. `check-effect-service-form` is now active without the disable directives — confirms the migration is complete.

- [ ] **Step 9: Run BDD tests**

Run: `make test`
Expected: 8/8 in-slice green (matches the pre-change state from `HANDOVER.md`).

- [ ] **Step 10: Commit**

```bash
git add packages/api/src/runtime/db-layer.ts \
        packages/api/src/runtime/auth-layer.ts \
        packages/api/src/runtime/app-layer.ts \
        packages/jobs/src/queue-layer.ts \
        packages/jobs/package.json
# plus every consumer file edited in Step 5 — list them explicitly
git add <consumer files from Step 1 inventory>
git commit -m "refactor: migrate Db/Auth/CurrentSession/QueueTag to Effect.Service form

Replaces Context.Tag + Layer.effect/Layer.scoped with the modern
Effect.Service form across packages/api/src/runtime + packages/jobs.
QueueTag renamed to Queue. Layer composition uses .Default.

Logger is unchanged (Effect's built-in Logger per ADR-0017).
ADR-0015 amendment to follow in Day 4 (queue retrofit commit).

Day 1 of the contract-first rewrite —
docs/superpowers/specs/2026-05-07-effect-contract-first-design.md."
```

---

## Self-Review Checklist (run before handing off)

- [ ] Every spec D1–D8 has a task or is explicitly deferred to a later day. (D1 → Days 2–5; D2 cadence → Days 2–5; D3 frozen contract → Days 2–5 prompt; D4 schema → Day 6 ADR-0014 closure; D5 service form → Tasks 3+7 here; D6 Schedule retry → Day 4 capability #1 retrofit; D7 lint → Tasks 1–5; D8 conventions → Task 6.) ✓
- [ ] Every task ends with a single commit. ✓
- [ ] Every code step has the actual code, not a placeholder. ✓
- [ ] Lint check naming is consistent across plan, package.json exports, root scripts, turbo.json, and Makefile (kebab-case, prefixed `lint:check:`). ✓
- [ ] Logger inconsistency between spec D5 ("Logger to Effect.Service") and reality (already idiomatic) is called out in File Structure note + Task 7 commit message. ✓
- [ ] `make lint` is run after each task (not just at end), so each commit lands green. ✓
- [ ] Pre-existing todo-list domain violations are deferred via narrow escape hatches (`lint-disable-file` directive in Task 1; `.lint-pending` marker in Task 4) that Day 3 retrofit removes. ✓
- [ ] No task references a function/method/type defined in a later task. ✓

---

## Day 1 Done When

- All 7 commits land on `rewrite/contract-first`.
- `make lint` green with all 5 new checks active.
- `make test-unit` and `make test` green (matches pre-change state).
- `git log rewrite/contract-first ^main --oneline | wc -l` reports 7.
- Branch is **not** merged to `main` yet — Day 4 is the merge gate per the spec.

## What Day 2 Picks Up

Day 2 retrofits `packages/api/src/domains/auth/**` to the contract-first split. The Day 1 escape hatches (`lint-disable-file check-explicit-return-types` on todo-list, `.lint-pending` marker) stay in place until their respective retrofit days lift them (Day 3 for todo-list).
