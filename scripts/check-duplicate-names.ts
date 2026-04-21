// Hard-block duplicate / near-duplicate exported names.
//
// Why: AI agents regularly re-implement a function/component under a slightly
// different path instead of finding + reusing the existing one. This check
// forces the collision to be noticed *before* commit, so the agent can either
// rename + reason about the difference, or rewire the call sites to reuse.
//
// Policy:
//   HARD FAIL:
//     - Exact-name collision (same kind, different files).
//     - Similar name (Jaro-Winkler >= SIMILARITY_THRESHOLD), same kind, for
//       functions / components / hooks. Types are advisory-only (DTOs and
//       input/output pairs legitimately cluster).
//
//   ADVISORY (printed, not failing):
//     - Similar type / interface clusters.
//
//   ESCAPE HATCH:
//     - `.config/allowlists/duplicate-names.json` at repo root. Shape:
//         { "allow": [ { "names": ["A","B"], "reason": "why this is OK" } ] }
//       Every group in `allow` must have a `reason` string (enforced).
//
// This check runs on pure regex extraction (fast). For richer signature-level
// reporting, see `scripts/find-similar.ts` (ts-morph, advisory `make similar`).

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type CheckResult, timeCheck } from "./checks-types.ts";

const DEFAULT_ROOT = process.cwd();
const SCAN_ROOT_PREFIXES = ["apps/", "packages/"];

// Paths where framework-mandated conventions produce legitimate repeat-exports.
// TanStack Router: every file under apps/web/src/routes/ exports `Route`.
const IGNORE_PATH_PATTERNS: RegExp[] = [/apps\/web\/src\/routes\//];
const SIMILARITY_THRESHOLD = 0.9;
const JW_MIN_LEN = 4;

type Kind = "function" | "component" | "hook" | "type" | "class";

type Item = {
  name: string;
  kind: Kind;
  path: string;
  line: number;
};

type AllowlistEntry = { names: string[]; reason: string };

function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const matchDistance = Math.floor(Math.max(a.length, b.length) / 2) - 1;
  const aMatches = new Array<boolean>(a.length).fill(false);
  const bMatches = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const transpositions = t / 2;
  const jaro =
    (matches / a.length +
      matches / b.length +
      (matches - transpositions) / matches) /
    3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

function classifyName(name: string): Kind {
  if (name.length > 3 && name.startsWith("use") && /[A-Z]/.test(name[3] ?? ""))
    return "hook";
  if (/^[A-Z]/.test(name)) return "component"; // tentative; upgraded to type below
  return "function";
}

// Regex-extract exported identifiers from one source file.
// Doesn't distinguish component-vs-function semantically (JSX detection
// would need AST); treats capitalized exports as `component` unless context
// marks them as `type`/`interface`/`class`.
function extractItems(path: string, src: string): Item[] {
  const out: Item[] = [];
  const pushMatch = (re: RegExp, kindFor: (name: string) => Kind): void => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: canonical regex loop
    while ((m = re.exec(src))) {
      const name = m[1];
      if (!name) continue;
      const upTo = src.slice(0, m.index);
      const line = upTo.split("\n").length;
      out.push({ name, kind: kindFor(name), path, line });
    }
  };
  pushMatch(
    /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    classifyName,
  );
  pushMatch(
    /\bexport\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    classifyName,
  );
  pushMatch(/\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=/g, classifyName);
  pushMatch(/\bexport\s+type\s+([A-Za-z_$][\w$]*)/g, () => "type");
  pushMatch(/\bexport\s+interface\s+([A-Za-z_$][\w$]*)/g, () => "type");
  pushMatch(/\bexport\s+class\s+([A-Za-z_$][\w$]*)/g, () => "class");
  pushMatch(/\bexport\s+default\s+class\s+([A-Za-z_$][\w$]*)/g, () => "class");
  return out;
}

// List .ts/.tsx files tracked by git. `git ls-files` honors .gitignore
// automatically — generated output, dist, .output, etc. are excluded
// without maintaining a parallel ignore list here.
function listTrackedSourceFiles(root: string): string[] {
  const raw = execSync('git ls-files -z "*.ts" "*.tsx"', {
    cwd: root,
    maxBuffer: 1024 * 1024 * 32,
  });
  return raw
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((p) => SCAN_ROOT_PREFIXES.some((pre) => p.startsWith(pre)))
    .filter((p) => !p.endsWith(".test.ts") && !p.endsWith(".test.tsx"))
    .filter((p) => !p.endsWith(".gen.ts") && !p.endsWith(".gen.tsx"))
    .filter((p) => !/\/__tests__\//.test(p))
    .filter((p) => !IGNORE_PATH_PATTERNS.some((re) => re.test(p)));
}

function loadAllFiles(root: string): Item[] {
  const acc: Item[] = [];
  for (const rel of listTrackedSourceFiles(root)) {
    const full = join(root, rel);
    const src = readFileSync(full, "utf8");
    for (const item of extractItems(rel, src)) {
      acc.push(item);
    }
  }
  return acc;
}

function loadAllowlist(root: string): Set<string> {
  const file = join(root, ".config/allowlists/duplicate-names.json");
  if (!existsSync(file)) return new Set();
  const raw = JSON.parse(readFileSync(file, "utf8")) as {
    allow?: AllowlistEntry[];
  };
  const allowed = new Set<string>();
  for (const entry of raw.allow ?? []) {
    if (!entry.reason || entry.reason.trim().length < 10) {
      throw new Error(
        `.config/allowlists/duplicate-names.json: every entry needs a \`reason\` of >= 10 chars. Offending entry: ${JSON.stringify(entry)}`,
      );
    }
    // Canonicalize as sorted-name set → one key per group.
    const key = [...entry.names].sort().join("|");
    allowed.add(key);
  }
  return allowed;
}

function groupKey(names: string[]): string {
  return [...new Set(names)].sort().join("|");
}

export function runDuplicateNames(root: string = DEFAULT_ROOT): {
  hard: string[];
  soft: string[];
} {
  const allItems = loadAllFiles(root);
  const allowlist = loadAllowlist(root);

  // 1. Exact-name collisions (same kind, >=2 distinct files).
  const byExactKey = new Map<string, Item[]>();
  for (const item of allItems) {
    const key = `${item.kind}::${item.name}`;
    const bucket = byExactKey.get(key) ?? [];
    bucket.push(item);
    byExactKey.set(key, bucket);
  }

  const hard: string[] = [];
  const soft: string[] = [];

  for (const [key, items] of byExactKey) {
    if (items.length < 2) continue;
    const distinctFiles = new Set(items.map((i) => i.path));
    if (distinctFiles.size < 2) continue; // same file, not a collision
    const name = key.split("::")[1] ?? "";
    if (allowlist.has(groupKey([name]))) continue;
    hard.push(
      `EXACT-NAME COLLISION: "${name}" (${items[0]?.kind}) declared in ${distinctFiles.size} files:\n    ${items.map((i) => `${i.path}:${i.line}`).join("\n    ")}\n  FIX: either rename one, consolidate the implementations, or add to .config/allowlists/duplicate-names.json with a reason.`,
    );
  }

  // 2. Similar-name collisions (JW >= threshold, same kind, only for
  //    function/component/hook — types are advisory).
  const uniqueByKindName = new Map<string, Item>();
  for (const item of allItems) {
    const key = `${item.kind}::${item.name}`;
    if (!uniqueByKindName.has(key)) uniqueByKindName.set(key, item);
  }
  const canonical = [...uniqueByKindName.values()];

  const seenGroups = new Set<string>();
  for (let i = 0; i < canonical.length; i++) {
    const a = canonical[i];
    if (!a || a.name.length < JW_MIN_LEN) continue;
    const group: Item[] = [a];
    for (let j = i + 1; j < canonical.length; j++) {
      const b = canonical[j];
      if (!b || b.kind !== a.kind) continue;
      if (a.name === b.name) continue; // exact-match already covered above
      if (b.name.length < JW_MIN_LEN) continue;
      const score = jaroWinkler(a.name, b.name);
      if (score >= SIMILARITY_THRESHOLD) group.push(b);
    }
    if (group.length < 2) continue;
    // Same-file clusters are almost always legitimate paired patterns
    // (onCreate/onDelete, publishX/publishY). Only flag cross-file drift.
    const distinctFiles = new Set(group.map((g) => g.path));
    if (distinctFiles.size < 2) continue;
    const gk = groupKey(group.map((g) => g.name));
    if (seenGroups.has(gk)) continue;
    seenGroups.add(gk);
    if (allowlist.has(gk)) continue;
    const message = `SIMILAR-NAME GROUP (${a.kind}, JW >= ${SIMILARITY_THRESHOLD}):\n    ${group.map((g) => `${g.name}  ${g.path}:${g.line}`).join("\n    ")}\n  FIX: rename to distinguish intent, or add to .config/allowlists/duplicate-names.json with a reason.`;
    if (a.kind === "type" || a.kind === "class") {
      soft.push(message);
    } else {
      hard.push(message);
    }
  }

  return { hard, soft };
}

export function checkDuplicateNames(): Promise<CheckResult> {
  return timeCheck("check-duplicate-names", () => {
    const { hard, soft } = runDuplicateNames();
    // Print soft findings for awareness even on success.
    for (const s of soft) console.log(`[advisory] ${s}`);
    return hard;
  });
}

if (import.meta.main) {
  const result = await checkDuplicateNames();
  if (!result.ok) {
    console.error("");
    for (const e of result.errors) {
      console.error(`[check-duplicate-names] ${e}\n`);
    }
    process.exit(1);
  }
  console.log("[check-duplicate-names] OK");
}
