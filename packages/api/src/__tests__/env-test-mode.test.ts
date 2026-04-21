import { describe, expect, it } from "bun:test";
import { env } from "@project/env/server";

// Regression: prove the test harness detection contract works end-to-end.
//
// Contract (see docs/conventions.md "Test-mode detection"):
//   - Unit/integration suites run under Vitest / bun test. The runner
//     natively sets `process.env.VITEST=true`, so `env.IS_TEST` must be
//     true in this file just by virtue of it executing.
//   - The test harness MUST NOT override NODE_ENV. Vite SSR flips
//     `jsxDEV` imports on NODE_ENV and setting it to "test" breaks the
//     built web bundle used by e2e. Our e2e harness uses `TEST_MODE=1`
//     instead (set by `envForSubprocess` in @project/test-infra).
describe("env.IS_TEST", () => {
  it("is true when running under the test harness", () => {
    expect(env.IS_TEST).toBe(true);
  });

  it("does not come from NODE_ENV — NODE_ENV stays development or production", () => {
    // The unit test-runner spreads `envForSubprocess("unit")` on top of
    // `process.env`. That spread does NOT include NODE_ENV, so whatever
    // was inherited (normally "development") is preserved. We assert the
    // negative invariant to catch a future regression where someone adds
    // `NODE_ENV: "test"` to envForSubprocess (or a package.json script).
    expect(env.NODE_ENV).not.toBe("test");
  });
});
