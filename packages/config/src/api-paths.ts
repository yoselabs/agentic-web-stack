// Hono mount paths. Both server and client must agree:
// - Server registers handlers at these paths (apps/server/src/index.ts)
// - Client builds base URLs using these paths (apps/web/src/shared/api-client.ts — added in Task 5)

export const TRPC_MOUNT = "/trpc";
export const AUTH_MOUNT = "/api/auth";
