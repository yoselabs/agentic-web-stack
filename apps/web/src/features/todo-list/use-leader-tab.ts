// Leader-tab election via Web Locks + event relay via BroadcastChannel.
//
// Only the leader opens the WebSocket (tRPC subscription); peers receive
// events via BroadcastChannel. The election is delegated to the browser
// via navigator.locks — this is correct by construction (no heartbeat
// race, no double-leader, unload handled automatically when the tab
// closes and releases the lock).
//
// Contract for callers:
//   - isLeader: stable boolean; flips at most twice per mount (false→true
//     on acquire, true→false never during a mount — when leader tab closes
//     the promise-held lock releases and a peer promotes on its own hook
//     re-run).
//   - broadcast(data): leader calls this with events to relay to peers.
//   - onMessage(handler): peers register; returns unsubscribe.
//
// All functions are stable across renders (useRef-backed) so dependent
// effects don't re-subscribe on every render.

import { useCallback, useEffect, useRef, useState } from "react";

export function useLeaderTab(userId: string | null): {
  isLeader: boolean;
  broadcast: (data: unknown) => void;
  onMessage: (handler: (data: unknown) => void) => () => void;
} {
  const [isLeader, setIsLeader] = useState(false);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const handlersRef = useRef<Set<(data: unknown) => void>>(new Set());

  useEffect(() => {
    if (!userId) return;

    // BroadcastChannel for event relay — separate from election.
    const bcName = `leader-relay:${userId}`;
    const bc =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel(bcName)
        : null;
    channelRef.current = bc;

    if (bc) {
      bc.onmessage = (evt) => {
        for (const h of [...handlersRef.current]) h(evt.data);
      };
    }

    // Web Locks election. If unavailable (SSR, very old browsers), every
    // tab acts as leader — correct but wasteful.
    const hasWebLocks =
      typeof navigator !== "undefined" &&
      typeof navigator.locks?.request === "function";

    if (!hasWebLocks) {
      setIsLeader(true);
      return () => {
        bc?.close();
        channelRef.current = null;
      };
    }

    let cancelled = false;
    let releaseLock: (() => void) | null = null;

    navigator.locks.request(
      `leader-tab:${userId}`,
      { mode: "exclusive" },
      () =>
        new Promise<void>((resolve) => {
          if (cancelled) {
            resolve();
            return;
          }
          releaseLock = () => resolve();
          setIsLeader(true);
        }),
    );

    return () => {
      cancelled = true;
      setIsLeader(false);
      releaseLock?.();
      bc?.close();
      channelRef.current = null;
    };
  }, [userId]);

  const broadcast = useCallback((data: unknown) => {
    try {
      channelRef.current?.postMessage(data);
    } catch {
      // Channel may be closed during unmount — ignore.
    }
  }, []);

  const onMessage = useCallback(
    (handler: (data: unknown) => void): (() => void) => {
      handlersRef.current.add(handler);
      return () => {
        handlersRef.current.delete(handler);
      };
    },
    [],
  );

  return { isLeader, broadcast, onMessage };
}
