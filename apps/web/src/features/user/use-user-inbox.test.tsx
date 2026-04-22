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
let capturedOnStarted: (() => void) | null = null;
useSubscriptionMock.mockImplementation((opts: unknown) => {
  const parsed = opts as {
    onData?: (d: unknown) => void;
    onStarted?: () => void;
  };
  if (parsed?.onData) capturedOnData = parsed.onData;
  if (parsed?.onStarted) capturedOnStarted = parsed.onStarted;
});

let capturedOnMessage: ((data: unknown) => void) | null = null;
const broadcastMock = vi.fn();
vi.mock("#/features/todo-list/use-leader-tab", () => ({
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
  "todo-list-counters-changed": vi.fn(),
  "todo-list-access-granted": vi.fn(),
  "todo-list-access-revoked": vi.fn(),
  "todo-list-invites-changed": vi.fn(),
};
vi.mock("./event-handlers", () => ({
  eventHandlers: new Proxy(handlers, {
    get: (target, prop: string) => target[prop],
  }),
}));

const { useUserInbox } = await import("./use-user-inbox");

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

const TRPC_STUB = {
  todoList: {
    list: { queryFilter: () => ({ queryKey: ["todoList", "list"] }) },
    listAccessible: {
      queryFilter: () => ({ queryKey: ["todoList", "listAccessible"] }),
    },
    myPendingInvites: {
      queryFilter: () => ({ queryKey: ["todoList", "myPendingInvites"] }),
    },
  },
  user: {
    onInboxEvent: {
      subscriptionOptions: (_input: unknown, opts: unknown) => opts,
    },
  },
} as unknown as Parameters<typeof useUserInbox>[0];

describe("useUserInbox", () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient();
    capturedOnData = null;
    capturedOnStarted = null;
    capturedOnMessage = null;
    broadcastMock.mockReset();
    for (const fn of Object.values(handlers)) fn.mockReset();
  });

  it("onStarted invalidates the three bootstrap queries", () => {
    const spy = vi.spyOn(qc, "invalidateQueries");
    renderHook(() => useUserInbox(TRPC_STUB, "leader"), {
      wrapper: wrapperFor(qc),
    });
    act(() => capturedOnStarted?.());
    const keys = spy.mock.calls.map(
      (c) => (c[0] as { queryKey: unknown }).queryKey,
    );
    expect(keys).toContainEqual(["todoList", "list"]);
    expect(keys).toContainEqual(["todoList", "listAccessible"]);
    expect(keys).toContainEqual(["todoList", "myPendingInvites"]);
  });

  it("leader path: onData dispatches + broadcasts to peers", () => {
    renderHook(() => useUserInbox(TRPC_STUB, "leader"), {
      wrapper: wrapperFor(qc),
    });
    const event = { kind: "todo-list-counters-changed", listId: "list-1" };
    act(() => capturedOnData?.(event));
    expect(handlers["todo-list-counters-changed"]).toHaveBeenCalledTimes(1);
    expect(broadcastMock).toHaveBeenCalledWith({
      __userInboxRelay: true,
      event,
    });
  });

  it("peer path: relay messages dispatch the event locally", () => {
    renderHook(() => useUserInbox(TRPC_STUB, "peer"), {
      wrapper: wrapperFor(qc),
    });
    const event = { kind: "todo-list-access-granted", listId: "list-1" };
    act(() => capturedOnMessage?.({ __userInboxRelay: true, event }));
    expect(handlers["todo-list-access-granted"]).toHaveBeenCalledTimes(1);
  });

  it("peer path: rejects messages without __userInboxRelay", () => {
    renderHook(() => useUserInbox(TRPC_STUB, "peer"), {
      wrapper: wrapperFor(qc),
    });
    act(() =>
      capturedOnMessage?.({
        event: { kind: "todo-list-access-granted", listId: "l" },
      }),
    );
    for (const fn of Object.values(handlers)) expect(fn).not.toHaveBeenCalled();
  });

  it("peer path: rejects unknown kinds", () => {
    renderHook(() => useUserInbox(TRPC_STUB, "peer"), {
      wrapper: wrapperFor(qc),
    });
    act(() =>
      capturedOnMessage?.({
        __userInboxRelay: true,
        event: { kind: "bogus" },
      }),
    );
    for (const fn of Object.values(handlers)) expect(fn).not.toHaveBeenCalled();
  });
});
