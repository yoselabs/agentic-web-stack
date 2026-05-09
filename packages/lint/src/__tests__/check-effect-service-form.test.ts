import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEffectServiceForm } from "../check-effect-service-form.ts";

let root: string;

function makeWorkspace(files: Record<string, string>) {
  root = mkdtempSync(join(tmpdir(), "check-effect-service-form-"));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
}

describe("runEffectServiceForm", () => {
  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("flags a Context.Tag call in src code", () => {
    makeWorkspace({
      "packages/api/src/runtime/foo-layer.ts":
        'import { Context } from "effect";\n' +
        'export class Foo extends Context.Tag("Foo")<Foo, FooShape>() {}\n',
    });
    const res = runEffectServiceForm(root);
    expect(res.errors.length).toBe(1);
    expect(res.errors[0]).toMatch(/Context\.Tag/);
  });

  it("flags Context.GenericTag too", () => {
    makeWorkspace({
      "packages/jobs/src/queue.ts":
        'import { Context } from "effect";\n' +
        'export const Q = Context.GenericTag<{}>("Q");\n',
    });
    const res = runEffectServiceForm(root);
    expect(res.errors.length).toBe(1);
    expect(res.errors[0]).toMatch(/Context\.GenericTag/);
  });

  it("accepts Effect.Service form", () => {
    makeWorkspace({
      "packages/api/src/runtime/foo-layer.ts":
        'import { Effect } from "effect";\n' +
        'export class Foo extends Effect.Service<Foo>()("Foo", { effect: Effect.succeed({}) }) {}\n',
    });
    expect(runEffectServiceForm(root).errors.length).toBe(0);
  });

  it("respects file-level disable directive", () => {
    makeWorkspace({
      "packages/api/src/runtime/foo-layer.ts":
        "// lint-disable-file check-effect-service-form — interim during day-1 migration\n" +
        'import { Context } from "effect";\n' +
        'export class Foo extends Context.Tag("Foo")<Foo, {}>() {}\n',
    });
    expect(runEffectServiceForm(root).errors.length).toBe(0);
  });

  it("ignores test files", () => {
    makeWorkspace({
      "packages/api/src/__tests__/foo.test.ts":
        'import { Context } from "effect";\nconst T = Context.GenericTag<{}>("T");\n',
    });
    expect(runEffectServiceForm(root).errors.length).toBe(0);
  });
});
