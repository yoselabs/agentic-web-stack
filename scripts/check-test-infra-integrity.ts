// Integrity audit for @project/test-infra's CONTAINER_SERVICES registry.
// Fails make lint if the registry drifts from its load-bearing siblings:
// - docker-compose.test.yml (each service must have a block)
// - packages/env/src/server.ts (each service's envVar must be in the Zod schema)
//
// Runs in make lint so "I added a service to CONTAINER_SERVICES but forgot
// to wire it up in <X>" fails at commit time, not at runtime.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { CONTAINER_SERVICES, PROJECT_ROOT } from "@project/test-infra";

type Fail = { where: string; msg: string };
const fails: Fail[] = [];

// 1. docker-compose.test.yml must have a service block for every
//    CONTAINER_SERVICES key. Delegate YAML parsing to compose itself —
//    `config --services` lists every declared service name.
const testComposeFile = path.join(PROJECT_ROOT, "docker-compose.test.yml");
if (existsSync(testComposeFile)) {
  // TEST_PORT / TEST_CONTAINER are required by the compose file's var
  // substitution. Supply dummies so `config --services` doesn't error.
  const services = execSync(
    "TEST_PORT=9999 TEST_CONTAINER=audit-dummy docker compose -f docker-compose.test.yml config --services",
    { cwd: PROJECT_ROOT, encoding: "utf-8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  for (const svc of Object.keys(CONTAINER_SERVICES)) {
    // CONTAINER_SERVICES keys ("db") don't always match compose service
    // names ("postgres"). Accept any overlap: if ANY compose service
    // block's name contains the key (or vice versa), we pass. Loose by
    // design — the real integrity signal is the Zod schema check below,
    // which catches the silent-miss class of bug. The compose check is a
    // smoke test for "someone added a service to the registry but not to
    // the compose file at all."
    const hit = services.some(
      (s) =>
        s.includes(svc) ||
        svc.includes(s) ||
        // Accept "db" as matching "postgres" — the canonical pair.
        (svc === "db" && s === "postgres"),
    );
    if (!hit) {
      fails.push({
        where: "docker-compose.test.yml",
        msg: `CONTAINER_SERVICES["${svc}"] has no matching service block (compose services: ${services.join(", ")})`,
      });
    }
  }
} else {
  fails.push({
    where: "docker-compose.test.yml",
    msg: "file not found — CONTAINER_SERVICES can't be cross-checked against compose",
  });
}

// 2. @project/env server schema must declare every service's envVar.
//    We grep the source file rather than importing the Zod schema (createEnv
//    parses at module load and doesn't expose the raw schema for reflection).
const envSchemaFile = path.join(PROJECT_ROOT, "packages/env/src/server.ts");
if (existsSync(envSchemaFile)) {
  const src = readFileSync(envSchemaFile, "utf-8");
  for (const [svc, cfg] of Object.entries(CONTAINER_SERVICES)) {
    // Match `DATABASE_URL:` or `DATABASE_URL :` anywhere in the source.
    // Coarse — matches inside string literals or comments too — but
    // false-positives favor "pass" (we only fail when genuinely absent).
    const re = new RegExp(`\\b${cfg.envVar}\\s*:`, "m");
    if (!re.test(src)) {
      fails.push({
        where: "packages/env/src/server.ts",
        msg: `CONTAINER_SERVICES["${svc}"].envVar = "${cfg.envVar}" not declared in Zod schema`,
      });
    }
  }
} else {
  fails.push({
    where: "packages/env/src/server.ts",
    msg: "file not found — CONTAINER_SERVICES envVars can't be cross-checked",
  });
}

if (fails.length === 0) {
  console.log(
    `OK: CONTAINER_SERVICES (${Object.keys(CONTAINER_SERVICES).length}) aligned with compose + env schema.`,
  );
  process.exit(0);
}

console.error(
  `FAIL: ${fails.length} test-infra integrity mismatch(es). CONTAINER_SERVICES in @project/test-infra must stay aligned with compose + env Zod schema.`,
);
for (const f of fails) {
  console.error(`\n  ${f.where}: ${f.msg}`);
}
process.exit(1);
