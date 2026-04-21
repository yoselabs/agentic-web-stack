// Unit test for the ADR bidirectional cite check.

import { afterAll, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAdrs } from "../check-adrs.ts";

let root: string;

function makeWorkspace() {
  root = mkdtempSync(join(tmpdir(), "check-adrs-"));
  mkdirSync(join(root, "docs/adrs"), { recursive: true });
  mkdirSync(join(root, "packages/foo/src"), { recursive: true });
  execSync("git init -q", { cwd: root });
  execSync("git config user.email test@example.com", { cwd: root });
  execSync("git config user.name test", { cwd: root });
}

function gitAddAll() {
  execSync("git add -A", { cwd: root });
}

describe("runAdrs", () => {
  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("flags accepted ADR without verified_by", () => {
    makeWorkspace();
    writeFileSync(
      join(root, "docs/adrs/0001-foo.md"),
      "---\ntitle: foo\nstatus: accepted\n---\n\n# ADR\n",
    );
    gitAddAll();
    const res = runAdrs(root);
    expect(res.errors.some((e) => e.includes("missing `verified_by"))).toBe(
      true,
    );
  });

  it("accepts ADR whose verified_by file cites it", () => {
    makeWorkspace();
    writeFileSync(
      join(root, "docs/adrs/0001-foo.md"),
      "---\ntitle: foo\nstatus: accepted\nverified_by:\n  - packages/foo/src/foo.ts\n---\n",
    );
    writeFileSync(
      join(root, "packages/foo/src/foo.ts"),
      "// See ADR-001 for rationale.\nexport const x = 1;\n",
    );
    gitAddAll();
    const res = runAdrs(root);
    expect(res.errors).toEqual([]);
  });

  it("flags dangling @adr cite with no matching ADR file", () => {
    makeWorkspace();
    writeFileSync(
      join(root, "packages/foo/src/foo.ts"),
      "// @adr 0042 no such adr\n",
    );
    gitAddAll();
    const res = runAdrs(root);
    expect(res.errors.some((e) => e.includes("ADR-0042"))).toBe(true);
  });

  it("flags non-existent verified_by file", () => {
    makeWorkspace();
    writeFileSync(
      join(root, "docs/adrs/0001-foo.md"),
      "---\ntitle: foo\nstatus: accepted\nverified_by:\n  - packages/missing.ts\n---\n",
    );
    gitAddAll();
    const res = runAdrs(root);
    expect(res.errors.some((e) => e.includes("does not exist"))).toBe(true);
  });
});
