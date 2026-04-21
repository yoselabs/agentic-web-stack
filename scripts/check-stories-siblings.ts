// Every widget component at `apps/web/src/widgets/<name>.tsx` must have a
// sibling `<name>.stories.tsx`. Widgets only — features escalate to widgets
// when they gain a rendered surface (spec §8 decision).

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type CheckResult, timeCheck } from "./checks-types.ts";

const DEFAULT_ROOT = process.cwd();
const WIDGET_ROOT = "apps/web/src/widgets/";

export function runStoriesSiblings(root: string = DEFAULT_ROOT): {
  missing: string[];
} {
  const raw = execSync('git ls-files -z "apps/web/src/widgets/**/*.tsx"', {
    cwd: root,
    maxBuffer: 1024 * 1024 * 16,
  });
  const files = raw
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((p) => p.startsWith(WIDGET_ROOT))
    .filter((p) => p.endsWith(".tsx"))
    .filter((p) => !p.endsWith(".test.tsx"))
    .filter((p) => !p.endsWith(".stories.tsx"))
    .filter((p) => !/\/__tests__\//.test(p))
    .filter((p) => !p.endsWith("/index.tsx"));

  const missing: string[] = [];
  for (const rel of files) {
    const storiesSibling = rel.replace(/\.tsx$/, ".stories.tsx");
    if (!existsSync(join(root, storiesSibling))) {
      missing.push(
        `${rel}  missing sibling ${storiesSibling} — every widget component needs stories.`,
      );
    }
  }
  return { missing };
}

export function checkStoriesSiblings(): Promise<CheckResult> {
  return timeCheck(
    "check-stories-siblings",
    () => runStoriesSiblings().missing,
  );
}

if (import.meta.main) {
  const result = await checkStoriesSiblings();
  if (!result.ok) {
    for (const e of result.errors)
      console.error(`[check-stories-siblings] ${e}`);
    process.exit(1);
  }
  console.log("[check-stories-siblings] OK");
}
