// Unit test for the barrel-import guard. Feeds a synthetic workspace layout
// (subpath-only package + consumer file) into `runNoBarrel` via its root
// parameter and asserts the right file:line is reported.

import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runNoBarrel } from "../check-no-barrel.ts";

let root: string;

function makeWorkspace(opts: { hasRootExport: boolean; consumer: string }) {
  root = mkdtempSync(join(tmpdir(), "check-no-barrel-"));
  mkdirSync(join(root, "packages/env/src"), { recursive: true });
  mkdirSync(join(root, "apps/web/src"), { recursive: true });
  writeFileSync(
    join(root, "packages/env/package.json"),
    JSON.stringify({
      name: "@project/env",
      exports: opts.hasRootExport
        ? { ".": "./src/index.ts", "./server": "./src/server.ts" }
        : { "./server": "./src/server.ts", "./client": "./src/client.ts" },
    }),
  );
  writeFileSync(join(root, "apps/web/src/consumer.ts"), opts.consumer);
}

describe("runNoBarrel", () => {
  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("flags a barrel import of a subpath-only package", () => {
    makeWorkspace({
      hasRootExport: false,
      consumer: 'import { x } from "@project/env";\nconst y = 1;\n',
    });
    const res = runNoBarrel(root);
    expect(res.subpathOnlyPackages).toContain("@project/env");
    expect(res.errors.length).toBe(1);
    expect(res.errors[0]).toMatch(/consumer\.ts:1/);
    expect(res.errors[0]).toMatch(/@project\/env/);
  });

  it("accepts a subpath import", () => {
    makeWorkspace({
      hasRootExport: false,
      consumer: 'import { env } from "@project/env/server";\n',
    });
    const res = runNoBarrel(root);
    expect(res.errors.length).toBe(0);
  });

  it("accepts a bare import when the package exposes a root export", () => {
    makeWorkspace({
      hasRootExport: true,
      consumer: 'import { x } from "@project/env";\n',
    });
    const res = runNoBarrel(root);
    expect(res.errors.length).toBe(0);
  });
});
