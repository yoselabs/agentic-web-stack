// Owner-only rules (CASL). Collaborator access is enforced imperatively
// in the service via `canReadList` / membership lookups — CASL's
// conditions language can't express "user is in related-rows of X"
// cleanly, so service-layer checks are the canonical authz path for
// collaborator access.

import type { AbilityBuilder } from "@casl/ability";
import type { AppAbility, SessionUser } from "../../authz/types.js";

export function applyTodoRules(
  { can }: AbilityBuilder<AppAbility>,
  user: SessionUser | null,
): void {
  if (!user) return;
  can("manage", "TodoList", { userId: user.id });
  can("manage", "Todo", { userId: user.id });
}
