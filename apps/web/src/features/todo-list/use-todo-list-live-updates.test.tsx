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
  // Save the onData callback so the test can invoke it as a fake server event.
  const parsed = opts as { onData?: (d: unknown) => void };
  if (parsed?.onData) capturedOnData = parsed.onData;
});

let capturedOnMessage: ((data: unknown) => void) | null = null;
const broadcastMock = vi.fn();
vi.mock("./use-leader-tab", () => ({
  useLeaderTab: (userId: string | null) => ({
    isLeader: userId === "leader",
    broadcast: broadcastMock,
    onMessage: (handler: (data: unknown) => void) => {
      capturedOnMessage = handler;
      return () => {
        capturedOnMessage = null;
      };
    },
  }),
}));

const handlers: Record<string, ReturnType<typeof vi.fn>> = {
  "todo-created": vi.fn(),
  "todo-updated": vi.fn(),
  "todo-deleted": vi.fn(),
  "todos-reordered": vi.fn(),
  "todos-imported": vi.fn(),
  "todo-list-updated": vi.fn(),
  "todo-list-collaborator-added": vi.fn(),
  "todo-list-collaborator-removed": vi.fn(),
};
vi.mock("./event-handlers", () => ({
  eventHandlers: new Proxy(handlers, {
    get: (target, prop: string) => target[prop],
  }),
}));

const { useTodoListLiveUpdates } = await import("./use-todo-list-live-updates");

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

const TRPC_STUB = {
  todoList: {
    onListEvent: {
      subscriptionOptions: (_input: unknown, opts: unknown) => opts,
    },
  },
} as unknown as Parameters<typeof useTodoListLiveUpdates>[0];

describe("useTodoListLiveUpdates", () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient();
    capturedOnData = null;
    capturedOnMessage = null;
    broadcastMock.mockReset();
    for (const fn of Object.values(handlers)) fn.mockReset();
  });

  it("leader path: subscription onData dispatches + broadcasts to peers", () => {
    renderHook(() => useTodoListLiveUpdates(TRPC_STUB, "list-1", "leader"), {
      wrapper: wrapperFor(qc),
    });
    const event = { kind: "todo-created", listId: "list-1" };
    act(() => {
      capturedOnData?.(event);
    });
    expect(handlers["todo-created"]).toHaveBeenCalledTimes(1);
    expect(broadcastMock).toHaveBeenCalledWith({ __relay: true, event });
  });

  it("peer path: relay messages dispatch the event locally", () => {
    renderHook(() => useTodoListLiveUpdates(TRPC_STUB, "list-1", "peer"), {
      wrapper: wrapperFor(qc),
    });
    const event = { kind: "todo-updated", listId: "list-1" };
    act(() => {
      capturedOnMessage?.({ __relay: true, event });
    });
    expect(handlers["todo-updated"]).toHaveBeenCalledTimes(1);
  });

  it("peer path: ignores messages without __relay flag", () => {
    renderHook(() => useTodoListLiveUpdates(TRPC_STUB, "list-1", "peer"), {
      wrapper: wrapperFor(qc),
    });
    act(() => {
      capturedOnMessage?.({ event: { kind: "todo-created" } });
    });
    for (const fn of Object.values(handlers)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("peer path: ignores events with unknown kinds", () => {
    renderHook(() => useTodoListLiveUpdates(TRPC_STUB, "list-1", "peer"), {
      wrapper: wrapperFor(qc),
    });
    act(() => {
      capturedOnMessage?.({
        __relay: true,
        event: { kind: "bogus-kind" },
      });
    });
    for (const fn of Object.values(handlers)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("peer path: rejects non-object / nullish payloads without throwing", () => {
    renderHook(() => useTodoListLiveUpdates(TRPC_STUB, "list-1", "peer"), {
      wrapper: wrapperFor(qc),
    });
    act(() => {
      capturedOnMessage?.(null);
      capturedOnMessage?.("string");
      capturedOnMessage?.(42);
    });
    for (const fn of Object.values(handlers)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});
