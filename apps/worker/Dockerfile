# syntax=docker/dockerfile:1-labs
FROM node:22-slim AS builder
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/ packages/
RUN corepack enable
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY apps/worker apps/worker
RUN pnpm --filter @project/worker build

FROM node:22-slim
WORKDIR /app
COPY --from=builder /app/apps/worker/dist ./dist
COPY --from=builder /app/apps/worker/package.json ./
COPY --from=builder /app/node_modules ./node_modules

RUN groupadd --system app && useradd --system --gid app app
USER app

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
            CMD node -e "process.exit(0)" || exit 1

CMD ["node", "dist/index.js"]
