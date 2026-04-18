// Todo rules — the baseline. Expanded in Plan C with membership rules
// when TodoListMembership lands. For now: a user can manage their own
// todos/lists (owner-only model).

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
