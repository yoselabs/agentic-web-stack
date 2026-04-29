import type { Session } from "@project/auth";
import { db } from "@project/db";
import { Effect, Option } from "effect";
import { AppLayer } from "./runtime/app-layer.ts";
import { CurrentSession } from "./runtime/auth-layer.ts";

// ADR-0019 — bun test ergonomics for Effect-returning services.
//
// `runTestEffect` mirrors runtime/run-effect.ts but skips the
// TRPCError mapping — tests want to assert on tagged errors directly.
// `withTestUser` creates a real User row + crafts a session-shaped
// object compatible with CurrentSession. Better-Auth's session-token
// flow is bypassed: tests target the service layer, not the HTTP
// boundary.

export const runTestEffect = <A, E>(
  effect: Effect.Effect<A, E, never>,
): Promise<A> => Effect.runPromise(effect as Effect.Effect<A, E, never>);

export const provideTestSession = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  session: Session | null,
): Effect.Effect<A, E, never> =>
  effect.pipe(
    Effect.provideService(
      CurrentSession,
      session ? Option.some(session) : Option.none(),
    ),
    Effect.provide(AppLayer),
  ) as unknown as Effect.Effect<A, E, never>;

let userCounter = 0;

export async function makeTestUser(opts?: {
  email?: string;
  name?: string;
}): Promise<Session> {
  userCounter += 1;
  const email = opts?.email ?? `test-${Date.now()}-${userCounter}@example.com`;
  const name = opts?.name ?? `Test User ${userCounter}`;
  const username = `test-${Date.now()}-${userCounter}`;
  const user = await db.user.create({
    data: {
      id: `test-user-${Date.now()}-${userCounter}`,
      email,
      name,
      username,
      role: "user",
      emailVerified: true,
    },
  });
  const session = await db.session.create({
    data: {
      id: `test-session-${Date.now()}-${userCounter}`,
      token: `test-token-${Date.now()}-${userCounter}`,
      userId: user.id,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    },
  });
  return {
    session: {
      id: session.id,
      token: session.token,
      userId: user.id,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      ipAddress: null,
      userAgent: null,
    },
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
      image: user.image,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      role: user.role,
      username: user.username,
    },
  } as unknown as Session;
}

export async function resetDb(): Promise<void> {
  // Order matters: child tables before parents.
  await db.todo.deleteMany({});
  await db.todoListInvite.deleteMany({});
  await db.todoListMembership.deleteMany({});
  await db.todoList.deleteMany({});
  await db.activityEvent.deleteMany({});
  await db.session.deleteMany({});
  await db.account.deleteMany({});
  await db.verification.deleteMany({});
  await db.user.deleteMany({});
}
