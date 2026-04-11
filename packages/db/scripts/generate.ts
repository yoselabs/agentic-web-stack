import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(PACKAGE_ROOT, "../..");
const SCHEMA_DIR = path.join(PACKAGE_ROOT, "prisma/schema");
const CONFIG_FILE = path.join(PACKAGE_ROOT, "prisma.config.ts");
const HASH_DIR = path.join(REPO_ROOT, "node_modules/.cache");
const HASH_FILE = path.join(HASH_DIR, "prisma-generate.hash");
const LOCK_FILE = path.join(HASH_DIR, "prisma-generate.lock");
const STALE_LOCK_MS = 120_000;

const prismaVersion = require("prisma/package.json").version;

const hash = createHash("sha256");
hash.update(`prisma-cli@${prismaVersion}\n`);
const schemaFiles = readdirSync(SCHEMA_DIR)
  .filter((f) => f.endsWith(".prisma"))
  .sort();
for (const f of schemaFiles) {
  hash.update(readFileSync(path.join(SCHEMA_DIR, f)));
}
if (existsSync(CONFIG_FILE)) hash.update(readFileSync(CONFIG_FILE));
const current = hash.digest("hex");

function readStoredHash(): string {
  return existsSync(HASH_FILE) ? readFileSync(HASH_FILE, "utf8").trim() : "";
}

if (current === readStoredHash()) {
  console.log("prisma: schema + CLI unchanged, skipping generate");
  process.exit(0);
}

// Acquire a lock so two parallel `make test` / `make test-unit` invocations
// don't both run `prisma generate` against the same node_modules output — the
// generator is not atomic and interleaved writes can leave a half-rewritten
// client. After acquiring the lock we re-read the hash; if a sibling process
// just finished the same work, skip. Stale lock (> STALE_LOCK_MS) is cleared
// automatically — covers the case where a previous run was SIGKILL'd.
mkdirSync(HASH_DIR, { recursive: true });
const start = Date.now();
let lockFd: number | null = null;
while (lockFd === null) {
  try {
    lockFd = openSync(LOCK_FILE, "wx");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    const age = Date.now() - statSync(LOCK_FILE).mtimeMs;
    if (age > STALE_LOCK_MS) {
      rmSync(LOCK_FILE, { force: true });
      continue;
    }
    if (Date.now() - start > STALE_LOCK_MS) {
      throw new Error(
        `prisma-generate lock held > ${STALE_LOCK_MS}ms at ${LOCK_FILE}. Another process may be stuck; delete the file manually.`,
      );
    }
    execSync("sleep 0.2");
  }
}

try {
  if (current === readStoredHash()) {
    console.log(
      "prisma: sibling process just regenerated, skipping duplicate work",
    );
    process.exit(0);
  }
  execSync("prisma generate", { stdio: "inherit", cwd: PACKAGE_ROOT });
  writeFileSync(HASH_FILE, current);
} finally {
  closeSync(lockFd);
  rmSync(LOCK_FILE, { force: true });
}
