import { execSync } from "node:child_process";
import { type TestSuite, testDbEnv } from "@project/test-infra";

// Accepts either literal ports (`kill-ports.ts 3000 3001`) or a test suite
// (`kill-ports.ts --suite=e2e`) which derives its ports via testDbEnv().
// Mixed invocations are allowed: `kill-ports.ts 3000 --suite=e2e`.
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: kill-ports.ts <port|--suite=e2e|--suite=unit> [...]");
  process.exit(1);
}

const ports: number[] = [];
for (const arg of args) {
  if (arg.startsWith("--suite=")) {
    const suite = arg.slice("--suite=".length) as TestSuite;
    if (suite !== "e2e" && suite !== "unit") {
      console.error(`Invalid suite: ${suite}. Expected "e2e" or "unit".`);
      process.exit(1);
    }
    const env = testDbEnv(suite);
    ports.push(env.TEST_WEB_PORT, env.TEST_API_PORT);
    continue;
  }
  const parsed = Number.parseInt(arg, 10);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 65535) {
    console.error(`Invalid port: ${arg}`);
    continue;
  }
  ports.push(parsed);
}

for (const port of ports) {
  try {
    const pids = execSync(`lsof -ti :${port}`, { encoding: "utf-8" }).trim();
    if (pids) {
      execSync(`kill ${pids}`);
      console.log(
        `Killed processes on port ${port}: ${pids.replace(/\n/g, ", ")}`,
      );
    }
  } catch {
    // No process on port — that's fine
  }
}
