// DATABASE_URL precedence: shell env > workspace .env > zero-conf literal.
// See docs/superpowers/specs/2026-04-18-zero-conf-architecture-design.md §D6.
import * as fs from "node:fs";
import * as path from "node:path";
import { defineConfig } from "prisma/config";

// Load workspace root .env when Prisma config is active (it skips auto .env loading).
const envPath = path.resolve(import.meta.dirname, "../../.env");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const val = match[2].trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

// Zero-conf fallback: if no .env file and no shell override, use the same
// dev default the @project/env Zod schema uses. Prisma CLI reads process.env
// directly and can't see @project/env — the literal must live here too.
// Duplication is intentional; see zero-conf design spec §D6.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@localhost:5432/app";
}

export default defineConfig({
  schema: "prisma/schema",
});
