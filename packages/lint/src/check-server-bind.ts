// Guards against the "Hono binds localhost in production" trap.
//
// @hono/node-server's `serve()` defaults to the host's loopback when
// `hostname` is omitted. Inside a container that means nothing outside the
// container (Traefik, sibling services, the host) can reach the API, and the
// failure mode is silent — healthchecks may still pass over 127.0.0.1 from
// inside the container while external traffic gets connection refused.
//
// This script greps the server entrypoint for an explicit `hostname:
// "0.0.0.0"` in a `serve(...)` call. Runs in `make lint`.

import { readFileSync } from "node:fs";
import { type CheckResult, timeCheck } from "./checks-types.ts";

const ENTRYPOINT = "apps/server/src/index.ts";

/**
 * Exposed for tests: scans a given source string and returns errors.
 */
export function runServerBind(src: string, filePath = ENTRYPOINT): string[] {
  const ok = /serve\(\s*\{[^}]*hostname:\s*["']0\.0\.0\.0["'][^}]*}/s.test(src);
  if (ok) return [];
  return [
    `${filePath}: must call serve() with hostname: "0.0.0.0". Without it the API silently becomes unreachable inside containers.`,
  ];
}

export function checkServerBind(): Promise<CheckResult> {
  return timeCheck("check-server-bind", () => {
    const src = readFileSync(ENTRYPOINT, "utf8");
    return runServerBind(src, ENTRYPOINT);
  });
}

if (import.meta.main) {
  // TODO(Phase-3): remove WIPE_IN_PROGRESS guard once apps/server/src/index.ts is restored.
  // See docs/superpowers/specs/2026-04-28-effect-rewrite-phase-1-design.md
  if (process.env.WIPE_IN_PROGRESS === "1") {
    console.log(
      "[check-server-bind] skipped — wipe in progress (Phase 1 design doc)",
    );
    process.exit(0);
  }

  const result = await checkServerBind();
  if (!result.ok) {
    for (const e of result.errors) console.error(`[check-server-bind] ${e}`);
    process.exit(1);
  }
  console.log("[check-server-bind] OK");
}
