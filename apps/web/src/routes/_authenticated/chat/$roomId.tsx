import { env } from "@project/env/client";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useSession } from "#/features/auth/auth-client";
import { MessageComposer } from "#/features/chat/components/MessageComposer";
import { MessageList } from "#/features/chat/components/MessageList";
import { RoomListSidebar } from "#/features/chat/components/RoomListSidebar";
import { UserSearchDialog } from "#/features/chat/components/UserSearchDialog";
import { useChatRooms } from "#/features/chat/use-chat-rooms";
import { useLiveRoom } from "#/features/chat/use-live-room";

export const Route = createFileRoute("/_authenticated/chat/$roomId")({
  component: ChatRoomPage,
});

function ChatRoomPage() {
  const navigate = useNavigate();
  const { roomId } = Route.useParams();
  const { trpc } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const [search, setSearch] = useState(false);

  useEffect(() => {
    if (!env.VITE_ENABLE_CHAT) navigate({ to: "/dashboard" });
  }, [navigate]);

  const { roomsQuery, dmFindOrCreate } = useChatRooms(trpc, queryClient);
  const live = useLiveRoom(trpc, queryClient, roomId);

  if (!env.VITE_ENABLE_CHAT) return null;
  if (!session) return null;

  return (
    <main className="flex h-[calc(100vh-4rem)]">
      <RoomListSidebar
        rooms={roomsQuery.data ?? []}
        currentUserId={session.user.id}
        onStartDm={() => setSearch(true)}
      />
      <section className="flex flex-1 flex-col">
        <MessageList
          messages={live.messagesQuery.data ?? []}
          typingUserIds={live.typingUserIds}
        />
        <MessageComposer
          roomId={roomId}
          onSendText={(text) => live.sendText.mutateAsync({ roomId, text })}
          onSendFile={(fileId) => live.sendFile.mutateAsync({ roomId, fileId })}
          onTypingStart={() => live.typingStart.mutate({ roomId })}
          onTypingStop={() => live.typingStop.mutate({ roomId })}
        />
      </section>
      <UserSearchDialog
        trpc={trpc}
        open={search}
        onClose={() => setSearch(false)}
        onPick={async (u) => {
          const { id } = await dmFindOrCreate.mutateAsync({
            otherUserId: u.userId,
          });
          setSearch(false);
          navigate({ to: "/chat/$roomId" as string, params: { roomId: id } });
        }}
      />
    </main>
  );
}
