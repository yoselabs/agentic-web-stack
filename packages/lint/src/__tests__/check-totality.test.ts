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
