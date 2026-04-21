// Shared types for the `scripts/check-*.ts` family.
//
// Each check is its own turbo task (`//#lint:check:<name>`) with narrow
// `inputs` globs matching what the script actually scans. Each script
// exports a `check<Name>(): Promise<CheckResult>` + a CLI guard via
// `if (import.meta.main)` so `bun scripts/check-<name>.ts` runs
// standalone.
//
// Adding a new check:
//   1. Create `scripts/check-<name>.ts` exporting `check<Name>()`.
//   2. Add root script `"lint:check:<name>": "bun scripts/check-<name>.ts"`.
//   3. Add turbo task `"//#lint:check:<name>"` with narrow inputs globs.
//   4. Add `lint:check:<name>` to `TURBO_LINT_TASKS` in Makefile.

export type CheckResult = {
  name: string;
  ok: boolean;
  errors: string[]; // free-form lines; prefer `file:line: message` where applicable
  durationMs: number;
};

/**
 * Helper to time a check body and shape its errors into a CheckResult.
 * Catches thrown errors and surfaces them as a single error line.
 */
export async function timeCheck(
  name: string,
  body: () => Promise<string[]> | string[],
): Promise<CheckResult> {
  const start = performance.now();
  try {
    const errors = await body();
    return {
      name,
      ok: errors.length === 0,
      errors,
      durationMs: performance.now() - start,
    };
  } catch (err) {
    return {
      name,
      ok: false,
      errors: [
        `threw: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      ],
      durationMs: performance.now() - start,
    };
  }
}
