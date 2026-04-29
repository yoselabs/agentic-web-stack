import { db, type PrismaClient } from "@project/db";
import { Context, Effect, Layer } from "effect";
import { DbError } from "../errors.ts";

// ADR-0013 — DB access via a `Db` Effect Layer wrapping the Prisma
// singleton from @project/db. Service procedures consume `Db` and call
// methods through the `tryPromise` helper, which converts Prisma's
// promise rejections to a tagged `DbError`.

export class Db extends Context.Tag("@project/api/Db")<Db, PrismaClient>() {}

export const DbLive = Layer.succeed(Db, db);

// Per-domain helpers absorb the `Effect.tryPromise` boilerplate. Use this
// inside services rather than duplicating the catch shape at every call
// site.
export const tryDb = <A>(thunk: (client: PrismaClient) => Promise<A>) =>
  Effect.gen(function* () {
    const client = yield* Db;
    return yield* Effect.tryPromise({
      try: () => thunk(client),
      catch: (cause) => new DbError({ cause }),
    });
  });

// Atomically run an Effect inside a Prisma interactive transaction.
// Inside `eff`, the `Db` service is overridden with the transaction
// client, so all `tryDb` calls participate in the same transaction.
export const withTransaction = <A, E>(
  eff: Effect.Effect<A, E, Db>,
): Effect.Effect<A, E | DbError, Db> =>
  Effect.gen(function* () {
    const client = yield* Db;
    return yield* Effect.tryPromise({
      try: () =>
        client.$transaction((tx) =>
          Effect.runPromise(
            eff.pipe(Effect.provideService(Db, tx as PrismaClient)),
          ),
        ),
      catch: (cause) => new DbError({ cause }),
    });
  }) as Effect.Effect<A, E | DbError, Db>;
