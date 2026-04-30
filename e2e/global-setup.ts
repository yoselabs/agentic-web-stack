import { spawn } from "node:child_process";
import {
  envForSubprocess,
  PROJECT_ROOT,
  setupTestDatabase,
} from "@project/test-infra";

// Spawn the BullMQ worker as a child process. The e2e suite exercises
// queue-backed flows (todo-purge cron, plus email when @project/email
// lands in capability #2); without a running worker, queued jobs never
// reach their consumers and scenarios time out with no diagnostic.
//
// The worker has no HTTP surface, so it can't live in Playwright's
// webServer config (which requires a port/url to health-check). It
// runs under globalSetup with an explicit teardown registered on the
// returned callback so a crashed suite can't orphan it.
//
// Runtime parity with apps/server: node 24 + --experimental-strip-types,
// not bun, per ADR-0010.
export default async function globalSetup() {
  await setupTestDatabase("e2e");

  const workerEnv = {
    ...process.env,
    ...envForSubprocess("e2e"),
  };
  const child = spawn("node", ["--experimental-strip-types", "src/index.ts"], {
    cwd: `${PROJECT_ROOT}/apps/worker`,
    env: workerEnv,
    stdio: "inherit",
  });

  // Reject unhandled exits loudly — a silently dead worker causes
  // queue-backed scenarios to time out at 10s with no diagnostic.
  child.on("exit", (code, signal) => {
    if (signal !== "SIGTERM" && code !== 0 && code !== null) {
      // biome-ignore lint/suspicious/noConsole: globalSetup runs outside the Effect runtime; console is the only sink.
      console.error(`[e2e] worker exited unexpectedly: code=${code}`);
    }
  });

  return async () => {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), 2000);
      child.on("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  };
}
