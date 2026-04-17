// Domain limits shared between client and server. Changing any value here
// must automatically propagate to every consumer (UI validation, server
// enforcement, error messages).

// Maximum file size for CSV todo imports. Enforced server-side at
// apps/server/src/index.ts upload handler, and also client-side in
// apps/web/src/features/todo/use-todos.ts so users get immediate
// feedback instead of a 413 after a long upload.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

// Minimum length for Better-Auth passwords. Enforced in both the
// HTML <input minLength> attribute (apps/web/src/routes/login.tsx) and
// in Better-Auth's emailAndPassword.minPasswordLength option
// (packages/auth/src/index.ts).
export const MIN_PASSWORD_LENGTH = 8;
