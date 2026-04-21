// Unit test for the scoped-landmark-queries guard.

import { afterAll, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScopedLandmarks } from "../check-scoped-landmarks.ts";

let root: string;

function makeWorkspace() {
  root = mkdtempSync(join(tmpdir(), "check-landmarks-"));
  mkdirSync(join(root, "e2e/steps/foo"), { recursive: true });
  execSync("git init -q", { cwd: root });
  execSync("git config user.email test@example.com", { cwd: root });
  execSync("git config user.name test", { cwd: root });
}

function writeStep(path: string, body: string) {
  writeFileSync(join(root, path), body);
  execSync("git add -A", { cwd: root });
}

describe("runScopedLandmarks", () => {
  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("flags bare page.getByTestId calls", () => {
    makeWorkspace();
    writeStep("e2e/steps/foo/foo.ts", "page.getByTestId('x');\n");
    const res = runScopedLandmarks(root);
    expect(res.errors.length).toBe(1);
    expect(res.errors[0]).toMatch(/bare `page\.getBy\*/);
  });

  it("accepts scoped calls like frame.getByTestId", () => {
    makeWorkspace();
    writeStep("e2e/steps/foo/foo.ts", "dialog.getByTestId('x');\n");
    const res = runScopedLandmarks(root);
    expect(res.errors).toEqual([]);
  });

  it("respects placement-agnostic comment on prior line", () => {
    makeWorkspace();
    writeStep(
      "e2e/steps/foo/foo.ts",
      "// placement-agnostic: global toast lives outside any landmark\npage.getByText('ok');\n",
    );
    const res = runScopedLandmarks(root);
    expect(res.errors).toEqual([]);
  });

  it("respects allowlist entry", () => {
    makeWorkspace();
    writeStep("e2e/steps/foo/foo.ts", "page.getByTestId('x');\n");
    mkdirSync(join(root, ".config/allowlists"), { recursive: true });
    writeFileSync(
      join(root, ".config/allowlists/scoped-landmarks.json"),
      JSON.stringify({
        allow: [
          {
            path: "e2e/steps/foo/foo.ts",
            reason: "pre-existing step file grandfathered in",
          },
        ],
      }),
    );
    execSync("git add -A", { cwd: root });
    const res = runScopedLandmarks(root);
    expect(res.errors).toEqual([]);
  });
});
