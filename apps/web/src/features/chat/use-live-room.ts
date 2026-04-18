import { TYPING_CLIENT_EXPIRY_MS } from "@project/api/domains/chat/constants";
import type { AppRouter } from "@project/api/router";
import { type QueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "./types";

type TypingMap = Map<string, number>; // userId -> expiresAt (epoch ms)

export function useLiveRoom(
  trpc: TRPCOptionsProxy<AppRouter>,
  queryClient: QueryClient,
  roomId: string,
) {
  const messagesQuery = useQuery(
    trpc.chat.messages.list.queryOptions({ roomId }),
  );
  const presenceQuery = useQuery(
    trpc.chat.presence.list.queryOptions({ roomId }),
  );

  const [typing, setTyping] = useState<TypingMap>(new Map());
  const lastSeenIdRef = useRef<string | null>(null);

  useSubscription({
    ...trpc.chat.subscribeRoom.subscriptionOptions({ roomId }),
    onData: (ev) => {
      if (ev.type === "message:new") {
        lastSeenIdRef.current = ev.data.id;
        queryClient.setQueryData<ChatMessage[]>(
          trpc.chat.messages.list.queryFilter({ roomId }).queryKey,
          (old) => {
            if (!old) return [ev.data as ChatMessage];
            if (old.some((m) => m.id === ev.data.id)) return old;
            return [ev.data as ChatMessage, ...old];
          },
        );
      } else if (ev.type === "typing:start") {
        setTyping((prev) => {
          const next = new Map(prev);
          next.set(ev.data.userId, Date.now() + TYPING_CLIENT_EXPIRY_MS);
          return next;
        });
      } else if (ev.type === "typing:stop") {
        setTyping((prev) => {
          const next = new Map(prev);
          next.delete(ev.data.userId);
          return next;
        });
      } else if (ev.type === "presence:enter" || ev.type === "presence:leave") {
        queryClient.invalidateQueries(
          trpc.chat.presence.list.queryFilter({ roomId }),
        );
      }
    },
  });

  // Expire stale typing indicators every second
  useEffect(() => {
    const t = setInterval(() => {
      setTyping((prev) => {
        const now = Date.now();
        let mutated = false;
        const next = new Map(prev);
        for (const [uid, exp] of prev) {
          if (exp <= now) {
            next.delete(uid);
            mutated = true;
          }
        }
        return mutated ? next : prev;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const sendText = useMutation(trpc.chat.messages.sendText.mutationOptions());
  const sendFile = useMutation(trpc.chat.messages.sendFile.mutationOptions());
  const typingStart = useMutation(trpc.chat.typing.start.mutationOptions());
  const typingStop = useMutation(trpc.chat.typing.stop.mutationOptions());
  const markRead = useMutation(trpc.chat.messages.markRead.mutationOptions());

  return {
    messagesQuery,
    presenceQuery,
    typingUserIds: Array.from(typing.keys()),
    sendText,
    sendFile,
    typingStart,
    typingStop,
    markRead,
    lastSeenId: lastSeenIdRef,
  };
}
