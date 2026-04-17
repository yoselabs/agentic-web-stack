// Port numbers for dev and test environments. Dev values are stable
// (hardcoded on purpose so bookmarks, OAuth callbacks, and browser
// storage scopes don't break between worktrees). Test values are also
// stable but separate from dev so both can run simultaneously.
//
// The TEST DB port is hash-derived per worktree — that lives in
// scripts/test-db.ts, not here. This file covers app-level ports only.

export const DEV_DB_PORT = 5432;
export const DEV_WEB_PORT = 3000;
export const DEV_API_PORT = 3001;

export const TEST_WEB_PORT = 3100;
export const TEST_API_PORT = 3101;
