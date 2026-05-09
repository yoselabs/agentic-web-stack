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
        "export const list = (id: string) => ({ id });\n",
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
        "export const list = (id: string): Effect.Effect<string, never, never> => Effect.succeed(id);\n",
    });
    const res = runExplicitReturnTypes(root);
    expect(res.errors.length).toBe(0);
  });

  it("flags an exported function whose return is annotated but not Effect.Effect", () => {
    makeWorkspace({
      "packages/api/src/domains/foo/foo-service.ts":
        "export const list = (id: string): string => id;\n",
    });
    const res = runExplicitReturnTypes(root);
    expect(res.errors.length).toBe(1);
    expect(res.errors[0]).toMatch(/must declare Effect\.Effect/);
  });

  it("ignores files outside packages/api/src/domains", () => {
    makeWorkspace({
      "packages/api/src/runtime/foo.ts":
        "export const list = (id: string) => ({ id });\n",
    });
    const res = runExplicitReturnTypes(root);
    expect(res.errors.length).toBe(0);
  });

  it("ignores non-contract/non-service files in the domain folder", () => {
    makeWorkspace({
      "packages/api/src/domains/foo/foo-router.ts":
        "export const list = (id: string) => ({ id });\n",
      "packages/api/src/domains/foo/foo-constants.ts":
        "export const MAX = 100;\n",
    });
    const res = runExplicitReturnTypes(root);
    expect(res.errors.length).toBe(0);
  });

  it("flags class methods on exported classes too", () => {
    makeWorkspace({
      "packages/api/src/domains/foo/foo-service.ts":
        "export class FooService {\n  list(id: string) { return id; }\n}\n",
    });
    const res = runExplicitReturnTypes(root);
    expect(res.errors.length).toBe(1);
    expect(res.errors[0]).toMatch(/list/);
  });
});
