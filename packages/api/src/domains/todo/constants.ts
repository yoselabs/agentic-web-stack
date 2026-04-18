// Todo domain constants. Client-safe primitives only — never import
// server modules (services, Prisma) from this file; if you do, the
// web bundle will silently pull in server code.
//
// Consumed by:
// - packages/api/src/domains/todo/http.ts (multipart validation)

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

export const CSV_MIME_TYPES: ReadonlySet<string> = new Set([
  "text/csv",
  "application/vnd.ms-excel",
]);
