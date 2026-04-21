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
import { type CheckResult, timeCheck } from "./checks-types.ts";

export function checkTestInfraIntegrity(): Promise<CheckResult> {
  return timeCheck("check-test-infra-integrity", () => {
    const errors: string[] = [];

    // 1. docker-compose.test.yml must have a service block for every
    //    CONTAINER_SERVICES key.
    const testComposeFile = path.join(PROJECT_ROOT, "docker-compose.test.yml");
    if (existsSync(testComposeFile)) {
      const services = execSync(
        "TEST_PORT=9999 TEST_CONTAINER=audit-dummy TEST_REDIS_PORT=9998 TEST_REDIS_CONTAINER=audit-dummy-redis TEST_MAILPIT_SMTP_PORT=9997 TEST_MAILPIT_HTTP_PORT=9996 TEST_MAILPIT_CONTAINER=audit-dummy-mailpit docker compose -f docker-compose.test.yml config --services",
        { cwd: PROJECT_ROOT, encoding: "utf-8" },
      )
        .trim()
        .split("\n")
        .filter(Boolean);
      for (const svc of Object.keys(CONTAINER_SERVICES)) {
        const hit = services.some(
          (s) =>
            s.includes(svc) ||
            svc.includes(s) ||
            (svc === "db" && s === "postgres"),
        );
        if (!hit) {
          errors.push(
            `docker-compose.test.yml: CONTAINER_SERVICES["${svc}"] has no matching service block (compose services: ${services.join(", ")})`,
          );
        }
      }
    } else {
      errors.push(
        "docker-compose.test.yml: file not found — CONTAINER_SERVICES can't be cross-checked against compose",
      );
    }

    // 2. @project/env server schema must declare every service's envVar.
    const envSchemaFile = path.join(PROJECT_ROOT, "packages/env/src/server.ts");
    if (existsSync(envSchemaFile)) {
      const src = readFileSync(envSchemaFile, "utf-8");
      for (const [svc, cfg] of Object.entries(CONTAINER_SERVICES)) {
        const re = new RegExp(`\\b${cfg.envVar}\\s*:`, "m");
        if (!re.test(src)) {
          errors.push(
            `packages/env/src/server.ts: CONTAINER_SERVICES["${svc}"].envVar = "${cfg.envVar}" not declared in Zod schema`,
          );
        }
      }
    } else {
      errors.push(
        "packages/env/src/server.ts: file not found — CONTAINER_SERVICES envVars can't be cross-checked",
      );
    }

    return errors;
  });
}

if (import.meta.main) {
  const result = await checkTestInfraIntegrity();
  if (!result.ok) {
    console.error(
      `FAIL: ${result.errors.length} test-infra integrity mismatch(es). CONTAINER_SERVICES in @project/test-infra must stay aligned with compose + env Zod schema.`,
    );
    for (const e of result.errors) console.error(`  ${e}`);
    process.exit(1);
  }
  console.log(
    `OK: CONTAINER_SERVICES (${Object.keys(CONTAINER_SERVICES).length}) aligned with compose + env schema.`,
  );
}
