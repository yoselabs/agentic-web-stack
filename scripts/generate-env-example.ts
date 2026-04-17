// Regenerates .env.example files from @project/config. Run manually
// when dev DB creds/port change in @project/config — the files are
// committed, but only as user-facing examples.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { DEV_DB_NAME, DEV_DB_PASSWORD, DEV_DB_USER } from "@project/config/db";
import { DEV_API_PORT, DEV_DB_PORT } from "@project/config/ports";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");

const databaseUrl = `postgresql://${DEV_DB_USER}:${DEV_DB_PASSWORD}@localhost:${DEV_DB_PORT}/${DEV_DB_NAME}`;
const betterAuthUrl = `http://localhost:${DEV_API_PORT}`;

const rootEnv = `DATABASE_URL="${databaseUrl}"
BETTER_AUTH_SECRET="change-me-to-a-random-32-char-secret-key"
BETTER_AUTH_URL="${betterAuthUrl}"
VITE_API_URL="${betterAuthUrl}"
`;

const dbEnv = `DATABASE_URL="${databaseUrl}"
`;

writeFileSync(path.join(PROJECT_ROOT, ".env.example"), rootEnv);
writeFileSync(path.join(PROJECT_ROOT, "packages/db/.env.example"), dbEnv);

console.log("Regenerated .env.example files from @project/config.");
