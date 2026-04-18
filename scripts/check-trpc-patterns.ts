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

import { execSync } from "node:child_process";

type Rule = { pattern: string; message: string };

const rules: Rule[] = [
  {
    pattern: "createTRPCReact",
    message:
      "Use createTRPCOptionsProxy from @trpc/tanstack-react-query. See apps/web/CLAUDE.md.",
  },
  {
    pattern:
      "trpc(\\.[A-Za-z_][A-Za-z0-9_]*)+\\.(useMutation|useQuery|useSubscription)\\(",
    message:
      "Use useMutation(trpc.x.mutationOptions(...)) / useQuery(trpc.x.queryOptions(...)) / useSubscription(trpc.x.subscriptionOptions(...)).",
  },
];

let failed = false;
for (const rule of rules) {
  const out = execSync(
    `grep -rEn --include='*.ts' --include='*.tsx' ${JSON.stringify(rule.pattern)} apps/web/src || true`,
    { encoding: "utf8" },
  ).trim();
  if (out) {
    console.error(`\n[check-trpc-patterns] forbidden pattern matched:\n`);
    console.error(`  ${rule.message}\n`);
    console.error(out);
    console.error("");
    failed = true;
  }
}

if (failed) process.exit(1);
console.log("[check-trpc-patterns] OK");
