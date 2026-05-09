// Lint: every <name>-service.ts in packages/api/src/domains/<name>/ must have
// sibling <name>-contract.ts, <name>-schema.ts, <name>-errors.ts.
//
// Why: enforces the six-file capability layout from spec D1. The frozen-
// contract AI handoff (D3) is meaningless if the contract files don't
// exist when the service is committed.
//
// Escape hatch: place a `.lint-pending` file in a domain directory to skip
// that domain (used during incremental retrofits, e.g. Day 3 todo-list).

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

export function runContractBeforeImpl(root: string = DEFAULT_ROOT): {
  errors: string[];
} {
  const errors: string[] = [];
  for (const dir of domainDirs(root)) {
    if (existsSync(join(dir, ".lint-pending"))) continue;
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
  return timeCheck(
    "check-contract-before-impl",
    () => runContractBeforeImpl().errors,
  );
}

if (import.meta.main) {
  const r = await checkContractBeforeImpl();
  if (!r.ok) {
    for (const e of r.errors)
      console.error(`[check-contract-before-impl] ${e}`);
    process.exit(1);
  }
  console.log("[check-contract-before-impl] OK");
}
