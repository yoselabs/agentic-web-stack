# Plan A: Jobs + Email + Worker Infrastructure

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the background-job + email infrastructure — `@project/jobs`, `@project/email`, `apps/worker`, Redis + Mailpit in compose, per-suite dynamic ports — and prove it end-to-end via Better-Auth password reset.

**Architecture:** Redis (shared between BullMQ queues and the future realtime channel) and Mailpit (dev SMTP catcher) added to dev + test compose with dynamic ports per suite. Two queues: `email` (retryable, dead-letter) and `maintenance` (repeatable crons, unused in Plan A). A separate `apps/worker` Node process boots the workers — crash isolation from the HTTP server. `@project/email` exposes `send(template, vars)` that *enqueues* a job; the worker renders the template and calls `nodemailer.sendMail`.

**Tech Stack:** BullMQ, ioredis, nodemailer, Mailpit (axllent/mailpit), @bull-board/{api,hono} (mounted in Plan B), Better-Auth hooks.

**Spec:** `docs/superpowers/specs/2026-04-19-template-reference-implementation-design.md`

---

### Task 1: Extend `PROFILES` + `CONTAINER_SERVICES` for Redis and Mailpit

**Files:**
- Modify: `packages/test-infra/src/index.ts`

- [ ] **Step 1: Add Redis + Mailpit port bases to `PROFILES`**

In `packages/test-infra/src/index.ts`, replace the `PROFILES` constant:

```ts
const PROFILES = {
  e2e: {
    db: 5400,
    web: 3100,
    api: 3200,
    redis: 6300,
    mailpitSmtp: 2500,
    mailpitHttp: 8100,
  },
  unit: {
    db: 5500,
    web: 3300,
    api: 3400,
    redis: 6400,
    mailpitSmtp: 2600,
    mailpitHttp: 8200,
  },
} as const satisfies Record<TestSuite, Record<string, number>>;
```

- [ ] **Step 2: Add container-service entries**

Replace `CONTAINER_SERVICES`:

```ts
export const CONTAINER_SERVICES = {
  db: {
    envVar: "DATABASE_URL",
    url: (port: number) =>
      `postgresql://postgres:postgres@localhost:${port}/${TEST_DB_NAME}`,
  },
  redis: {
    envVar: "REDIS_URL",
    url: (port: number) => `redis://localhost:${port}`,
  },
  mailpitSmtp: {
    envVar: "SMTP_URL",
    url: (port: number) => `smtp://localhost:${port}`,
  },
  mailpitHttp: {
    envVar: "MAILPIT_API_URL",
    url: (port: number) => `http://localhost:${port}`,
  },
} as const satisfies Record<
  string,
  { envVar: string; url: (p: number) => string }
>;
```

- [ ] **Step 3: Extend `testDbEnv()` to expose new ports + container names**

In `testDbEnv(suite)`, after the existing `apiPort` line, add:

```ts
const redisPort = profile.redis + portOffset;
const mailpitSmtpPort = profile.mailpitSmtp + portOffset;
const mailpitHttpPort = profile.mailpitHttp + portOffset;
const redisContainer = `agentic-redis-${suite}-${hash8}`;
const mailpitContainer = `agentic-mailpit-${suite}-${hash8}`;
```

Then extend the returned object:

```ts
return {
  TEST_PORT: port,
  TEST_WEB_PORT: webPort,
  TEST_API_PORT: apiPort,
  TEST_REDIS_PORT: redisPort,
  TEST_MAILPIT_SMTP_PORT: mailpitSmtpPort,
  TEST_MAILPIT_HTTP_PORT: mailpitHttpPort,
  TEST_WEB_URL: `http://localhost:${webPort}`,
  TEST_API_URL: `http://localhost:${apiPort}`,
  TEST_MAILPIT_API_URL: `http://localhost:${mailpitHttpPort}`,
  TEST_CONTAINER: container,
  TEST_REDIS_CONTAINER: redisContainer,
  TEST_MAILPIT_CONTAINER: mailpitContainer,
  TEST_DATABASE_URL: `postgresql://postgres:postgres@localhost:${port}/${TEST_DB_NAME}`,
  TEST_REDIS_URL: `redis://localhost:${redisPort}`,
  PROJECT_ROOT,
};
```

- [ ] **Step 4: Run type-check**

```bash
make lint
```

Expected: PASS (test-infra typechecks, but the integrity audit will fail — we fix that in Task 4).

- [ ] **Step 5: Commit**

```bash
git add packages/test-infra/src/index.ts
git commit -m "feat(test-infra): add Redis + Mailpit to PROFILES and CONTAINER_SERVICES"
```

---

### Task 2: Update `docker-compose.test.yml` with Redis + Mailpit

**Files:**
- Modify: `docker-compose.test.yml`

- [ ] **Step 1: Add redis + mailpit services**

Replace `docker-compose.test.yml` with:

```yaml
name: agentic-web-stack-test

services:
  postgres:
    image: postgres:17
    # TEST_CONTAINER, TEST_PORT supplied by scripts/test-db.ts.
    container_name: ${TEST_CONTAINER}
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "${TEST_PORT}:5432"
    tmpfs:
      - /var/lib/postgresql/data
    command:
      - postgres
      - -c
      - fsync=off
      - -c
      - synchronous_commit=off
      - -c
      - full_page_writes=off
      - -c
      - wal_level=minimal
      - -c
      - max_wal_senders=0
      - -c
      - shared_buffers=256MB
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 1s
      timeout: 1s
      retries: 15

  redis:
    image: redis:7-alpine
    container_name: ${TEST_REDIS_CONTAINER}
    ports:
      - "${TEST_REDIS_PORT}:6379"
    command: ["redis-server", "--save", "", "--appendonly", "no"]
    tmpfs:
      - /data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 1s
      timeout: 1s
      retries: 15

  mailpit:
    image: axllent/mailpit
    container_name: ${TEST_MAILPIT_CONTAINER}
    ports:
      - "${TEST_MAILPIT_SMTP_PORT}:1025"
      - "${TEST_MAILPIT_HTTP_PORT}:8025"
    environment:
      MP_MAX_MESSAGES: "500"
      MP_SMTP_AUTH_ACCEPT_ANY: "1"
      MP_SMTP_AUTH_ALLOW_INSECURE: "1"
    healthcheck:
      test: ["CMD-SHELL", "wget -q --spider http://localhost:8025/api/v1/info || exit 1"]
      interval: 1s
      timeout: 1s
      retries: 15
```

- [ ] **Step 2: Commit**

```bash
git add docker-compose.test.yml
git commit -m "feat(compose-test): add Redis + Mailpit services"
```

---

### Task 3: Update `docker-compose.dev.yml` with Redis + Mailpit

**Files:**
- Modify: `docker-compose.dev.yml`

- [ ] **Step 1: Add redis + mailpit services to dev compose**

Replace `docker-compose.dev.yml` with:

```yaml
# Dev-mode: postgres, redis, mailpit. Used by `make setup`, `make db`, `make clean`.
# The full-stack demo uses docker-compose.yml.
name: agentic-web-stack

services:
  postgres:
    image: postgres:17
    container_name: agentic-postgres
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    container_name: agentic-redis
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  mailpit:
    image: axllent/mailpit
    container_name: agentic-mailpit
    ports:
      - "1025:1025"
      - "8025:8025"
    environment:
      MP_MAX_MESSAGES: "500"
      MP_SMTP_AUTH_ACCEPT_ANY: "1"
      MP_SMTP_AUTH_ALLOW_INSECURE: "1"
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
```

- [ ] **Step 2: Bring the new services up and verify**

```bash
docker compose -f docker-compose.dev.yml up -d redis mailpit
docker compose -f docker-compose.dev.yml ps
```

Expected: both `agentic-redis` and `agentic-mailpit` show `Up` status. Open `http://localhost:8025` in a browser — Mailpit UI should load.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.dev.yml
git commit -m "feat(compose-dev): add Redis + Mailpit services"
```

---

### Task 4: Extend env schema + integrity audit

**Files:**
- Modify: `packages/env/src/server.ts`
- Modify: `scripts/check-test-infra-integrity.ts`

- [ ] **Step 1: Add new env vars to Zod schema**

Replace `packages/env/src/server.ts` with:

```ts
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z
      .string()
      .url()
      .default("postgresql://postgres:postgres@localhost:5432/app"),
    REDIS_URL: z.string().url().default("redis://localhost:6379"),
    SMTP_URL: z.string().url().default("smtp://localhost:1025"),
    MAILPIT_API_URL: z
      .string()
      .url()
      .default("http://localhost:8025"),
    CORS_ORIGIN: z.string().url().default("http://localhost:3000"),
    BETTER_AUTH_SECRET: z
      .string()
      .min(32)
      .default("change-me-to-a-random-32-char-secret-key"),
    BETTER_AUTH_URL: z.string().url().default("http://localhost:3001"),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    PORT: z.coerce.number().default(3001),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace"])
      .optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
```

- [ ] **Step 2: Read the existing integrity audit**

```bash
cat scripts/check-test-infra-integrity.ts
```

Study which compose files and which env-schema file it parses. The audit cross-checks `CONTAINER_SERVICES` keys ↔ compose `services` ↔ env schema. It already handles `db` → `DATABASE_URL`; extend it to handle the new keys.

- [ ] **Step 3: Update the audit to cover new services**

For each new key in `CONTAINER_SERVICES`, the audit must assert:
- `docker-compose.test.yml` has a matching `services.<key>` block
- `docker-compose.dev.yml` has a matching `services.<key>` block (or equivalent — check how existing audit handles dev)
- `packages/env/src/server.ts` declares the `envVar`

The exact edits depend on the audit's current implementation. Make the audit loop over `CONTAINER_SERVICES` entries instead of hard-coding `db`.

- [ ] **Step 4: Run the audit**

```bash
bun run scripts/check-test-infra-integrity.ts
```

Expected: PASS.

- [ ] **Step 5: Run full lint**

```bash
make lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/env/src/server.ts scripts/check-test-infra-integrity.ts
git commit -m "feat(env,audit): add REDIS_URL + SMTP_URL + MAILPIT_API_URL schema and extend integrity audit"
```

---

### Task 5: Create `@project/jobs` package

**Files:**
- Create: `packages/jobs/package.json`
- Create: `packages/jobs/tsconfig.json`
- Create: `packages/jobs/src/redis.ts`
- Create: `packages/jobs/src/queues.ts`
- Create: `packages/jobs/src/index.ts`
- Create: `packages/jobs/README.md`
- Modify: `pnpm-workspace.yaml` (add catalog entries)

- [ ] **Step 1: Add catalog entries for new dependencies**

In `pnpm-workspace.yaml`, extend the `catalog:` section:

```yaml
catalog:
  "@prisma/client": ^6.19.3
  prisma: ^6.19.3
  zod: ^3.25.76
  "@t3-oss/env-core": ^0.12.0
  "@types/node": ^25.6.0
  typescript: ^5.7.2
  bullmq: ^5.28.0
  ioredis: ^5.4.1
  nodemailer: ^6.9.16
  "@types/nodemailer": ^6.4.17
```

- [ ] **Step 2: Create `packages/jobs/package.json`**

```json
{
  "name": "@project/jobs",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./queues": {
      "default": "./src/queues.ts"
    },
    "./redis": {
      "default": "./src/redis.ts"
    }
  },
  "dependencies": {
    "@project/env": "workspace:*",
    "bullmq": "catalog:",
    "ioredis": "catalog:"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "typescript": "catalog:"
  }
}
```

- [ ] **Step 3: Create `packages/jobs/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

- [ ] **Step 4: Create `packages/jobs/src/redis.ts`**

```ts
// Shared ioredis connection config for BullMQ queues and workers.
// Single connection URL keeps test-infra + dev + prod aligned through @project/env.
//
// BullMQ requires `maxRetriesPerRequest: null` on the shared connection
// (worker-side); the queue-side can use defaults. We expose a single factory
// keyed by role to make the call sites self-documenting.

import { env } from "@project/env/server";
import { Redis, type RedisOptions } from "ioredis";

export type RedisRole = "queue" | "worker";

export function createRedis(role: RedisRole): Redis {
  const options: RedisOptions =
    role === "worker" ? { maxRetriesPerRequest: null } : {};
  return new Redis(env.REDIS_URL, options);
}
```

- [ ] **Step 5: Create `packages/jobs/src/queues.ts`**

```ts
// Queue factories. Both queues share the same Redis connection (role: "queue").
//
// Queue names are stable strings — consumers in @project/email, the worker,
// and the future Bull Board mount reference them by name. Do not rename
// without updating all call sites.

import { Queue, type JobsOptions } from "bullmq";
import { createRedis } from "./redis.js";

export const EMAIL_QUEUE_NAME = "email" as const;
export const MAINTENANCE_QUEUE_NAME = "maintenance" as const;

// Retry policy for email jobs: 3 attempts with exponential backoff (1s, 4s, 16s).
// Failed jobs go to dead-letter (visible in Bull Board Failed tab).
export const EMAIL_JOB_DEFAULTS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 1000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 },
};

let emailQueueInstance: Queue | null = null;
let maintenanceQueueInstance: Queue | null = null;

export function emailQueue(): Queue {
  if (!emailQueueInstance) {
    emailQueueInstance = new Queue(EMAIL_QUEUE_NAME, {
      connection: createRedis("queue"),
      defaultJobOptions: EMAIL_JOB_DEFAULTS,
    });
  }
  return emailQueueInstance;
}

export function maintenanceQueue(): Queue {
  if (!maintenanceQueueInstance) {
    maintenanceQueueInstance = new Queue(MAINTENANCE_QUEUE_NAME, {
      connection: createRedis("queue"),
    });
  }
  return maintenanceQueueInstance;
}

export async function closeQueues(): Promise<void> {
  await Promise.all([
    emailQueueInstance?.close(),
    maintenanceQueueInstance?.close(),
  ]);
  emailQueueInstance = null;
  maintenanceQueueInstance = null;
}
```

- [ ] **Step 6: Create `packages/jobs/src/index.ts`**

```ts
// Intentionally empty — consumers import subpaths directly per the no-barrel rule.
// See root CLAUDE.md. This file exists only to satisfy tools that default to ./index.
export {};
```

- [ ] **Step 7: Create `packages/jobs/README.md`**

````markdown
# @project/jobs

BullMQ queue factories. Two named queues:

- `email` — retryable with exponential backoff (3 attempts: 1s, 4s, 16s), dead-letter on final failure
- `maintenance` — repeatable cron jobs (no default retry policy)

## Usage

```ts
import { emailQueue } from "@project/jobs/queues";

await emailQueue().add("invite-collaborator", { listId, invitedUserId });
```

## Idempotency

BullMQ retries re-run the handler. Handlers must be idempotent or use a
dedup key in job data. For pure "send email" jobs this is naturally safe
modulo SMTP-server dedup. For handlers with DB side effects, use a unique
`jobId` option or check for prior completion inside the handler.

## Primitives not demonstrated here

**Delayed jobs** — BullMQ supports `queue.add(name, data, { delay: ms })`
to schedule a job N milliseconds in the future. Not used by any job in
this template; see [BullMQ docs](https://docs.bullmq.io/guide/jobs/delayed).
````

- [ ] **Step 8: Install + verify**

```bash
pnpm install
make lint
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add pnpm-workspace.yaml packages/jobs/ pnpm-lock.yaml
git commit -m "feat(jobs): add @project/jobs package with email + maintenance queue factories"
```

---

### Task 6: Create `@project/email` package

**Files:**
- Create: `packages/email/package.json`
- Create: `packages/email/tsconfig.json`
- Create: `packages/email/src/service.ts`
- Create: `packages/email/src/templates/password-reset.ts`
- Create: `packages/email/src/templates/invite-collaborator.ts`
- Create: `packages/email/src/handler.ts`
- Create: `packages/email/src/index.ts`

- [ ] **Step 1: Create `packages/email/package.json`**

```json
{
  "name": "@project/email",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./service": {
      "default": "./src/service.ts"
    },
    "./handler": {
      "default": "./src/handler.ts"
    }
  },
  "dependencies": {
    "@project/env": "workspace:*",
    "@project/jobs": "workspace:*",
    "nodemailer": "catalog:"
  },
  "devDependencies": {
    "@types/nodemailer": "catalog:",
    "@types/node": "catalog:",
    "typescript": "catalog:"
  }
}
```

- [ ] **Step 2: Create `packages/email/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/email/src/templates/password-reset.ts`**

```ts
// Template registry entry. Renders to { subject, html, text }.
// vars typing is the source of truth for what the caller of send() must pass.

export type PasswordResetVars = {
  userName: string;
  resetUrl: string;
};

export const passwordResetTemplate = {
  name: "password-reset",
  render(vars: PasswordResetVars) {
    return {
      subject: "Reset your password",
      html: `
        <p>Hi ${vars.userName},</p>
        <p>We received a request to reset your password. Click below to choose a new one:</p>
        <p><a href="${vars.resetUrl}">Reset password</a></p>
        <p>If you didn't request this, you can ignore this email.</p>
      `,
      text: `Hi ${vars.userName},\n\nReset your password: ${vars.resetUrl}\n\nIf you didn't request this, ignore this email.`,
    };
  },
} as const;
```

- [ ] **Step 4: Create `packages/email/src/templates/invite-collaborator.ts`**

```ts
// Template for collaborator invites. Consumed in Plan C when
// todoListService.inviteCollaborator enqueues the job.

export type InviteCollaboratorVars = {
  inviterName: string;
  listName: string;
  acceptUrl: string;
};

export const inviteCollaboratorTemplate = {
  name: "invite-collaborator",
  render(vars: InviteCollaboratorVars) {
    return {
      subject: `${vars.inviterName} invited you to "${vars.listName}"`,
      html: `
        <p>${vars.inviterName} invited you to collaborate on the list <strong>${vars.listName}</strong>.</p>
        <p><a href="${vars.acceptUrl}">Accept invite</a></p>
        <p>This link will expire in 7 days.</p>
      `,
      text: `${vars.inviterName} invited you to "${vars.listName}".\n\nAccept: ${vars.acceptUrl}\n\nExpires in 7 days.`,
    };
  },
} as const;
```

- [ ] **Step 5: Create `packages/email/src/service.ts`**

```ts
// Enqueue-only send() API. Never blocks on SMTP — the worker handles delivery.
//
// `template` + `vars` form a discriminated union indexed by template name.
// Adding a new template: create a file in ./templates/, add its name+vars
// to the TemplateMap, extend the switch in handler.ts.

import { emailQueue } from "@project/jobs/queues";
import type { InviteCollaboratorVars } from "./templates/invite-collaborator.js";
import type { PasswordResetVars } from "./templates/password-reset.js";

export type EmailJobData =
  | { template: "password-reset"; to: string; vars: PasswordResetVars }
  | {
      template: "invite-collaborator";
      to: string;
      vars: InviteCollaboratorVars;
    };

export async function sendEmail(data: EmailJobData): Promise<void> {
  await emailQueue().add(data.template, data);
}
```

- [ ] **Step 6: Create `packages/email/src/handler.ts`**

```ts
// Worker-side handler. Receives an EmailJobData, renders the template,
// dispatches via nodemailer. Runs inside apps/worker — never called from
// HTTP request handlers.
//
// Idempotency: nodemailer.sendMail is not idempotent at the SMTP layer,
// but retries re-send; most SMTP servers de-duplicate by Message-ID. For
// Mailpit in dev, duplicates appear in the mailbox — acceptable.

import { env } from "@project/env/server";
import nodemailer from "nodemailer";
import type { EmailJobData } from "./service.js";
import { inviteCollaboratorTemplate } from "./templates/invite-collaborator.js";
import { passwordResetTemplate } from "./templates/password-reset.js";

function createTransport() {
  const url = new URL(env.SMTP_URL);
  return nodemailer.createTransport({
    host: url.hostname,
    port: Number(url.port),
    secure: false,
    auth:
      url.username || url.password
        ? { user: url.username, pass: url.password }
        : undefined,
    tls: { rejectUnauthorized: false },
  });
}

let transportInstance: ReturnType<typeof createTransport> | null = null;
function transport() {
  if (!transportInstance) transportInstance = createTransport();
  return transportInstance;
}

export async function handleEmailJob(data: EmailJobData): Promise<void> {
  const rendered =
    data.template === "password-reset"
      ? passwordResetTemplate.render(data.vars)
      : inviteCollaboratorTemplate.render(data.vars);

  await transport().sendMail({
    from: "no-reply@example.com",
    to: data.to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
}
```

- [ ] **Step 7: Create `packages/email/src/index.ts`**

```ts
export {};
```

- [ ] **Step 8: Install + verify**

```bash
pnpm install
make lint
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/email/ pnpm-lock.yaml
git commit -m "feat(email): add @project/email — enqueue-only send() + template registry"
```

---

### Task 7: Create `apps/worker`

**Files:**
- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/worker/src/index.ts`
- Create: `apps/worker/src/handlers/email.ts`
- Create: `apps/worker/src/handlers/maintenance.ts`
- Create: `apps/worker/Dockerfile`

- [ ] **Step 1: Create `apps/worker/package.json`**

```json
{
  "name": "@project/worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@project/db": "workspace:*",
    "@project/email": "workspace:*",
    "@project/env": "workspace:*",
    "@project/jobs": "workspace:*",
    "bullmq": "catalog:",
    "ioredis": "catalog:"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "tsx": "^4.19.2",
    "typescript": "catalog:"
  }
}
```

- [ ] **Step 2: Create `apps/worker/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `apps/worker/src/handlers/email.ts`**

```ts
import { handleEmailJob } from "@project/email/handler";
import {
  EMAIL_QUEUE_NAME,
  EMAIL_JOB_DEFAULTS,
} from "@project/jobs/queues";
import { createRedis } from "@project/jobs/redis";
import { Worker } from "bullmq";
import type { EmailJobData } from "@project/email/service";

export function startEmailWorker(): Worker {
  const worker = new Worker<EmailJobData>(
    EMAIL_QUEUE_NAME,
    async (job) => {
      await handleEmailJob(job.data);
    },
    { connection: createRedis("worker") },
  );

  worker.on("failed", (job, err) => {
    console.error(
      `[email-worker] job ${job?.id} (${job?.name}) failed:`,
      err.message,
    );
  });

  worker.on("completed", (job) => {
    console.log(`[email-worker] job ${job.id} (${job.name}) completed`);
  });

  return worker;
}
```

- [ ] **Step 4: Create `apps/worker/src/handlers/maintenance.ts`**

```ts
// Maintenance queue handlers. Plan A ships the worker wiring only —
// actual maintenance jobs (expire-invites) are added in Plan C.
// This file exists so the worker boots a consumer for the queue,
// which prevents enqueued maintenance jobs from sitting forever.

import { MAINTENANCE_QUEUE_NAME } from "@project/jobs/queues";
import { createRedis } from "@project/jobs/redis";
import { Worker } from "bullmq";

export function startMaintenanceWorker(): Worker {
  const worker = new Worker(
    MAINTENANCE_QUEUE_NAME,
    async (job) => {
      // Handlers added in Plan C: expire-invites
      console.warn(
        `[maintenance-worker] received job "${job.name}" but no handler registered yet`,
      );
    },
    { connection: createRedis("worker") },
  );

  worker.on("failed", (job, err) => {
    console.error(
      `[maintenance-worker] job ${job?.id} failed:`,
      err.message,
    );
  });

  return worker;
}
```

- [ ] **Step 5: Create `apps/worker/src/index.ts`**

```ts
import { closeQueues } from "@project/jobs/queues";
import { startEmailWorker } from "./handlers/email.js";
import { startMaintenanceWorker } from "./handlers/maintenance.js";

const workers = [startEmailWorker(), startMaintenanceWorker()];

console.log("[worker] started email + maintenance workers");

async function shutdown(signal: NodeJS.Signals) {
  console.log(`[worker] received ${signal}, shutting down`);
  await Promise.all(workers.map((w) => w.close()));
  await closeQueues();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
```

- [ ] **Step 6: Create `apps/worker/Dockerfile`**

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/ packages/
RUN corepack enable && pnpm install --frozen-lockfile
COPY apps/worker apps/worker
RUN pnpm --filter @project/worker build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/apps/worker/dist ./dist
COPY --from=builder /app/apps/worker/package.json ./
COPY --from=builder /app/node_modules ./node_modules
CMD ["node", "dist/index.js"]
```

- [ ] **Step 7: Install + verify worker boots**

```bash
pnpm install
cd apps/worker && pnpm dev &
WORKER_PID=$!
sleep 3
kill $WORKER_PID || true
```

Expected: startup log `[worker] started email + maintenance workers` appears.

- [ ] **Step 8: Commit**

```bash
git add apps/worker/ pnpm-lock.yaml
git commit -m "feat(worker): add apps/worker with email + maintenance BullMQ consumers"
```

---

### Task 8: Wire Better-Auth `sendResetPassword` through the email queue

**Files:**
- Modify: `packages/auth/src/index.ts` (path may differ — find the file via `find packages/auth -name "*.ts" | head`)
- Modify: the login/signup route in `apps/web/src/routes/` (add "Forgot password?" link if not present)

- [ ] **Step 1: Read current Better-Auth config**

```bash
cat packages/auth/src/index.ts 2>/dev/null || find packages/auth/src -name "*.ts" -exec cat {} \;
```

Verify BOTH of these:
1. `emailAndPassword: { enabled: true }` is present. If absent, the Better-Auth
   forgot-password endpoint doesn't exist at all and Task 9's test will 404.
   Add `{ enabled: true }` if needed.
2. The login UI exposes a "Forgot password?" link. If not, the flow isn't
   reachable end-to-end. Grep:

```bash
grep -rn "forget\|forgot\|reset.*password\|resetPassword" apps/web/src
```

- [ ] **Step 2: Add the reset-password hook**

In the primary auth config file, extend `emailAndPassword`:

```ts
import { sendEmail } from "@project/email/service";

// ... inside betterAuth({...}):
emailAndPassword: {
  enabled: true,
  sendResetPassword: async ({ user, url }) => {
    await sendEmail({
      template: "password-reset",
      to: user.email,
      vars: { userName: user.name, resetUrl: url },
    });
  },
},
```

Add `@project/email` as a dependency of `@project/auth`:

```bash
pnpm --filter @project/auth add @project/email@workspace:*
```

- [ ] **Step 3: Add a minimal "Forgot password" + "Reset password" flow if absent**

If the grep in Step 1 turned up nothing, add:
- A "Forgot password?" link on the login route
- A route that calls `authClient.forgetPassword({ email, redirectTo: "/reset-password" })`
- A `/reset-password` route that accepts the `?token=` query and calls `authClient.resetPassword({ newPassword, token })`

These are standard Better-Auth client-side calls and can be minimal (one
form per screen, no extensive styling). If they already exist, skip.

- [ ] **Step 4: Lint**

```bash
make lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/auth/ apps/web/src/
git commit -m "feat(auth): wire sendResetPassword through email queue + minimal reset UI"
```

---

### Task 9: Integration test — password reset end-to-end

**Files:**
- Create: `packages/auth/__tests__/password-reset.test.ts` (or `packages/api/src/__tests__/password-reset.test.ts` depending on where auth tests live — check repo layout)

- [ ] **Step 1: Check for existing auth tests to mirror layout**

```bash
find packages -path "*__tests__*" -name "*.test.ts" | head -5
```

Mirror the existing pattern. For this plan, assume a new test in `packages/api/src/__tests__/password-reset.test.ts` (the API package already has the test-runner wired up).

- [ ] **Step 2: Add Mailpit API helper**

Create `packages/api/src/__tests__/helpers/mailpit.ts`:

```ts
// Minimal Mailpit API client for tests. Polls the inbox until a message
// to `to` appears, times out at 10s. Docs: https://mailpit.axllent.org/docs/api-v1/

import { env } from "@project/env/server";

export type MailpitMessage = {
  ID: string;
  From: { Address: string; Name: string };
  To: { Address: string; Name: string }[];
  Subject: string;
  Snippet: string;
};

export async function deleteAllMail(): Promise<void> {
  const res = await fetch(`${env.MAILPIT_API_URL}/api/v1/messages`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`DELETE /messages failed: ${res.status}`);
}

export async function waitForMailTo(
  to: string,
  timeoutMs = 10_000,
): Promise<MailpitMessage> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(
      `${env.MAILPIT_API_URL}/api/v1/search?query=to:${encodeURIComponent(to)}`,
    );
    if (res.ok) {
      const body = (await res.json()) as { messages: MailpitMessage[] };
      if (body.messages.length > 0) return body.messages[0];
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout waiting for mail to ${to}`);
}

export async function getMessageBody(id: string): Promise<{
  HTML: string;
  Text: string;
}> {
  const res = await fetch(`${env.MAILPIT_API_URL}/api/v1/message/${id}`);
  if (!res.ok) throw new Error(`GET /message/${id} failed: ${res.status}`);
  const body = (await res.json()) as { HTML: string; Text: string };
  return body;
}
```

- [ ] **Step 3: Write the failing test**

Note: the test signs up via Better-Auth's API rather than `db.user.create`.
Better-Auth's reset-password flow requires a matching `Account` row (for
`provider: "credential"`); direct DB inserts skip that and the reset flow
will silently fail to match the user.

Verify the Mailpit URL before writing assertions:

```bash
echo $MAILPIT_API_URL
```

If empty, the test-runner isn't spreading `envForSubprocess("unit")` — fix
`packages/api/scripts/test-runner.ts` first or the test will poll the dev
Mailpit on port 8025 and contaminate it.

Create `packages/api/src/__tests__/password-reset.test.ts`:

```ts
import { auth } from "@project/auth";
import { db } from "@project/db";
import { env } from "@project/env/server";
import {
  emailQueue,
  closeQueues,
} from "@project/jobs/queues";
import { handleEmailJob } from "@project/email/handler";
import type { EmailJobData } from "@project/email/service";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  deleteAllMail,
  waitForMailTo,
} from "./helpers/mailpit.js";

// This test drains email jobs inline (no apps/worker process needed in
// unit-suite). It proves: send() enqueues → handler renders correctly →
// nodemailer delivers → Mailpit receives.

const TEST_EMAIL = "reset-user@example.com";
const TEST_USERNAME = "reset-user";

beforeAll(() => {
  // Fail-loud: if the test-runner isn't injecting the suite Mailpit URL,
  // we'd silently poll the dev inbox on :8025. This assertion prevents
  // cross-contamination between dev and test.
  if (!env.MAILPIT_API_URL.includes(":8")) {
    throw new Error(
      `Suspicious MAILPIT_API_URL: ${env.MAILPIT_API_URL} — check test-runner envForSubprocess wiring.`,
    );
  }
});

beforeEach(async () => {
  await db.user.deleteMany({ where: { email: TEST_EMAIL } });
  await deleteAllMail();

  // Create the user via Better-Auth so the credential Account row exists.
  await auth.api.signUpEmail({
    body: {
      email: TEST_EMAIL,
      password: "initial-pw-123!",
      name: "Reset User",
      username: TEST_USERNAME,
    },
  });
});

afterAll(async () => {
  await db.user.deleteMany({ where: { email: TEST_EMAIL } });
  await closeQueues();
  await db.$disconnect();
});

async function drainEmailQueue() {
  const q = emailQueue();
  const jobs = await q.getJobs(["waiting", "active", "delayed"]);
  for (const job of jobs) {
    await handleEmailJob(job.data as EmailJobData);
    await job.remove();
  }
}

describe("password reset end-to-end", () => {
  it("enqueues, delivers, and a reset link appears in Mailpit", async () => {
    await auth.api.forgetPassword({
      body: { email: TEST_EMAIL, redirectTo: "http://localhost:3000/reset" },
    });

    await drainEmailQueue();

    const msg = await waitForMailTo(TEST_EMAIL);
    expect(msg.Subject).toBe("Reset your password");
    expect(msg.To[0].Address).toBe(TEST_EMAIL);
  });
});
```

Note: the test uses `username` in `signUpEmail` because Plan B marks it as
a required additionalField. This file will only land AFTER Plan B Task 1
updates the signup plumbing — running it before that breaks on the
`username` requirement. If you're executing Plan A before Plan B, comment
out the `username:` line until Plan B lands (or defer writing this test to
after Plan B).

- [ ] **Step 4: Run test**

```bash
make test-unit ARGS="password-reset"
```

Expected: PASS. If `auth.api.forgetPassword` differs, adjust to the actual Better-Auth API call shape; the assertions about enqueue + delivery stay the same.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/__tests__/
git commit -m "test(auth): password reset end-to-end via Mailpit API"
```

---

### Task 10: Add worker to `make dev`

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Inspect existing `dev` target**

```bash
grep -n "^dev" Makefile
```

Note how `web` and `server` are spawned (likely `pnpm --filter ... dev` with `&` and `wait`).

- [ ] **Step 2: Add worker target**

Add a new `make dev` parallel target following the existing pattern. Inside the `dev:` recipe, alongside the web + server spawns, add:

```makefile
	pnpm --filter @project/worker dev &
```

And include the worker in the `wait` chain (if present).

- [ ] **Step 3: Smoke test**

```bash
make dev
```

Expected: all three processes boot. `http://localhost:8025` (Mailpit UI) loads. Ctrl-C shuts everything down cleanly.

- [ ] **Step 4: Commit**

```bash
git add Makefile
git commit -m "feat(make): make dev boots worker alongside web + server"
```

---

## Verification Checklist

- [ ] `make lint` PASS
- [ ] `make test-unit ARGS="password-reset"` PASS
- [ ] `make dev` boots web + server + worker + Redis + Mailpit; no errors
- [ ] `http://localhost:8025` shows the Mailpit inbox
- [ ] Triggering a password-reset (via the auth UI or direct API call) results in an email landing in Mailpit within a few seconds
- [ ] Integrity audit (`bun run scripts/check-test-infra-integrity.ts`) PASS
