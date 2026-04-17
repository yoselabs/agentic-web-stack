// Intentionally empty. @project/env has two entry points:
// - @project/env/server  (server-only env: DATABASE_URL, BETTER_AUTH_SECRET, ...)
// - @project/env/client  (client-safe env: VITE_API_URL)
//
// Do NOT add a barrel export here. The split-brain design prevents
// server-only env vars from leaking into the client bundle. Importing
// from "@project/env" (the barrel) without a subpath is a lint error.
//
// See docs/superpowers/specs/2026-04-18-config-ssot-audit-design.md
// and root CLAUDE.md "Single source of truth (SSOT)" rule.
export {};
