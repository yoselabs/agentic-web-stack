import { auth, type Session } from "@project/auth";
import { Effect, Option } from "effect";
import { UnauthorizedError } from "../errors.ts";

// ADR-0011 / Phase 3 first slice: Better-Auth wrapped in an `Auth` Layer.
// Better-Auth is a non-Effect provider (Q5 floor); the wrap exposes:
//   - `auth.handler(Request) => Promise<Response>` — mounted at /api/auth/*
//   - `auth.api.getSession({ headers })` — used by the request-scoped
//     `Session` Layer to resolve the current user.
//
// This layer is NOT a full rewrite of auth flows. Sign-up / sign-in are
// performed via Better-Auth's HTTP handler from the client; the server
// only needs to read the resulting session for guarded procedures.

export interface AuthService {
  readonly handler: (request: Request) => Promise<Response>;
  readonly getSession: (
    headers: Headers,
  ) => Effect.Effect<Option.Option<Session>>;
}

export class Auth extends Effect.Service<Auth>()("@project/api/Auth", {
  sync: (): AuthService => ({
    handler: (request: Request) => auth.handler(request),
    getSession: (headers: Headers) =>
      Effect.tryPromise({
        try: () => auth.api.getSession({ headers }),
        catch: () => new UnauthorizedError({ reason: "session-lookup-failed" }),
      }).pipe(
        Effect.map((session) =>
          session ? Option.some(session as Session) : Option.none(),
        ),
        Effect.catchAll(() => Effect.succeed(Option.none<Session>())),
      ),
  }),
}) {}

// Request-scoped container carrying the resolved session for the current
// procedure. Provided by the tRPC context layer; `protectedProcedure`
// requires `session` to be `Some`.
//
// Wraps `Option<Session>` in a plain object because `Effect.Service`
// cannot use an Effect-tagged type (like `Option`) directly as the
// service shape — the `_tag` field would clash with the service identifier.
export interface CurrentSessionShape {
  readonly session: Option.Option<Session>;
}

export class CurrentSession extends Effect.Service<CurrentSession>()(
  "@project/api/CurrentSession",
  {
    // Default is none — always overridden at the tRPC request boundary
    // via Effect.provideService(CurrentSession, { session: ctx.session }).
    sync: (): CurrentSessionShape => ({ session: Option.none<Session>() }),
  },
) {}

export const requireSession = Effect.gen(function* () {
  const { session: sessionOpt } = yield* CurrentSession;
  return yield* Option.match(sessionOpt, {
    onNone: () => Effect.fail(new UnauthorizedError({ reason: "no-session" })),
    onSome: (s) => Effect.succeed(s),
  });
});
