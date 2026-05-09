import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTaggedErrors } from "../check-tagged-errors.ts";

const roots: string[] = [];

function makeWorkspace(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "check-tagged-errors-"));
  roots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

describe("runTaggedErrors", () => {
  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  it("accepts a properly tagged error class", () => {
    const root = makeWorkspace({
      "packages/api/src/domains/foo/foo-errors.ts":
        'import { Data } from "effect";\n' +
        'export class FooError extends Data.TaggedError("FooError")<{ readonly cause: unknown }> {}\n',
    });
    expect(runTaggedErrors(root).errors.length).toBe(0);
  });

  it("flags a class that does not extend Data.TaggedError", () => {
    const root = makeWorkspace({
      "packages/api/src/domains/foo/foo-errors.ts":
        "export class FooError extends Error {}\n",
    });
    const res = runTaggedErrors(root);
    expect(res.errors.length).toBe(1);
    expect(res.errors[0]).toMatch(/must extend Data\.TaggedError/);
  });

  it("flags a tag-name / class-name mismatch", () => {
    const root = makeWorkspace({
      "packages/api/src/domains/foo/foo-errors.ts":
        'import { Data } from "effect";\n' +
        'export class FooError extends Data.TaggedError("WrongTag")<{}> {}\n',
    });
    const res = runTaggedErrors(root);
    expect(res.errors.length).toBe(1);
    expect(res.errors[0]).toMatch(
      /tag "WrongTag" does not match class name FooError/,
    );
  });

  it("ignores non-errors files", () => {
    const root = makeWorkspace({
      "packages/api/src/domains/foo/foo-service.ts": "export class Helper {}\n",
    });
    expect(runTaggedErrors(root).errors.length).toBe(0);
  });
});
