import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runContractBeforeImpl } from "../check-contract-before-impl.ts";

const roots: string[] = [];

function makeWorkspace(files: string[]) {
  const root = mkdtempSync(join(tmpdir(), "check-contract-before-impl-"));
  roots.push(root);
  for (const rel of files) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, "// stub\n");
  }
  return root;
}

describe("runContractBeforeImpl", () => {
  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  it("accepts a complete domain", () => {
    const root = makeWorkspace([
      "packages/api/src/domains/foo/foo-contract.ts",
      "packages/api/src/domains/foo/foo-schema.ts",
      "packages/api/src/domains/foo/foo-errors.ts",
      "packages/api/src/domains/foo/foo-service.ts",
    ]);
    expect(runContractBeforeImpl(root).errors.length).toBe(0);
  });

  it("flags a service without contract", () => {
    const root = makeWorkspace([
      "packages/api/src/domains/foo/foo-schema.ts",
      "packages/api/src/domains/foo/foo-errors.ts",
      "packages/api/src/domains/foo/foo-service.ts",
    ]);
    const r = runContractBeforeImpl(root);
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]).toMatch(/foo-contract\.ts/);
  });

  it("flags a service without schema", () => {
    const root = makeWorkspace([
      "packages/api/src/domains/foo/foo-contract.ts",
      "packages/api/src/domains/foo/foo-errors.ts",
      "packages/api/src/domains/foo/foo-service.ts",
    ]);
    expect(runContractBeforeImpl(root).errors.length).toBe(1);
  });

  it("flags a service without errors", () => {
    const root = makeWorkspace([
      "packages/api/src/domains/foo/foo-contract.ts",
      "packages/api/src/domains/foo/foo-schema.ts",
      "packages/api/src/domains/foo/foo-service.ts",
    ]);
    expect(runContractBeforeImpl(root).errors.length).toBe(1);
  });

  it("accepts a contract-only domain (post-#2 pre-#4 state)", () => {
    const root = makeWorkspace([
      "packages/api/src/domains/foo/foo-contract.ts",
      "packages/api/src/domains/foo/foo-schema.ts",
      "packages/api/src/domains/foo/foo-errors.ts",
    ]);
    expect(runContractBeforeImpl(root).errors.length).toBe(0);
  });

  it("skips a domain marked .lint-pending", () => {
    const root = makeWorkspace([
      "packages/api/src/domains/foo/foo-service.ts",
      "packages/api/src/domains/foo/.lint-pending",
    ]);
    expect(runContractBeforeImpl(root).errors.length).toBe(0);
  });
});
