// Unit test for the duplicate-names guard. Builds a synthetic git repo with
// known duplicate / similar / allowlisted exports and asserts `runDuplicateNames`
// reports the right hard/soft findings.

import { afterEach, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDuplicateNames } from "../check-duplicate-names.ts";

let root: string;

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "check-dup-names-"));
  execSync("git init -q", { cwd: dir });
  execSync("git config user.email test@example.com", { cwd: dir });
  execSync("git config user.name test", { cwd: dir });
  return dir;
}

function writeFile(rel: string, content: string): void {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

function gitAddAll(): void {
  execSync("git add -A", { cwd: root });
}

describe("runDuplicateNames", () => {
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("passes on a clean repo with no duplicates", () => {
    root = initRepo();
    writeFile("packages/a/src/alpha.ts", "export function alpha() {}\n");
    writeFile("packages/b/src/beta.ts", "export function beta() {}\n");
    gitAddAll();
    const res = runDuplicateNames(root);
    expect(res.hard).toEqual([]);
    expect(res.soft).toEqual([]);
  });

  it("hard-fails on exact-name collision across files", () => {
    root = initRepo();
    writeFile("packages/a/src/one.ts", "export function createTodo() {}\n");
    writeFile("packages/b/src/two.ts", "export function createTodo() {}\n");
    gitAddAll();
    const res = runDuplicateNames(root);
    expect(res.hard.length).toBe(1);
    expect(res.hard[0]).toMatch(/EXACT-NAME COLLISION: "createTodo"/);
    expect(res.hard[0]).toMatch(/packages\/a\/src\/one\.ts/);
    expect(res.hard[0]).toMatch(/packages\/b\/src\/two\.ts/);
  });

  it("hard-fails on similar hook names across files (JW >= 0.9)", () => {
    root = initRepo();
    writeFile("packages/a/src/hooks.ts", "export function useTodoList() {}\n");
    writeFile("packages/b/src/hooks.ts", "export function useTodoLists() {}\n");
    gitAddAll();
    const res = runDuplicateNames(root);
    expect(res.hard.length).toBe(1);
    expect(res.hard[0]).toMatch(/SIMILAR-NAME GROUP \(hook/);
    expect(res.hard[0]).toMatch(/useTodoList/);
    expect(res.hard[0]).toMatch(/useTodoLists/);
  });

  it("allowlist suppresses a similar-name group when reason is present", () => {
    root = initRepo();
    writeFile("packages/a/src/hooks.ts", "export function useTodoList() {}\n");
    writeFile("packages/b/src/hooks.ts", "export function useTodoLists() {}\n");
    writeFile(
      ".config/allowlists/duplicate-names.json",
      JSON.stringify({
        allow: [
          {
            names: ["useTodoList", "useTodoLists"],
            reason:
              "parent/child hooks — singular reads one, plural lists many",
          },
        ],
      }),
    );
    gitAddAll();
    const res = runDuplicateNames(root);
    expect(res.hard).toEqual([]);
  });

  it("treats similar type names as advisory (soft), not hard", () => {
    root = initRepo();
    writeFile(
      "packages/a/src/types.ts",
      "export type InviteVars = { email: string };\n",
    );
    writeFile(
      "packages/b/src/types.ts",
      "export type InviteVar = { email: string };\n",
    );
    gitAddAll();
    const res = runDuplicateNames(root);
    expect(res.hard).toEqual([]);
    expect(res.soft.length).toBe(1);
    expect(res.soft[0]).toMatch(/SIMILAR-NAME GROUP \(type/);
  });

  it("ignores same-file clusters (paired patterns like publishX/publishY)", () => {
    root = initRepo();
    writeFile(
      "packages/a/src/publishers.ts",
      [
        "export function publishCreated() {}",
        "export function publishUpdated() {}",
        "",
      ].join("\n"),
    );
    gitAddAll();
    const res = runDuplicateNames(root);
    expect(res.hard).toEqual([]);
  });

  it("detects `export default function` collisions across files", () => {
    root = initRepo();
    writeFile("packages/a/src/page.ts", "export default function Page() {}\n");
    writeFile("packages/b/src/page.ts", "export default function Page() {}\n");
    gitAddAll();
    const res = runDuplicateNames(root);
    expect(res.hard.length).toBe(1);
    expect(res.hard[0]).toMatch(/EXACT-NAME COLLISION: "Page"/);
  });

  it("throws if allowlist entry lacks a reason of >= 10 chars", () => {
    root = initRepo();
    writeFile("packages/a/src/one.ts", "export function foo() {}\n");
    writeFile(
      ".config/allowlists/duplicate-names.json",
      JSON.stringify({ allow: [{ names: ["foo", "bar"], reason: "short" }] }),
    );
    gitAddAll();
    expect(() => runDuplicateNames(root)).toThrow(/reason/);
  });
});
