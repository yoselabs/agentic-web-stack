// Tests for useActivityFeed — the hook combining a paginated query
// with a tracked subscription. The query and subscription are both
// mocked so this stays a unit test: we drive `onData` directly and
// assert the merged output.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useSubscriptionMock = vi.fn();
vi.mock("@trpc/tanstack-react-query", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@trpc/tanstack-react-query",
  );
  return {
    ...actual,
    useSubscription: (...args: unknown[]) => useSubscriptionMock(...args),
  };
});

let capturedOnData: ((data: unknown) => void) | null = null;
useSubscriptionMock.mockImplementation((opts: unknown) => {
  const parsed = opts as { onData?: (d: unknown) => void };
  if (parsed?.onData) capturedOnData = parsed.onData;
});

const { useActivityFeed } = await import("./use-activity-feed");

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

// Minimal trpc proxy stub — only the paths the hook reads. The
// queryKey returns a stable tuple; subscriptionOptions just forwards
// options into the mocked `useSubscription`.
const TRPC_STUB = {
  activity: {
    list: {
      queryOptions: (input: unknown) => ({
        queryKey: ["activity", "list", input],
        queryFn: async () => ({ items: [], nextCursor: null }),
      }),
      queryKey: (input: unknown) => ["activity", "list", input],
    },
    onListEvents: {
      subscriptionOptions: (_input: unknown, opts: unknown) => opts,
    },
  },
} as unknown as Parameters<typeof useActivityFeed>[0];

function seedInitial(
  qc: QueryClient,
  listId: string,
  items: Array<{ id: string; payload: { kind: string } }>,
) {
  qc.setQueryData(["activity", "list", { todoListId: listId }], {
    items,
    nextCursor: null,
  });
}

describe("useActivityFeed", () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
      },
    });
    capturedOnData = null;
  });

  it("returns the initial page while the subscription is idle", () => {
    seedInitial(qc, "list-1", [
      { id: "e2", payload: { kind: "todo-created" } },
      { id: "e1", payload: { kind: "todo-created" } },
    ]);
    const { result } = renderHook(() => useActivityFeed(TRPC_STUB, "list-1"), {
      wrapper: wrapperFor(qc),
    });
    expect(result.current.events.map((e) => e.id)).toEqual(["e2", "e1"]);
  });

  it("prepends a live event delivered via the tracked subscription", () => {
    seedInitial(qc, "list-1", [
      { id: "e1", payload: { kind: "todo-created" } },
    ]);
    const { result } = renderHook(() => useActivityFeed(TRPC_STUB, "list-1"), {
      wrapper: wrapperFor(qc),
    });
    act(() => {
      capturedOnData?.({
        kind: "event",
        event: { id: "e2", payload: { kind: "todo-created" } },
      });
    });
    expect(result.current.events.map((e) => e.id)).toEqual(["e2", "e1"]);
  });

  it("dedups live events that overlap the initial page", () => {
    seedInitial(qc, "list-1", [
      { id: "e1", payload: { kind: "todo-created" } },
    ]);
    const { result } = renderHook(() => useActivityFeed(TRPC_STUB, "list-1"), {
      wrapper: wrapperFor(qc),
    });
    act(() => {
      capturedOnData?.({
        kind: "event",
        event: { id: "e1", payload: { kind: "todo-created" } },
      });
    });
    expect(result.current.events.map((e) => e.id)).toEqual(["e1"]);
  });

  it("clears the live buffer on resync and invalidates the query", () => {
    seedInitial(qc, "list-1", [
      { id: "e1", payload: { kind: "todo-created" } },
    ]);
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useActivityFeed(TRPC_STUB, "list-1"), {
      wrapper: wrapperFor(qc),
    });
    act(() => {
      capturedOnData?.({
        kind: "event",
        event: { id: "e2", payload: { kind: "todo-created" } },
      });
    });
    expect(result.current.events.map((e) => e.id)).toEqual(["e2", "e1"]);
    act(() => {
      capturedOnData?.({ kind: "resync", reason: "gap-too-large" });
    });
    expect(result.current.events.map((e) => e.id)).toEqual(["e1"]);
    expect(invalidateSpy).toHaveBeenCalled();
  });
});
