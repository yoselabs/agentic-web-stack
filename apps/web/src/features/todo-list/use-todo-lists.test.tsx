import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTodoLists } from "./use-todo-lists";

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (msg: string) => toastSuccess(msg),
    error: (msg: string) => toastError(msg),
  },
}));

const LIST_KEY = ["todoList", "listAccessible"] as const;

type CreateVars = { name: string };
type DeleteVars = { id: string };

function makeTrpcStub(mutations: {
  create: (v: CreateVars) => Promise<unknown>;
  delete: (v: DeleteVars) => Promise<unknown>;
}) {
  return {
    todoList: {
      listAccessible: {
        queryOptions: () => ({
          queryKey: LIST_KEY,
          queryFn: () => Promise.resolve([] as unknown[]),
        }),
        queryFilter: () => ({ queryKey: LIST_KEY }),
      },
      create: {
        mutationOptions: (opts: Record<string, unknown>) => ({
          mutationKey: ["create"],
          mutationFn: mutations.create,
          ...opts,
        }),
      },
      delete: {
        mutationOptions: (opts: Record<string, unknown>) => ({
          mutationKey: ["delete"],
          mutationFn: mutations.delete,
          ...opts,
        }),
      },
    },
  } as unknown as Parameters<typeof useTodoLists>[0];
}

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe("useTodoLists", () => {
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
  });

  it("exposes newName state and setter", () => {
    const trpc = makeTrpcStub({
      create: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    });
    const { result } = renderHook(() => useTodoLists(trpc, qc), {
      wrapper: wrapperFor(qc),
    });
    expect(result.current.newName).toBe("");
    act(() => result.current.setNewName("shopping"));
    expect(result.current.newName).toBe("shopping");
  });

  it("handleSubmit no-ops on empty/whitespace-only name", () => {
    const createFn = vi.fn().mockResolvedValue(undefined);
    const trpc = makeTrpcStub({
      create: createFn,
      delete: vi.fn().mockResolvedValue(undefined),
    });
    const { result } = renderHook(() => useTodoLists(trpc, qc), {
      wrapper: wrapperFor(qc),
    });
    const evt = {
      preventDefault: vi.fn(),
    } as unknown as Parameters<typeof result.current.handleSubmit>[0];
    act(() => result.current.handleSubmit(evt));
    expect(createFn).not.toHaveBeenCalled();

    act(() => result.current.setNewName("   "));
    act(() => result.current.handleSubmit(evt));
    expect(createFn).not.toHaveBeenCalled();
  });

  it("handleSubmit trims and fires createTodoList; success resets name + toasts", async () => {
    const createFn = vi.fn().mockResolvedValue({ id: "new" });
    const trpc = makeTrpcStub({
      create: createFn,
      delete: vi.fn().mockResolvedValue(undefined),
    });
    const { result } = renderHook(() => useTodoLists(trpc, qc), {
      wrapper: wrapperFor(qc),
    });
    act(() => result.current.setNewName("  shopping  "));
    const evt = {
      preventDefault: vi.fn(),
    } as unknown as Parameters<typeof result.current.handleSubmit>[0];
    await act(async () => {
      result.current.handleSubmit(evt);
    });
    expect(evt.preventDefault).toHaveBeenCalled();
    await waitFor(() => expect(createFn).toHaveBeenCalledTimes(1));
    expect(createFn.mock.calls[0]?.[0]).toEqual({ name: "shopping" });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("List created"),
    );
    expect(result.current.newName).toBe("");
  });

  it("deleteTodoList drops the item optimistically before the server responds", async () => {
    // Keep the mutation pending so we can observe the optimistic state.
    let resolveDelete: (v: unknown) => void = () => {};
    const deleteFn = vi.fn(
      () =>
        new Promise((res) => {
          resolveDelete = res;
        }),
    );
    const trpc = makeTrpcStub({
      create: vi.fn().mockResolvedValue(undefined),
      delete: deleteFn,
    });
    qc.setQueryData(LIST_KEY, [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ]);
    const { result } = renderHook(() => useTodoLists(trpc, qc), {
      wrapper: wrapperFor(qc),
    });
    act(() => {
      result.current.deleteTodoList.mutate({ id: "a" });
    });
    await waitFor(() => {
      const data = qc.getQueryData<{ id: string }[]>(LIST_KEY);
      expect(data?.map((l) => l.id)).toEqual(["b"]);
    });
    resolveDelete(undefined);
  });

  it("deleteTodoList toasts an error on server failure", async () => {
    const deleteFn = vi.fn().mockRejectedValueOnce(new Error("boom"));
    const trpc = makeTrpcStub({
      create: vi.fn().mockResolvedValue(undefined),
      delete: deleteFn,
    });
    qc.setQueryData(LIST_KEY, [{ id: "a", name: "A" }]);
    const { result } = renderHook(() => useTodoLists(trpc, qc), {
      wrapper: wrapperFor(qc),
    });
    await act(async () => {
      result.current.deleteTodoList.mutate({ id: "a" });
    });
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Failed to delete list"),
    );
  });
});
