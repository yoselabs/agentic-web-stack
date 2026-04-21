// Diff `.env.example` keys against the Zod schemas in
// `packages/env/src/{server,client}.ts`. Fails on drift in either direction.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Project, SyntaxKind } from "ts-morph";
import { type CheckResult, timeCheck } from "./checks-types.ts";

const DEFAULT_ROOT = process.cwd();
const SERVER_ENV = "packages/env/src/server.ts";
const CLIENT_ENV = "packages/env/src/client.ts";
const ENV_EXAMPLE = ".env.example";

function extractSchemaKeys(tsSource: string, objectKey: string): string[] {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile("schema.ts", tsSource);
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() !== "createEnv") continue;
    const arg = call.getArguments()[0];
    if (!arg || !arg.isKind(SyntaxKind.ObjectLiteralExpression)) continue;
    const prop = arg.getProperty(objectKey);
    if (!prop) continue;
    const init = prop.isKind(SyntaxKind.PropertyAssignment)
      ? prop.getInitializer()
      : undefined;
    if (!init || !init.isKind(SyntaxKind.ObjectLiteralExpression)) continue;
    return init
      .getProperties()
      .filter((p) => p.isKind(SyntaxKind.PropertyAssignment))
      .map((p) => p.getName());
  }
  return [];
}

function extractExampleKeys(src: string): string[] {
  // Match both `KEY=...` and `# KEY=...` (the commented-out form used for
  // optional env vars). Documenting a var as `# KEY=...` counts as present.
  const keys: string[] = [];
  const LINE_RE = /^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/;
  for (const raw of src.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("##") || line.startsWith("# ---")) continue;
    const m = LINE_RE.exec(line);
    if (m?.[1]) keys.push(m[1]);
  }
  return keys;
}

export function runEnvExample(root: string = DEFAULT_ROOT): {
  errors: string[];
} {
  const serverPath = join(root, SERVER_ENV);
  const clientPath = join(root, CLIENT_ENV);
  const examplePath = join(root, ENV_EXAMPLE);
  if (!existsSync(serverPath)) return { errors: [`${SERVER_ENV} not found`] };
  if (!existsSync(examplePath)) return { errors: [`${ENV_EXAMPLE} not found`] };

  const schemaKeys = new Set<string>([
    ...extractSchemaKeys(readFileSync(serverPath, "utf8"), "server"),
    ...(existsSync(clientPath)
      ? extractSchemaKeys(readFileSync(clientPath, "utf8"), "client")
      : []),
  ]);
  const exampleKeys = new Set(
    extractExampleKeys(readFileSync(examplePath, "utf8")),
  );

  const errors: string[] = [];
  for (const k of schemaKeys) {
    if (!exampleKeys.has(k)) {
      errors.push(
        `${ENV_EXAMPLE}  missing "${k}" — present in Zod schema but not documented for contributors.`,
      );
    }
  }
  for (const k of exampleKeys) {
    if (!schemaKeys.has(k)) {
      errors.push(
        `${ENV_EXAMPLE}  stale "${k}" — in example but not in Zod schema. Remove or add to schema.`,
      );
    }
  }
  return { errors };
}

export function checkEnvExample(): Promise<CheckResult> {
  return timeCheck("check-env-example", () => runEnvExample().errors);
}

if (import.meta.main) {
  const result = await checkEnvExample();
  if (!result.ok) {
    for (const e of result.errors) console.error(`[check-env-example] ${e}`);
    process.exit(1);
  }
  console.log("[check-env-example] OK");
}
