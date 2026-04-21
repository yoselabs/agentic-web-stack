import { afterEach, beforeEach, vi } from "vitest";

/**
 * Explicit list of globals to fake. Deliberately omits `queueMicrotask`
 * — faking it breaks React 19's scheduler (microtask-based act batching)
 * and leads to tests that hang or lose updates. See ADR-0003.
 */
export const DEFAULT_FAKE_TIMER_APIS = [
  "setInterval",
  "clearInterval",
  "setTimeout",
  "clearTimeout",
  "Date",
  "performance",
] as const;

export type FakeTimerApi = (typeof DEFAULT_FAKE_TIMER_APIS)[number];

export type WithFakeTimersOptions = {
  toFake?: readonly FakeTimerApi[];
  /** Epoch or Date to pin `Date.now()` / `new Date()` at. */
  now?: number | Date;
};

/**
 * Installs `vi.useFakeTimers` for every test in the enclosing describe
 * block. Defaults to the React-19-safe fake list (no queueMicrotask).
 *
 * Usage:
 *   describe("ticker", () => {
 *     withFakeTimers();
 *     it("advances every second", () => { vi.advanceTimersByTime(1000); });
 *   });
 */
export function withFakeTimers(options: WithFakeTimersOptions = {}): void {
  const toFake = options.toFake ?? DEFAULT_FAKE_TIMER_APIS;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: [...toFake] });
    if (options.now !== undefined) {
      vi.setSystemTime(options.now);
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });
}
