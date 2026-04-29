// Guards against the "server binds localhost in production" trap.
//
// Both `@hono/node-server`'s `serve()` and `@effect/platform-node`'s
// `NodeHttpServer.layer()` default to the host's loopback when the bind
// host is omitted. Inside a container that means nothing outside the
// container (Traefik, sibling services, the host) can reach the API, and
// the failure mode is silent — healthchecks may still pass over 127.0.0.1
// from inside the container while external traffic gets connection refused.
//
// This script greps the server entrypoint for an explicit `0.0.0.0` bind
// under either the Hono `hostname:` key or the `@effect/platform-node`
// `host:` key. Runs in `make lint`.

import { readFileSync } from "node:fs";
import { type CheckResult, timeCheck } from "./checks-types.ts";

const ENTRYPOINT = "apps/server/src/index.ts";

/**
 * Exposed for tests: scans a given source string and returns errors.
 */
export function runServerBind(src: string, filePath = ENTRYPOINT): string[] {
  const honoOk = /serve\(\s*\{[^}]*hostname:\s*["']0\.0\.0\.0["'][^}]*}/s.test(
    src,
  );
  const effectOk = /host:\s*["']0\.0\.0\.0["']/s.test(src);
  if (honoOk || effectOk) return [];
  return [
    `${filePath}: must bind 0.0.0.0 explicitly (hostname:"0.0.0.0" for Hono serve(), host:"0.0.0.0" for @effect/platform-node NodeHttpServer.layer()). Without it the API silently becomes unreachable inside containers.`,
  ];
}

export function checkServerBind(): Promise<CheckResult> {
  return timeCheck("check-server-bind", () => {
    const src = readFileSync(ENTRYPOINT, "utf8");
    return runServerBind(src, ENTRYPOINT);
  });
}

if (import.meta.main) {
  const result = await checkServerBind();
  if (!result.ok) {
    for (const e of result.errors) console.error(`[check-server-bind] ${e}`);
    process.exit(1);
  }
  console.log("[check-server-bind] OK");
}
