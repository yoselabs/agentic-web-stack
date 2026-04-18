import type { AppRouter } from "@project/api/router";
import { type QueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";

export function useChatRooms(
  trpc: TRPCOptionsProxy<AppRouter>,
  queryClient: QueryClient,
) {
  const roomsQuery = useQuery(trpc.chat.rooms.listMine.queryOptions());

  // Refresh the sidebar when we get a cross-room event.
  useSubscription({
    ...trpc.chat.subscribeUser.subscriptionOptions(),
    onData: () => {
      queryClient.invalidateQueries(trpc.chat.rooms.listMine.queryFilter());
    },
  });

  const createGroup = useMutation(
    trpc.chat.rooms.createGroup.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries(trpc.chat.rooms.listMine.queryFilter()),
    }),
  );

  const dmFindOrCreate = useMutation(
    trpc.chat.rooms.dmFindOrCreate.mutationOptions(),
  );

  return { roomsQuery, createGroup, dmFindOrCreate };
}
