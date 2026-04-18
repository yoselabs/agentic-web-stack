// Todo domain constants. Client-safe primitives only — never import
// server modules (services, Prisma) from this file; if you do, the
// web bundle will silently pull in server code.
//
// Consumed by:
// - apps/server/src/index.ts (upload size enforcement)
// - apps/web/src/features/todo/use-todos.ts (client-side pre-flight)
//
// NOTE: this file moves to packages/api/src/domains/todo/constants.ts
// in the API domain-split refactor (see superpowers/plans/...-zero-conf...).

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
