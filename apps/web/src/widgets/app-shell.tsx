import type { ReactNode } from "react";

/**
 * Slot contract for the application-wide shell. Composes the persistent
 * navigation chrome with the active route's main content.
 *
 * This intentionally accepts `main` as a typed slot instead of `children`:
 * the free-form `children` channel is exactly how the Pitch-5A notifications
 * badge went missing (mounted one layer above the shell, so nothing
 * complained). A named slot forces each call site to name what it is placing.
 *
 * Future additions (sidebar, toasts region, breadcrumbs bar, command palette
 * slot) land here as new typed keys — optional or required per the spec for
 * that affordance.
 *
 * See ADR-0004 (`docs/adrs/0004-ui-shell-slots.md`).
 */
export type AppShellSlots = {
  /** Top-level navigation, typically `<Navbar slots={...} />`. */
  nav: ReactNode;
  /** Active route content. Must be a typed slot — never `children`. */
  main: ReactNode;
};

export function AppShell({ slots }: { slots: AppShellSlots }) {
  return (
    <>
      {slots.nav}
      {slots.main}
    </>
  );
}
