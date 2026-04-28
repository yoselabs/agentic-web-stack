// Universal barrel-import guard for @project/* workspace packages.
//
// Rule: a `@project/<pkg>` bare import is forbidden UNLESS that package's
// own `package.json` declares a "." export. The package's exports map is
// the source of truth for "does this package expose a barrel?" — so this
// check is self-maintaining. Add a new package with subpath-only exports
// and it's automatically covered; add a new package with a "." export
// and barrel imports of it are automatically allowed.
//
// Runs in `make lint`. Complements:
//   - Biome's native `performance/noBarrelFile` (blocks *authoring* a
//     barrel file; we disable it per-file for packages that legitimately
//     need one, e.g. packages/db/src/index.ts).
//   - Biome's `style/noRestrictedImports` override for apps/web/** (richer
//     per-package error messages; narrower scope than this check).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { type CheckResult, timeCheck } from "./checks-types.ts";

const DEFAULT_ROOT = process.cwd();
const SCAN_DIRS = ["apps", "packages", "e2e", "scripts"];
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs"]);
const IGNORE_DIRS = new Set([
  "node_modules",
  "dist",
  ".output",
  ".vinxi",
  "generated",
  ".features-gen",
  ".tanstack",
  "test-results",
]);

// Matches `from "@project/pkg"` or `import "@project/pkg"` with no trailing
// subpath. Captures the package name for allowlist comparison.
const BARREL_IMPORT_RE =
  /\b(?:from|import)\s+["'](@project\/[a-z][a-z0-9-]*)["']/g;

/**
 * Run the barrel-import scan rooted at `root`. Exposed as a parameter for
 * unit tests (feed in a temp fixture); the production call uses cwd.
 */
export function runNoBarrel(root: string = DEFAULT_ROOT): {
  errors: string[];
  subpathOnlyPackages: string[];
} {
  const packagesDir = join(root, "packages");
  const subpathOnlyPackages = new Set<string>();
  const packageOwnSourceDirs = new Map<string, string>();
  let pkgEntries: string[] = [];
  try {
    pkgEntries = readdirSync(packagesDir);
  } catch {
    return { errors: [], subpathOnlyPackages: [] };
  }
  for (const name of pkgEntries) {
    const pkgJsonPath = join(packagesDir, name, "package.json");
    let pkg: { name?: string; exports?: Record<string, unknown> };
    try {
      pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
    } catch {
      continue;
    }
    if (!pkg.name || !pkg.exports) continue;
    const hasRootExport = Object.hasOwn(pkg.exports, ".");
    if (!hasRootExport) {
      subpathOnlyPackages.add(pkg.name);
      packageOwnSourceDirs.set(pkg.name, join(packagesDir, name));
    }
  }

  const errors: string[] = [];
  if (subpathOnlyPackages.size === 0) {
    return { errors, subpathOnlyPackages: [] };
  }

  function scanFile(file: string): void {
    const rel = relative(root, file);
    if (rel.startsWith("packages/lint/src/grit-plugins/")) return;
    if (rel.startsWith("packages/lint/src/__tests__/")) return;
    if (rel === "packages/lint/src/check-no-barrel.ts") return;

    const src = readFileSync(file, "utf8");
    BARREL_IMPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: canonical regex loop
    while ((m = BARREL_IMPORT_RE.exec(src))) {
      const pkg = m[1];
      if (!pkg || !subpathOnlyPackages.has(pkg)) continue;
      const ownDir = packageOwnSourceDirs.get(pkg);
      if (ownDir && file.startsWith(`${ownDir}/`)) continue;
      const upTo = src.slice(0, m.index);
      const line = upTo.split("\n").length;
      errors.push(
        `${rel}:${line}  barrel import of "${pkg}" is forbidden — this package exposes subpath-only exports. Use an explicit subpath (e.g. "${pkg}/<file>").`,
      );
    }
  }

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      if (IGNORE_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (SCAN_EXTENSIONS.has(extname(entry))) {
        scanFile(full);
      }
    }
  }

  for (const d of SCAN_DIRS) {
    const full = join(root, d);
    try {
      if (statSync(full).isDirectory()) walk(full);
    } catch {
      // dir missing is fine
    }
  }

  return { errors, subpathOnlyPackages: [...subpathOnlyPackages].sort() };
}

export function checkNoBarrel(): Promise<CheckResult> {
  return timeCheck("check-no-barrel", () => {
    const { errors, subpathOnlyPackages } = runNoBarrel();
    if (errors.length) {
      errors.push(
        `Subpath-only packages in this repo: ${subpathOnlyPackages.join(", ")}`,
      );
    }
    return errors;
  });
}

if (import.meta.main) {
  const result = await checkNoBarrel();
  if (!result.ok) {
    for (const e of result.errors) console.error(`[check-no-barrel] ${e}`);
    process.exit(1);
  }
  console.log("[check-no-barrel] OK");
}
