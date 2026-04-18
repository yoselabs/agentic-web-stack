// Admin rule: role === "admin" grants access to the AdminDashboard subject.
// AdminDashboard is an abstract string subject — no DB row is wrapped.

import type { AbilityBuilder } from "@casl/ability";
import type { AppAbility, SessionUser } from "../types.js";

export function applyAdminRules(
  { can }: AbilityBuilder<AppAbility>,
  user: SessionUser | null,
): void {
  if (user?.role === "admin") {
    can("access", "AdminDashboard");
  }
}
