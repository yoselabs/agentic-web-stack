// Unit test for the config-driven perspective-boundary guard.

import { afterAll, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPerspectiveBoundary } from "../check-perspective-boundary.ts";

let root: string;

function makeWorkspace(config?: { fields?: string[]; ownerFiles?: string[] }) {
  root = mkdtempSync(join(tmpdir(), "check-persp-"));
  mkdirSync(join(root, "packages/foo/src"), { recursive: true });
  execSync("git init -q", { cwd: root });
  execSync("git config user.email test@example.com", { cwd: root });
  execSync("git config user.name test", { cwd: root });
  if (config) {
    writeFileSync(
      join(root, ".perspective-boundary.json"),
      JSON.stringify(config),
    );
  }
}

describe("runPerspectiveBoundary", () => {
  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("is a no-op when config is absent", () => {
    makeWorkspace();
    writeFileSync(
      join(root, "packages/foo/src/a.ts"),
      "export const y = row.presence;\n",
    );
    execSync("git add -A", { cwd: root });
    const res = runPerspectiveBoundary(root);
    expect(res.errors).toEqual([]);
  });

  it("is a no-op when fields is empty", () => {
    makeWorkspace({ fields: [] });
    writeFileSync(
      join(root, "packages/foo/src/a.ts"),
      "export const y = row.presence;\n",
    );
    execSync("git add -A", { cwd: root });
    const res = runPerspectiveBoundary(root);
    expect(res.errors).toEqual([]);
  });

  it("flags <ident>.<field> access", () => {
    makeWorkspace({ fields: ["presence"] });
    writeFileSync(
      join(root, "packages/foo/src/a.ts"),
      "export const y = row.presence;\n",
    );
    execSync("git add -A", { cwd: root });
    const res = runPerspectiveBoundary(root);
    expect(res.errors.length).toBe(1);
    expect(res.errors[0]).toMatch(/\.presence/);
  });

  it("exempts ownerFiles", () => {
    makeWorkspace({
      fields: ["presence"],
      ownerFiles: ["packages/foo/src/a.ts"],
    });
    writeFileSync(
      join(root, "packages/foo/src/a.ts"),
      "export const y = row.presence;\n",
    );
    execSync("git add -A", { cwd: root });
    const res = runPerspectiveBoundary(root);
    expect(res.errors).toEqual([]);
  });
});
