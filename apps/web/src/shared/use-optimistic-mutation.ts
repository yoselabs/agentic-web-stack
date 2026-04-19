// Adds optimistic snapshot/rollback to any existing tRPC-backed mutation.
// Call site stays idiomatic:
//
//   const { trpc } = Route.useRouteContext();
//   const queryClient = useQueryClient();
//   const mutation = useMutation(trpc.todo.update.mutationOptions({
//     onSuccess: () => queryClient.invalidateQueries(
//       trpc.todo.list.queryFilter({ todoListId }),
//     ),
//   }));
//
//   const optimistic = useOptimisticMutation(mutation, {
//     queryFilter: trpc.todo.list.queryFilter({ todoListId }),
//     applyOptimistic: (prev, input) => prev?.map((t) =>
//       t.id === input.id ? { ...t, ...input.patch } : t
//     ),
//     errorMessage: "Failed to update todo",
//   });
//
//   optimistic.run({ id: "...", patch: { completed: true } });
//
// setQueryData's callback type via tRPC's proxy is fragile (see
// apps/web/CLAUDE.md); consumers narrow their TQueryData explicitly.

import { type QueryFilters, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

type MutationLike<TInput, TOutput> = {
  mutateAsync: (input: TInput) => Promise<TOutput>;
  isPending: boolean;
};

export function useOptimisticMutation<TInput, TOutput, TQueryData>(
  mutation: MutationLike<TInput, TOutput>,
  options: {
    queryFilter: QueryFilters;
    applyOptimistic: (
      previous: TQueryData | undefined,
      input: TInput,
    ) => TQueryData | undefined;
    errorMessage?: string;
  },
) {
  const queryClient = useQueryClient();

  async function run(input: TInput): Promise<TOutput | null> {
    await queryClient.cancelQueries(options.queryFilter);
    const previous = queryClient.getQueryData<TQueryData>(
      options.queryFilter.queryKey ?? [],
    );
    queryClient.setQueryData<TQueryData>(
      options.queryFilter.queryKey ?? [],
      (old) => options.applyOptimistic(old, input),
    );
    try {
      return await mutation.mutateAsync(input);
    } catch (err) {
      queryClient.setQueryData<TQueryData>(
        options.queryFilter.queryKey ?? [],
        previous,
      );
      toast.error(options.errorMessage ?? "Failed to save");
      throw err;
    } finally {
      queryClient.invalidateQueries(options.queryFilter);
    }
  }

  return { run, isPending: mutation.isPending };
}
