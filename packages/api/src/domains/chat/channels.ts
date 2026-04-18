import { z } from "zod";
import { defineChannel } from "../../realtime/channel.js";

const MessagePayload = z.object({
  id: z.string(),
  roomId: z.string(),
  userId: z.string(),
  kind: z.enum(["TEXT", "FILE"]),
  text: z.string().nullable(),
  fileId: z.string().nullable(),
  createdAt: z.date(),
});

export const roomChannel = defineChannel({
  name: (roomId: string) => `chat:room:${roomId}`,
  events: {
    "message:new": MessagePayload,
    "typing:start": z.object({ roomId: z.string(), userId: z.string() }),
    "typing:stop": z.object({ roomId: z.string(), userId: z.string() }),
    "presence:enter": z.object({ roomId: z.string(), userId: z.string() }),
    "presence:leave": z.object({ roomId: z.string(), userId: z.string() }),
  },
});

export const userChannel = defineChannel({
  name: (userId: string) => `user:${userId}`,
  events: {
    "unread:nudge": z.object({ roomId: z.string() }),
    "room:invited": z.object({ roomId: z.string() }),
  },
});
