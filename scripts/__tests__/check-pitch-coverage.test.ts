// Unit test for pitch ↔ @ui:<X> bidirectional coverage.

import { afterAll, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPitchCoverage } from "../check-pitch-coverage.ts";

let root: string;

function makeWorkspace() {
  root = mkdtempSync(join(tmpdir(), "check-pitch-"));
  mkdirSync(join(root, "docs/requirements/pitches/p1"), { recursive: true });
  mkdirSync(join(root, "e2e/features/x"), { recursive: true });
  execSync("git init -q", { cwd: root });
  execSync("git config user.email test@example.com", { cwd: root });
  execSync("git config user.name test", { cwd: root });
}

function writePitch(path: string, body: string) {
  writeFileSync(join(root, path), body);
}
function writeFeature(path: string, body: string) {
  writeFileSync(join(root, path), body);
}
function gitAdd() {
  execSync("git add -A", { cwd: root });
}

describe("runPitchCoverage", () => {
  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("is inert when pitches directory is absent", () => {
    root = mkdtempSync(join(tmpdir(), "check-pitch-empty-"));
    execSync("git init -q", { cwd: root });
    execSync("git config user.email test@example.com", { cwd: root });
    execSync("git config user.name test", { cwd: root });
    const res = runPitchCoverage(root);
    expect(res.errors).toEqual([]);
  });

  it("flags shipped ui_elements with no @ui tag", () => {
    makeWorkspace();
    writePitch(
      "docs/requirements/pitches/p1/pitch.md",
      "---\nstatus: shipped\nui_elements:\n  - NavDrawer\n  - LoginButton\n---\n",
    );
    writeFeature(
      "e2e/features/x/x.feature",
      "Feature: X\n\n  @ui:LoginButton\n  Scenario: S\n    Given x\n",
    );
    gitAdd();
    const res = runPitchCoverage(root);
    expect(res.errors.some((e) => e.includes("NavDrawer"))).toBe(true);
    expect(res.errors.some((e) => e.includes("LoginButton"))).toBe(false);
  });

  it("flags @ui tag that does not resolve", () => {
    makeWorkspace();
    writePitch(
      "docs/requirements/pitches/p1/pitch.md",
      "---\nstatus: shipped\nui_elements: [A]\n---\n",
    );
    writeFeature(
      "e2e/features/x/x.feature",
      "Feature: X\n\n  @ui:A @ui:B\n  Scenario: S\n    Given x\n",
    );
    gitAdd();
    const res = runPitchCoverage(root);
    expect(res.errors.some((e) => e.includes("@ui:B"))).toBe(true);
  });
});
