import type { Session } from "@project/auth";
import { RateLimiter } from "@project/rate-limit/contract";
import type { RateLimitExceededError } from "@project/rate-limit/errors";
import { TRPCError } from "@trpc/server";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { TodoListService } from "../domains/todo-list/todo-contract.ts";
import type {
  TodoListError,
  TodoListNotFoundError,
  TodoNotFoundError,
  TodoNotOwnedError,
  TodoSkippedError,
} from "../domains/todo-list/todo-errors.ts";
import type {
  DbError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../errors.ts";
import { AppLayer } from "./app-layer.ts";
import type { Auth } from "./auth-layer.ts";
import { CurrentSession } from "./auth-layer.ts";
import type { Db } from "./db-layer.ts";

// ADR-0012 — RPC layer: tRPC v11 stays; Effect-returning services are
// adapted to tRPC's Promise-based handlers via this single helper. This
// is the ONLY Promise↔Effect boundary on the server. Inside the service
// layer, everything is `Effect`.
//
// Provides AppLayer (Db, Auth, Logger) and the per-request CurrentSession
// service, then maps tagged errors to TRPCError codes. Unexpected
// defects surface as INTERNAL_SERVER_ERROR.

type AppRequirements =
  | Db
  | Auth
  | CurrentSession
  | TodoListService
  | RateLimiter;

// Full runtime layer: AppLayer (Db + Auth + Logger) merged with
// TodoListService.Default and RateLimiter.Default. Both Effect.Service
// classes use sync:/succeed: so their layers have no requirements at
// composition time — domain requirements live inside the Effect.
//
// ADR-0021 — RateLimiter.Default = in-memory limiter (30/60s). Prod
// composition swaps in a Redis-backed Layer at the entrypoint when
// horizontal scale demands distributed coordination.
const FullLayer = Layer.mergeAll(
  AppLayer,
  TodoListService.Default,
  RateLimiter.Default,
);

const tagToCode = (
  e:
    | DbError
    | NotFoundError
    | UnauthorizedError
    | ForbiddenError
    | ValidationError
    | TodoListError
    | TodoListNotFoundError
    | TodoNotFoundError
    | TodoNotOwnedError
    | TodoSkippedError
    | RateLimitExceededError,
): TRPCError => {
  switch (e._tag) {
    case "NotFoundError":
      return new TRPCError({
        code: "NOT_FOUND",
        message: `${e.entity}${e.id ? ` ${e.id}` : ""} not found`,
      });
    case "UnauthorizedError":
      return new TRPCError({ code: "UNAUTHORIZED", message: e.reason });
    case "ForbiddenError":
      return new TRPCError({ code: "FORBIDDEN", message: e.reason });
    case "ValidationError":
      return new TRPCError({
        code: "BAD_REQUEST",
        message: e.issues.map((i) => `${i.path}: ${i.message}`).join("; "),
      });
    case "DbError":
      return new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "database error",
        cause: e.cause,
      });
    case "TodoListError":
      return new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "todo list operation failed",
        cause: e.cause,
      });
    case "TodoListNotFoundError":
      return new TRPCError({
        code: "NOT_FOUND",
        message: `TodoList not found: ${e.id}`,
      });
    case "TodoNotFoundError":
      return new TRPCError({
        code: "NOT_FOUND",
        message: `Todo not found: ${e.id}`,
      });
    case "TodoNotOwnedError":
      return new TRPCError({
        code: "FORBIDDEN",
        message: "you do not own this list",
      });
    case "TodoSkippedError":
      return new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "todo skipped during processing",
      });
    case "RateLimitExceededError":
      // ADR-0021 — surface msBeforeNext so call sites can render the
      // remaining wait. tRPC has no native Retry-After header
      // primitive; the millisecond value travels in the message until
      // a tRPC error formatter is added at the link boundary.
      return new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `rate limit exceeded; retry in ${e.msBeforeNext}ms`,
      });
  }
};

const isTaggedAppError = (
  err: unknown,
): err is
  | DbError
  | NotFoundError
  | UnauthorizedError
  | ForbiddenError
  | ValidationError
  | TodoListError
  | TodoListNotFoundError
  | TodoNotFoundError
  | TodoNotOwnedError
  | TodoSkippedError
  | RateLimitExceededError =>
  typeof err === "object" &&
  err !== null &&
  "_tag" in err &&
  typeof (err as { _tag: unknown })._tag === "string" &&
  [
    "DbError",
    "NotFoundError",
    "UnauthorizedError",
    "ForbiddenError",
    "ValidationError",
    "TodoListError",
    "TodoListNotFoundError",
    "TodoNotFoundError",
    "TodoNotOwnedError",
    "TodoSkippedError",
    "RateLimitExceededError",
  ].includes((err as { _tag: string })._tag);

export const runEffect = async <A, E>(
  effect: Effect.Effect<A, E, AppRequirements>,
  ctx: { session: Option.Option<Session> },
): Promise<A> => {
  const provided = effect.pipe(
    Effect.provideService(
      CurrentSession,
      new CurrentSession({ session: ctx.session }),
    ),
    Effect.provide(FullLayer),
  );
  const exit = await Effect.runPromiseExit(provided);

  if (Exit.isSuccess(exit)) return exit.value;

  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure)) {
    const err = failure.value as unknown;
    if (isTaggedAppError(err)) throw tagToCode(err);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "unexpected error",
      cause: err,
    });
  }
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: Cause.pretty(exit.cause),
    cause: exit.cause,
  });
};
