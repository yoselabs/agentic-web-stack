// lint-disable-file check-effect-service-form — Day-1 migration in progress (Task 6)
import { auth, type Session } from "@project/auth";
import { Context, Effect, Layer, Option } from "effect";
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

export class Auth extends Context.Tag("@project/api/Auth")<
  Auth,
  AuthService
>() {}

export const AuthLive = Layer.succeed(Auth, {
  handler: (request) => auth.handler(request),
  getSession: (headers) =>
    Effect.tryPromise({
      try: () => auth.api.getSession({ headers }),
      catch: () => new UnauthorizedError({ reason: "session-lookup-failed" }),
    }).pipe(
      Effect.map((session) =>
        session ? Option.some(session as Session) : Option.none(),
      ),
      Effect.catchAll(() => Effect.succeed(Option.none<Session>())),
    ),
});

// Request-scoped tag carrying the resolved session for the current
// procedure. Provided by the tRPC context layer; `protectedProcedure`
// requires it to be `Some`.
export class CurrentSession extends Context.Tag("@project/api/CurrentSession")<
  CurrentSession,
  Option.Option<Session>
>() {}

export const requireSession = Effect.gen(function* () {
  const sessionOpt = yield* CurrentSession;
  return yield* Option.match(sessionOpt, {
    onNone: () => Effect.fail(new UnauthorizedError({ reason: "no-session" })),
    onSome: (s) => Effect.succeed(s),
  });
});
