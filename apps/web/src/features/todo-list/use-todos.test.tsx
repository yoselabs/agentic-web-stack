import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (m: string) => toastSuccess(m),
    error: (m: string) => toastError(m),
  },
}));

const importPost = vi.fn();
const exportGet = vi.fn();
vi.mock("#/features/todo-list/todo-http-client", () => ({
  todoHttpClient: {
    import: { $post: (args: unknown) => importPost(args) },
    export: { $get: (args: unknown) => exportGet(args) },
  },
}));

const { useTodos } = await import("./use-todos");

const LIST_ID = "list-1";
const listKey = ["todo", "list", { todoListId: LIST_ID }] as const;

type CreateVars = { todoListId: string; title: string };
type CompleteVars = { id: string };
type DeleteVars = { id: string };
type ReorderVars = { todoListId: string; ids: string[] };

type Fns = {
  create: (v: CreateVars) => Promise<unknown>;
  complete: (v: CompleteVars) => Promise<unknown>;
  deleteTodo: (v: DeleteVars) => Promise<unknown>;
  reorder: (v: ReorderVars) => Promise<unknown>;
};

function makeTrpcStub(fns: Fns) {
  const mo = (name: string, fn: (...a: unknown[]) => Promise<unknown>) => ({
    mutationOptions: (opts: Record<string, unknown>) => ({
      mutationKey: [name],
      mutationFn: fn,
      ...opts,
    }),
  });
  return {
    todo: {
      list: {
        queryOptions: () => ({
          queryKey: listKey,
          queryFn: () =>
            Promise.resolve([
              { id: "1", title: "a", completed: false, position: 0 },
              { id: "2", title: "b", completed: false, position: 1 },
              { id: "3", title: "c", completed: true, position: 2 },
            ]),
        }),
        queryFilter: () => ({ queryKey: listKey }),
      },
      create: mo("create", fns.create as (...a: unknown[]) => Promise<unknown>),
      complete: mo(
        "complete",
        fns.complete as (...a: unknown[]) => Promise<unknown>,
      ),
      delete: mo(
        "delete",
        fns.deleteTodo as (...a: unknown[]) => Promise<unknown>,
      ),
      reorder: mo(
        "reorder",
        fns.reorder as (...a: unknown[]) => Promise<unknown>,
      ),
    },
  } as unknown as Parameters<typeof useTodos>[0];
}

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe("useTodos", () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    toastSuccess.mockReset();
    toastError.mockReset();
    importPost.mockReset();
    exportGet.mockReset();
  });

  it("splits todos into active/completed buckets from cache", async () => {
    qc.setQueryData(listKey, [
      { id: "1", title: "a", completed: false, position: 0 },
      { id: "2", title: "b", completed: true, position: 1 },
    ]);
    const trpc = makeTrpcStub({
      create: vi.fn().mockResolvedValue({}),
      complete: vi.fn().mockResolvedValue({}),
      deleteTodo: vi.fn().mockResolvedValue({}),
      reorder: vi.fn().mockResolvedValue({}),
    });
    const { result } = renderHook(() => useTodos(trpc, qc, LIST_ID), {
      wrapper: wrapperFor(qc),
    });
    expect(result.current.activeTodos.map((t) => t.id)).toEqual(["1"]);
    expect(result.current.completedTodos.map((t) => t.id)).toEqual(["2"]);
  });

  it("handleSubmit trims and fires createTodo with {title, todoListId}", async () => {
    const createFn = vi.fn().mockResolvedValue({});
    const trpc = makeTrpcStub({
      create: createFn,
      complete: vi.fn().mockResolvedValue({}),
      deleteTodo: vi.fn().mockResolvedValue({}),
      reorder: vi.fn().mockResolvedValue({}),
    });
    const { result } = renderHook(() => useTodos(trpc, qc, LIST_ID), {
      wrapper: wrapperFor(qc),
    });
    act(() => result.current.setNewTitle("  milk  "));
    const evt = {
      preventDefault: vi.fn(),
    } as unknown as Parameters<typeof result.current.handleSubmit>[0];
    await act(async () => {
      result.current.handleSubmit(evt);
    });
    expect(evt.preventDefault).toHaveBeenCalled();
    await waitFor(() => expect(createFn).toHaveBeenCalledTimes(1));
    expect(createFn.mock.calls[0]?.[0]).toEqual({
      title: "milk",
      todoListId: LIST_ID,
    });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Todo added"),
    );
    expect(result.current.newTitle).toBe("");
  });

  it("handleSubmit no-ops on whitespace-only title", () => {
    const createFn = vi.fn().mockResolvedValue({});
    const trpc = makeTrpcStub({
      create: createFn,
      complete: vi.fn().mockResolvedValue({}),
      deleteTodo: vi.fn().mockResolvedValue({}),
      reorder: vi.fn().mockResolvedValue({}),
    });
    const { result } = renderHook(() => useTodos(trpc, qc, LIST_ID), {
      wrapper: wrapperFor(qc),
    });
    act(() => result.current.setNewTitle("   "));
    const evt = {
      preventDefault: vi.fn(),
    } as unknown as Parameters<typeof result.current.handleSubmit>[0];
    act(() => result.current.handleSubmit(evt));
    expect(createFn).not.toHaveBeenCalled();
  });

  it("handleDragEnd reorders active todos optimistically and fires reorder()", async () => {
    qc.setQueryData(listKey, [
      { id: "1", title: "a", completed: false, position: 0 },
      { id: "2", title: "b", completed: false, position: 1 },
      { id: "3", title: "c", completed: true, position: 2 },
    ]);
    const reorderFn = vi.fn().mockResolvedValue({});
    const trpc = makeTrpcStub({
      create: vi.fn().mockResolvedValue({}),
      complete: vi.fn().mockResolvedValue({}),
      deleteTodo: vi.fn().mockResolvedValue({}),
      reorder: reorderFn,
    });
    const { result } = renderHook(() => useTodos(trpc, qc, LIST_ID), {
      wrapper: wrapperFor(qc),
    });
    act(() => {
      result.current.handleDragEnd({
        active: { id: "1" },
        over: { id: "2" },
      } as Parameters<typeof result.current.handleDragEnd>[0]);
    });
    await waitFor(() => expect(reorderFn).toHaveBeenCalledTimes(1));
    expect(reorderFn.mock.calls[0]?.[0]).toEqual({
      todoListId: LIST_ID,
      ids: ["2", "1"],
    });
    const cached =
      qc.getQueryData<{ id: string; completed: boolean; position: number }[]>(
        listKey,
      );
    expect(cached?.map((t) => t.id)).toEqual(["2", "1", "3"]);
  });

  it("handleDragEnd no-ops on same-id drop or unknown target", () => {
    const reorderFn = vi.fn().mockResolvedValue({});
    const trpc = makeTrpcStub({
      create: vi.fn().mockResolvedValue({}),
      complete: vi.fn().mockResolvedValue({}),
      deleteTodo: vi.fn().mockResolvedValue({}),
      reorder: reorderFn,
    });
    const { result } = renderHook(() => useTodos(trpc, qc, LIST_ID), {
      wrapper: wrapperFor(qc),
    });
    act(() => {
      result.current.handleDragEnd({
        active: { id: "1" },
        over: { id: "1" },
      } as Parameters<typeof result.current.handleDragEnd>[0]);
    });
    act(() => {
      result.current.handleDragEnd({
        active: { id: "1" },
        over: null,
      } as Parameters<typeof result.current.handleDragEnd>[0]);
    });
    expect(reorderFn).not.toHaveBeenCalled();
  });

  it("importTodos posts a FormData payload and toasts on success", async () => {
    importPost.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ count: 3 }),
    });
    const trpc = makeTrpcStub({
      create: vi.fn().mockResolvedValue({}),
      complete: vi.fn().mockResolvedValue({}),
      deleteTodo: vi.fn().mockResolvedValue({}),
      reorder: vi.fn().mockResolvedValue({}),
    });
    const { result } = renderHook(() => useTodos(trpc, qc, LIST_ID), {
      wrapper: wrapperFor(qc),
    });
    const file = new File(["a,b\n1,2"], "todos.csv");
    await act(async () => {
      await result.current.importTodos.mutateAsync(file);
    });
    expect(importPost).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith("Imported 3 todos");
  });

  it("importTodos surfaces server error message", async () => {
    importPost.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: "bad csv" }),
    });
    const trpc = makeTrpcStub({
      create: vi.fn().mockResolvedValue({}),
      complete: vi.fn().mockResolvedValue({}),
      deleteTodo: vi.fn().mockResolvedValue({}),
      reorder: vi.fn().mockResolvedValue({}),
    });
    const { result } = renderHook(() => useTodos(trpc, qc, LIST_ID), {
      wrapper: wrapperFor(qc),
    });
    const file = new File([""], "x.csv");
    await act(async () => {
      await result.current.importTodos.mutateAsync(file).catch(() => undefined);
    });
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("bad csv"));
  });
});
