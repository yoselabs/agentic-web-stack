// Auth domain constants. Client-safe (no runtime imports, just primitives).
// Consumed by:
// - packages/auth/src/index.ts (Better-Auth minPasswordLength)
// - apps/web/src/routes/login.tsx (HTML <input minLength>)

export const MIN_PASSWORD_LENGTH = 8;
