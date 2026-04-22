import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebouncedValue } from "./use-debounced-value";

describe("useDebouncedValue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns initial value synchronously", () => {
    const { result } = renderHook(() => useDebouncedValue("a", 100));
    expect(result.current).toBe("a");
  });

  it("delays emitting a new value until the timer fires", () => {
    const { result, rerender } = renderHook(
      ({ v }: { v: string }) => useDebouncedValue(v, 100),
      { initialProps: { v: "a" } },
    );
    rerender({ v: "b" });
    expect(result.current).toBe("a");
    act(() => vi.advanceTimersByTime(99));
    expect(result.current).toBe("a");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe("b");
  });

  it("collapses rapid updates into one emission (last write wins)", () => {
    const { result, rerender } = renderHook(
      ({ v }: { v: string }) => useDebouncedValue(v, 100),
      { initialProps: { v: "a" } },
    );
    rerender({ v: "b" });
    act(() => vi.advanceTimersByTime(50));
    rerender({ v: "c" });
    act(() => vi.advanceTimersByTime(50));
    expect(result.current).toBe("a");
    act(() => vi.advanceTimersByTime(50));
    expect(result.current).toBe("c");
  });
});
