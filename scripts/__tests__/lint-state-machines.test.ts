// Unit test for Gherkin state-machine completeness check.

import { afterAll, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStateMachines } from "../lint-state-machines.ts";

let root: string;

function makeWorkspace() {
  root = mkdtempSync(join(tmpdir(), "lint-sm-"));
  mkdirSync(join(root, "e2e/features"), { recursive: true });
  execSync("git init -q", { cwd: root });
  execSync("git config user.email test@example.com", { cwd: root });
  execSync("git config user.name test", { cwd: root });
}

function addFeature(name: string, body: string) {
  writeFileSync(join(root, `e2e/features/${name}.feature`), body);
  execSync("git add -A", { cwd: root });
}

describe("runStateMachines", () => {
  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("passes when every listed state has a tagged scenario", () => {
    makeWorkspace();
    addFeature(
      "ok",
      `@state-machine(pending,active,done)\nFeature: F\n\n  @state:pending\n  Scenario: P\n    Given x\n\n  @state:active\n  Scenario: A\n    Given x\n\n  @state:done\n  Scenario: D\n    Given x\n`,
    );
    const res = runStateMachines(root);
    expect(res.errors).toEqual([]);
  });

  it("fails when a state is uncovered", () => {
    makeWorkspace();
    addFeature(
      "missing",
      `@state-machine(pending,active)\nFeature: F\n\n  @state:pending\n  Scenario: P\n    Given x\n`,
    );
    const res = runStateMachines(root);
    expect(res.errors.some((e) => e.includes("@state:active"))).toBe(true);
  });

  it("ignores features without @state-machine tag", () => {
    makeWorkspace();
    addFeature("plain", `Feature: F\n\n  Scenario: S\n    Given x\n`);
    const res = runStateMachines(root);
    expect(res.errors).toEqual([]);
  });
});
