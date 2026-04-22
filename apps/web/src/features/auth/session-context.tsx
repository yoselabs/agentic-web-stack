import { createContext, type ReactNode, useContext } from "react";
import { useSession as useBetterAuthSession } from "./auth-client";

// biome-ignore lint/suspicious/noExplicitAny: session shape is Better-Auth's; widening to `any` here avoids dragging internal pnpm paths into the public API surface and matches how the auth-client re-exports it.
type BetterAuthSession = any;

export type AppSession = {
  data: BetterAuthSession | null;
  isPending: boolean;
};

/**
 * Session context. Must be provided — either by `<RealSessionBridge>`
 * (production) or `<SessionProvider>` (stories/tests). Missing provider
 * is a programmer error, not a runtime fallback.
 */
const SessionContext = createContext<AppSession | null>(null);

/**
 * Production wrapper: reads Better-Auth's `useSession()` and publishes
 * the result through the context so downstream components don't call
 * the Better-Auth hook directly. Swap-out point for stories/tests.
 */
export function RealSessionBridge({ children }: { children: ReactNode }) {
  const real = useBetterAuthSession() as AppSession;
  return (
    <SessionContext.Provider value={real}>{children}</SessionContext.Provider>
  );
}

/**
 * Story/test wrapper: inject a fixed session value. No network, no
 * Better-Auth runtime.
 */
export function SessionProvider({
  value,
  children,
}: {
  value: AppSession;
  children: ReactNode;
}) {
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

/**
 * Session accessor used by app components. Throws if no provider is
 * mounted — surfacing the miss immediately instead of silently returning
 * a fake-null.
 */
export function useAppSession(): AppSession {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error(
      "useAppSession requires a <RealSessionBridge> or <SessionProvider> ancestor.",
    );
  }
  return value;
}
