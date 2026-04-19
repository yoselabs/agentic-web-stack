// Async generator backing the user.onInboxEvent subscription. Mirrors
// subscribeToListEvents (todo-list/events.ts) but without authz
// cascade — the user's own inbox is always readable by the session
// owner. Session revocation tears down the WS at the auth layer.

import type { Channel } from "@project/realtime/types";
import type { UserInboxEvent } from "./user-events.js";

export async function* subscribeToUserInbox(
  ch: Channel<UserInboxEvent>,
  signal?: AbortSignal,
): AsyncGenerator<UserInboxEvent> {
  const buffer: UserInboxEvent[] = [];
  let resolveNext: (() => void) | null = null;

  const unsub = await ch.subscribe((event) => {
    buffer.push(event);
    resolveNext?.();
    resolveNext = null;
  });

  try {
    while (true) {
      while (buffer.length > 0) {
        // biome-ignore lint/style/noNonNullAssertion: length guard above
        const event = buffer.shift()!;
        yield event;
      }
      if (signal?.aborted) return;
      await new Promise<void>((resolve) => {
        resolveNext = resolve;
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    }
  } finally {
    unsub();
  }
}
