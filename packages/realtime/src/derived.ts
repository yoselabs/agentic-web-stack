// Client-derived state primitive — "client knows first, server eventually agrees."
//
// Use for values that every client can compute locally from its own activity
// signals (presence, typing indicator, cursor, draft, focus state). Built on
// `useSyncExternalStore` + `BroadcastChannel` + `navigator.locks` so that:
//
//   1. A single tab (the lock leader) drives `compute()` each tick and
//      broadcasts the result; passive tabs subscribe to the broadcast.
//   2. Activity events re-trigger compute immediately (leader) and invalidate
//      the cached value on followers via broadcast.
//   3. Server mirrors are written by the leader tab only (callers wire that
//      side effect in `compute` or a subscriber — this primitive is pure state).
//
// SSR-safe: `typeof window === "undefined"` short-circuits to the initial
// value and a no-op subscribe. The hook still runs safely during SSR hydration.
//
// Tests: drive `MockDerivedSource` directly — `set()` to push values,
// `advanceTime(ms)` to step the virtual clock. No `BroadcastChannel` or
// `navigator.locks` polyfill needed.
//
// This primitive is infrastructure — no hook in this template consumes it yet.
// Motivating consumer is `useSelfPresence`, which will land with the chat
// domain. See `docs/conventions.md` § "Client-derived state via
// @project/realtime/derived".

import { useSyncExternalStore } from "react";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DerivedCompute<T> = (lastActivityAt: number, now: number) => T;

export interface CreateDerivedSourceConfig<T> {
  /**
   * Stable identifier shared across tabs. Used as both the BroadcastChannel
   * name and the Web Lock key — tabs with the same `key` elect one leader.
   */
  key: string;
  /** Initial value used during SSR and before the first compute. */
  initial: T;
  /**
   * DOM events on `document` that count as activity. Each event resets the
   * internal `lastActivityAt` clock and triggers an immediate recompute on
   * the leader tab.
   */
  activityEvents: (keyof DocumentEventMap)[];
  /**
   * Pure function of `(lastActivityAt, now)` → value. Called by the leader
   * on each activity event and every `tickMs`. Must be deterministic for
   * given inputs — side effects (server writes) should live in a subscriber,
   * not here.
   */
  compute: DerivedCompute<T>;
  /** Interval in ms between periodic re-evaluations on the leader. */
  tickMs: number;
}

export interface DerivedSource<T> {
  /** React hook — returns the current derived value, subscribed via useSyncExternalStore. */
  hook: () => T;
  /**
   * Deterministic in-memory implementation mirroring the real source's
   * observable surface. Exposed on the real source too so that test harnesses
   * can swap it in via DI without branching on `IS_TEST`.
   */
  mock: MockDerivedSource<T>;
}

// ---------------------------------------------------------------------------
// Mock — deterministic in-memory implementation for tests
// ---------------------------------------------------------------------------

export class MockDerivedSource<T> {
  private value: T;
  private subscribers = new Set<() => void>();
  private virtualNow: number;
  private lastActivityAt: number;
  private readonly computeFn: DerivedCompute<T>;
  private readonly tickMs: number;

  constructor(opts: {
    initial: T;
    compute?: DerivedCompute<T>;
    tickMs?: number;
    now?: number;
  }) {
    this.value = opts.initial;
    this.computeFn = opts.compute ?? (() => opts.initial);
    this.tickMs = opts.tickMs ?? 1000;
    this.virtualNow = opts.now ?? 0;
    this.lastActivityAt = this.virtualNow;
  }

  get(): T {
    return this.value;
  }

  /** Push a value directly; notifies subscribers. */
  set(next: T): void {
    this.value = next;
    this.notify();
  }

  /** Simulate a DOM activity event: resets `lastActivityAt`, recomputes. */
  activity(): void {
    this.lastActivityAt = this.virtualNow;
    this.recompute();
  }

  /**
   * Advance the virtual clock by `ms`, firing any tick recomputes that cross
   * a `tickMs` boundary. Each boundary calls `compute()` once.
   */
  advanceTime(ms: number): void {
    const target = this.virtualNow + ms;
    while (this.virtualNow < target) {
      const step = Math.min(this.tickMs, target - this.virtualNow);
      this.virtualNow += step;
      if (step === this.tickMs || this.virtualNow === target) {
        this.recompute();
      }
    }
  }

  subscribe(cb: () => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  private recompute(): void {
    const next = this.computeFn(this.lastActivityAt, this.virtualNow);
    if (!Object.is(next, this.value)) {
      this.value = next;
      this.notify();
    }
  }

  private notify(): void {
    for (const s of this.subscribers) s();
  }
}

// ---------------------------------------------------------------------------
// Live implementation — BroadcastChannel + navigator.locks + setInterval
// ---------------------------------------------------------------------------

type BroadcastMessage<T> = { t: "value"; v: T } | { t: "ping" };

interface LeaderRuntime {
  tickHandle: ReturnType<typeof setInterval> | null;
  activityCleanup: Array<() => void>;
  stop: () => void;
}

class LiveDerivedSource<T> {
  private value: T;
  private lastActivityAt: number;
  private readonly subscribers = new Set<() => void>();
  private readonly config: CreateDerivedSourceConfig<T>;
  private bc: BroadcastChannel | null = null;
  private leader: LeaderRuntime | null = null;
  private subscriberCount = 0;
  private started = false;

  constructor(config: CreateDerivedSourceConfig<T>) {
    this.config = config;
    this.value = config.initial;
    this.lastActivityAt = Date.now();
  }

  get = (): T => this.value;

  subscribe = (cb: () => void): (() => void) => {
    this.subscribers.add(cb);
    this.subscriberCount++;
    if (!this.started) this.start();
    return () => {
      this.subscribers.delete(cb);
      this.subscriberCount--;
      if (this.subscriberCount === 0) this.stop();
    };
  };

  private start(): void {
    this.started = true;
    // BroadcastChannel may be missing in some test environments; guard defensively.
    if (typeof BroadcastChannel !== "undefined") {
      this.bc = new BroadcastChannel(this.config.key);
      this.bc.onmessage = (ev: MessageEvent) => {
        const data = ev.data as BroadcastMessage<T> | undefined;
        if (data?.t === "value") this.setValue(data.v);
      };
    }
    void this.acquireLeadership();
  }

  private stop(): void {
    this.started = false;
    this.leader?.stop();
    this.leader = null;
    if (this.bc) {
      this.bc.close();
      this.bc = null;
    }
  }

  private setValue(next: T): void {
    if (!Object.is(next, this.value)) {
      this.value = next;
      for (const cb of this.subscribers) cb();
    }
  }

  private recompute(): void {
    const now = Date.now();
    const next = this.config.compute(this.lastActivityAt, now);
    this.setValue(next);
    this.bc?.postMessage({ t: "value", v: next } satisfies BroadcastMessage<T>);
  }

  private async acquireLeadership(): Promise<void> {
    const locks = (
      typeof navigator !== "undefined" ? navigator.locks : undefined
    ) as LockManager | undefined;
    if (!locks) {
      // No Web Locks API — every tab becomes its own leader. Acceptable
      // degradation: compute still runs, only the "single writer" guarantee
      // weakens.
      this.becomeLeader();
      return;
    }
    // Request an exclusive lock held for the lifetime of this source. When
    // this tab closes, the lock is released and another tab's pending request
    // resolves — seamless leader handoff.
    void locks.request(this.config.key, { mode: "exclusive" }, async () => {
      this.becomeLeader();
      await new Promise<void>((resolve) => {
        const originalStop = this.leader?.stop ?? (() => undefined);
        if (this.leader) {
          this.leader.stop = () => {
            originalStop();
            resolve();
          };
        } else {
          resolve();
        }
      });
    });
  }

  private becomeLeader(): void {
    const activityCleanup: Array<() => void> = [];
    const onActivity = (): void => {
      this.lastActivityAt = Date.now();
      this.recompute();
    };
    if (typeof document !== "undefined") {
      for (const evt of this.config.activityEvents) {
        document.addEventListener(evt, onActivity, { passive: true });
        activityCleanup.push(() =>
          document.removeEventListener(evt, onActivity),
        );
      }
    }
    const tickHandle = setInterval(() => this.recompute(), this.config.tickMs);
    // Kick off with an immediate compute so followers see a fresh value.
    this.recompute();
    this.leader = {
      tickHandle,
      activityCleanup,
      stop: () => {
        if (tickHandle) clearInterval(tickHandle);
        for (const c of activityCleanup) c();
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a client-derived state source. Returns a React hook and a Mock
 * twin. The mock is always created (cheap, in-memory) so test harnesses can
 * inject it uniformly — no `IS_TEST` branching at call sites.
 *
 * SSR: on the server, `hook()` returns `initial` and `subscribe` is a no-op.
 */
export function createDerivedSource<T>(
  config: CreateDerivedSourceConfig<T>,
): DerivedSource<T> {
  const isBrowser = typeof window !== "undefined";
  const mock = new MockDerivedSource<T>({
    initial: config.initial,
    compute: config.compute,
    tickMs: config.tickMs,
  });

  if (!isBrowser) {
    const hook = (): T =>
      useSyncExternalStore(
        () => () => undefined,
        () => config.initial,
        () => config.initial,
      );
    return { hook, mock };
  }

  const live = new LiveDerivedSource<T>(config);
  const hook = (): T =>
    useSyncExternalStore(live.subscribe, live.get, () => config.initial);
  return { hook, mock };
}
