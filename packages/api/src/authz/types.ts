// Ability types for the whole app. New domains extend Actions/Subjects here.
// The subject strings must match the Prisma model names for @casl/prisma
// accessibleBy() integration.

import type { PureAbility } from "@casl/ability";
import type { PrismaQuery, Subjects } from "@casl/prisma";
import type { Todo, TodoList, User } from "@project/db";

export type AppActions =
  | "manage" // superuser
  | "access"
  | "create"
  | "read"
  | "update"
  | "delete";

// "AdminDashboard" is a named abstract subject — used by the admin rule
// for gating /admin/*. Real DB subjects come from Prisma types.
export type AppSubjects =
  | "AdminDashboard"
  | Subjects<{
      Todo: Todo;
      TodoList: TodoList;
      User: User;
    }>
  | "all";

export type AppAbility = PureAbility<[AppActions, AppSubjects], PrismaQuery>;

export type SessionUser = {
  id: string;
  role: string;
};
