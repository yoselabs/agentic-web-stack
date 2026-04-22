import type { Prisma } from "@project/db";
import { channel as defaultChannel } from "@project/realtime/channel";
import type { Channel } from "@project/realtime/types";
import {
  activityChannelKey,
  type ActivityEventPayload,
  type ActivityEventRecord,
} from "../activity-feed/events.js";
import { recordActivityEvent } from "../activity-feed/service.js";

export type ActivityChannelProvider = (
  key: string,
) => Channel<ActivityEventRecord>;

const defaultActivityProvider: ActivityChannelProvider = (k) =>
  defaultChannel<ActivityEventRecord>(k);

// Insert the activity row inside the same transaction as the triggering
// mutation. Publish only happens after the row is committed — callers use
// publishActivity below. Ordering is load-bearing: publishing before commit
// would let a reconnecting subscriber's gap-fill query miss the row while
// it already received the live event, breaking dedup.
export async function emitActivity(
  tx: Prisma.TransactionClient,
  input: { todoListId: string; actorId: string; payload: ActivityEventPayload },
): Promise<ActivityEventRecord> {
  return recordActivityEvent(tx, input);
}

export async function publishActivity(
  event: ActivityEventRecord,
  provider: ActivityChannelProvider = defaultActivityProvider,
): Promise<void> {
  await provider(activityChannelKey(event.todoListId)).publish(event);
}
