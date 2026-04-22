import type { ReactNode } from "react";

/**
 * Slot contract for the top-level `Navbar` shell.
 *
 * Every visible affordance the navbar renders is a typed key. A call site that
 * forgets a required affordance (e.g. the Pitch-5A notifications drop) becomes
 * a `tsc -b` error instead of a silent regression.
 *
 * Keep required slots non-optional. Use `?` only for role-gated affordances
 * (e.g. admin-only jobs link) that are structurally absent for most users.
 *
 * See ADR-0004 (`docs/adrs/0004-ui-shell-slots.md`).
 */
export type NavbarSlots = {
  logo: ReactNode;
  /** Desktop primary navigation (empty fragment when logged out). */
  primaryLinks: ReactNode;
  /** Admin-only links (jobs admin, etc.). Omit when the viewer is not an admin. */
  adminActions?: ReactNode;
  /** User affordance — UserBlock when authed, Sign-In button when not. */
  user: ReactNode;
  /** Mobile hamburger / drawer. Always rendered; visibility is CSS-gated. */
  mobileNav: ReactNode;
};

export function Navbar({ slots }: { slots: NavbarSlots }) {
  return (
    <nav className="flex items-center justify-between border-b px-6 py-3">
      {/* Desktop */}
      <div className="flex items-center gap-6">
        {slots.logo}
        <div className="hidden items-center gap-6 md:flex">
          {slots.primaryLinks}
        </div>
      </div>

      <div className="hidden items-center gap-4 md:flex">
        {slots.adminActions}
        {slots.user}
      </div>

      <div className="md:hidden">{slots.mobileNav}</div>
    </nav>
  );
}
