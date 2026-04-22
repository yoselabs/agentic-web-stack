import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLeaderTab } from "./use-leader-tab";

type BcInstance = {
  name: string;
  postMessage: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onmessage: ((evt: { data: unknown }) => void) | null;
};

const bcInstances: BcInstance[] = [];

class FakeBroadcastChannel {
  postMessage = vi.fn();
  close = vi.fn();
  onmessage: ((evt: { data: unknown }) => void) | null = null;
  constructor(public name: string) {
    bcInstances.push(this as unknown as BcInstance);
  }
}

describe("useLeaderTab", () => {
  let releaseHeldLock: (() => void) | null = null;
  let lockRequestMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    bcInstances.length = 0;
    releaseHeldLock = null;

    Object.defineProperty(globalThis, "BroadcastChannel", {
      value: FakeBroadcastChannel,
      writable: true,
      configurable: true,
    });

    lockRequestMock = vi.fn(
      (_name: string, _opts: unknown, cb: () => Promise<void>) => {
        return cb();
      },
    );
    Object.defineProperty(globalThis, "navigator", {
      value: { locks: { request: lockRequestMock } },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    releaseHeldLock?.();
  });

  it("stays non-leader and skips BroadcastChannel when userId is null", () => {
    const { result } = renderHook(() => useLeaderTab(null));
    expect(result.current.isLeader).toBe(false);
    expect(bcInstances).toHaveLength(0);
    expect(lockRequestMock).not.toHaveBeenCalled();
  });

  it("elects itself leader when the Web Lock is granted", async () => {
    lockRequestMock.mockImplementationOnce(
      (_name: string, _opts: unknown, cb: () => Promise<void>) => {
        // Hold the lock open — leader callback resolves when we release it.
        return new Promise<void>((resolve) => {
          releaseHeldLock = () => resolve();
          void cb().then(resolve);
        });
      },
    );
    const { result } = renderHook(() => useLeaderTab("u1"));
    await waitFor(() => expect(result.current.isLeader).toBe(true));
    expect(bcInstances).toHaveLength(1);
    expect(bcInstances[0]?.name).toBe("leader-relay:u1");
  });

  it("falls back to leader=true when Web Locks are unavailable", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: {},
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => useLeaderTab("u1"));
    expect(result.current.isLeader).toBe(true);
  });

  it("broadcast() posts to the channel; onMessage dispatches incoming events", async () => {
    lockRequestMock.mockImplementationOnce(
      (_n: string, _o: unknown, cb: () => Promise<void>) =>
        new Promise<void>((resolve) => {
          releaseHeldLock = () => resolve();
          void cb().then(resolve);
        }),
    );
    const { result } = renderHook(() => useLeaderTab("u1"));
    await waitFor(() => expect(result.current.isLeader).toBe(true));

    const handler = vi.fn();
    const unsubscribe = result.current.onMessage(handler);

    act(() => result.current.broadcast({ hello: "world" }));
    expect(bcInstances[0]?.postMessage).toHaveBeenCalledWith({
      hello: "world",
    });

    act(() => {
      bcInstances[0]?.onmessage?.({ data: { foo: 1 } });
    });
    expect(handler).toHaveBeenCalledWith({ foo: 1 });

    unsubscribe();
    act(() => {
      bcInstances[0]?.onmessage?.({ data: { foo: 2 } });
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("closes the channel and drops leadership on unmount", async () => {
    lockRequestMock.mockImplementationOnce(
      (_n: string, _o: unknown, cb: () => Promise<void>) =>
        new Promise<void>((resolve) => {
          releaseHeldLock = () => resolve();
          void cb().then(resolve);
        }),
    );
    const { result, unmount } = renderHook(() => useLeaderTab("u1"));
    await waitFor(() => expect(result.current.isLeader).toBe(true));
    unmount();
    expect(bcInstances[0]?.close).toHaveBeenCalled();
  });
});
