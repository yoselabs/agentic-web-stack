// Rejects the createTRPCReact style. The repo uses
// createTRPCOptionsProxy from @trpc/tanstack-react-query.
//
// Forbidden patterns (in apps/web/src):
//   - import of createTRPCReact
//   - trpc.<path>.useMutation( / useQuery( / useSubscription(
//
// Canonical pattern:
//   const { trpc } = Route.useRouteContext();
//   useMutation(trpc.x.mutationOptions({...}))
//   useQuery(trpc.x.queryOptions({...}))
//   useSubscription(trpc.x.subscriptionOptions({...}))
//
// Exits 1 on any match; prints file:line for every hit.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { type CheckResult, timeCheck } from "./checks-types.ts";

type Rule = { regex: RegExp; message: string };

const rules: Rule[] = [
  {
    regex: /createTRPCReact/g,
    message:
      "Use createTRPCOptionsProxy from @trpc/tanstack-react-query. See apps/web/CLAUDE.md.",
  },
  {
    regex:
      /trpc(?:\.[A-Za-z_][A-Za-z0-9_]*)+\.(?:useMutation|useQuery|useSubscription)\(/g,
    message:
      "Use useMutation(trpc.x.mutationOptions(...)) / useQuery(trpc.x.queryOptions(...)) / useSubscription(trpc.x.subscriptionOptions(...)).",
  },
];

const SCAN_EXTENSIONS = new Set([".ts", ".tsx"]);
const IGNORE_DIRS = new Set(["node_modules", "dist", ".output", ".tanstack"]);

export function checkTrpcPatterns(): Promise<CheckResult> {
  return timeCheck("check-trpc-patterns", () => {
    const root = process.cwd();
    const scanRoot = join(root, "apps/web/src");
    const errors: string[] = [];

    function walk(dir: string): void {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (IGNORE_DIRS.has(entry)) continue;
        const full = join(dir, entry);
        let st: ReturnType<typeof statSync>;
        try {
          st = statSync(full);
        } catch {
          continue;
        }
        if (st.isDirectory()) walk(full);
        else if (SCAN_EXTENSIONS.has(extname(entry))) scanFile(full);
      }
    }

    function scanFile(file: string): void {
      const src = readFileSync(file, "utf8");
      const rel = relative(root, file);
      for (const rule of rules) {
        rule.regex.lastIndex = 0;
        let m: RegExpExecArray | null;
        // biome-ignore lint/suspicious/noAssignInExpressions: canonical regex loop
        while ((m = rule.regex.exec(src))) {
          const line = src.slice(0, m.index).split("\n").length;
          errors.push(`${rel}:${line}: ${m[0]} — ${rule.message}`);
        }
      }
    }

    walk(scanRoot);
    return errors;
  });
}

if (import.meta.main) {
  const result = await checkTrpcPatterns();
  if (!result.ok) {
    for (const e of result.errors) console.error(`[check-trpc-patterns] ${e}`);
    process.exit(1);
  }
  console.log("[check-trpc-patterns] OK");
}
