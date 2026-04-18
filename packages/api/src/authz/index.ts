// Single-call ability composer. Every HTTP request resolves through here.
//
// Usage:
//   const ability = abilityFor(session?.user ?? null);
//   if (ability.cannot("access", "AdminDashboard")) throw ...;
//   db.todoList.findMany({ where: accessibleBy(ability).TodoList });

import { AbilityBuilder } from "@casl/ability";
import { createPrismaAbility } from "@casl/prisma";
import { applyAdminRules } from "./rules/admin.js";
import { applyTodoRules } from "./rules/todo.js";
import type { AppAbility, SessionUser } from "./types.js";

export function abilityFor(user: SessionUser | null): AppAbility {
  const builder = new AbilityBuilder<AppAbility>(createPrismaAbility);
  applyAdminRules(builder, user);
  applyTodoRules(builder, user);
  return builder.build();
}

// biome-ignore lint/performance/noBarrelFile: authz index is the composition root — abilityFor() lives here and re-exports are co-located intentionally
export { asSubject } from "./subject.js";
// biome-ignore lint/performance/noBarrelFile: authz index is the composition root — abilityFor() lives here and re-exports are co-located intentionally
export type {
  AppAbility,
  AppActions,
  AppSubjects,
  SessionUser,
} from "./types.js";
