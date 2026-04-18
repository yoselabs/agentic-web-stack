// Todo domain constants. Client-safe primitives only — never import
// server modules (services, Prisma) from this file; if you do, the
// web bundle will silently pull in server code.
//
// Consumed by:
// - apps/server/src/index.ts (upload size enforcement)
// - apps/web/src/features/todo/use-todos.ts (client-side pre-flight)

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
