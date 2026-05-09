import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runExplicitReturnTypes } from "../check-explicit-return-types.ts";

const roots: string[] = [];

function makeWorkspace(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "check-explicit-return-types-"));
  roots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

describe("runExplicitReturnTypes", () => {
  afterAll(() => {
    for (const r of roots) {
      rmSync(r, { recursive: true, force: true });
    }
  });

  it("flags an exported function with inferred return", () => {
    const root = makeWorkspace({
      "packages/api/src/domains/foo/foo-service.ts":
        "export const list = (id: string) => ({ id });\n",
    });
    const res = runExplicitReturnTypes(root);
    expect(res.errors.length).toBe(1);
    expect(res.errors[0]).toMatch(/foo-service\.ts/);
    expect(res.errors[0]).toMatch(/list/);
  });

  it("accepts an exported function with Effect.Effect return", () => {
    const root = makeWorkspace({
      "packages/api/src/domains/foo/foo-contract.ts":
        'import { Effect } from "effect";\n' +
        "export const list = (id: string): Effect.Effect<string, never, never> => Effect.succeed(id);\n",
    });
    const res = runExplicitReturnTypes(root);
    expect(res.errors.length).toBe(0);
  });

  it("flags an exported function whose return is annotated but not Effect.Effect", () => {
    const root = makeWorkspace({
      "packages/api/src/domains/foo/foo-service.ts":
        "export const list = (id: string): string => id;\n",
    });
    const res = runExplicitReturnTypes(root);
    expect(res.errors.length).toBe(1);
    expect(res.errors[0]).toMatch(/must declare Effect\.Effect/);
  });

  it("ignores files outside packages/api/src/domains", () => {
    const root = makeWorkspace({
      "packages/api/src/runtime/foo.ts":
        "export const list = (id: string) => ({ id });\n",
    });
    const res = runExplicitReturnTypes(root);
    expect(res.errors.length).toBe(0);
  });

  it("ignores non-contract/non-service files in the domain folder", () => {
    const root = makeWorkspace({
      "packages/api/src/domains/foo/foo-router.ts":
        "export const list = (id: string) => ({ id });\n",
      "packages/api/src/domains/foo/foo-constants.ts":
        "export const MAX = 100;\n",
    });
    const res = runExplicitReturnTypes(root);
    expect(res.errors.length).toBe(0);
  });

  it("flags class methods on exported classes too", () => {
    const root = makeWorkspace({
      "packages/api/src/domains/foo/foo-service.ts":
        "export class FooService {\n  list(id: string) { return id; }\n}\n",
    });
    const res = runExplicitReturnTypes(root);
    expect(res.errors.length).toBe(1);
    expect(res.errors[0]).toMatch(/list/);
  });
});
