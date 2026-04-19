// Owner OR collaborator can read/update. Only owner can delete.
// Membership check is done at service level (service fetches the
// membership row before issuing the authz check) — CASL conditions
// over collection relations aren't expressive enough for this shape.

import type { AbilityBuilder } from "@casl/ability";
import type { AppAbility, SessionUser } from "../types.js";

export function applyTodoRules(
  { can }: AbilityBuilder<AppAbility>,
  user: SessionUser | null,
): void {
  if (!user) return;
  can("manage", "TodoList", { userId: user.id });
  can("manage", "Todo", { userId: user.id });
}
