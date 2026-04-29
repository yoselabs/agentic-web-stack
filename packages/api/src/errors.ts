import { Data } from "effect";

// Tagged error hierarchy for Effect-returning services. The runEffect
// adapter (./runtime/run-effect.ts) maps these to TRPCError codes.
//
// ADR-0009 §Tagged errors: errors are values, not exceptions; they
// thread through `Effect`'s type signature so handlers can be exhaustive.

export class DbError extends Data.TaggedError("DbError")<{
  readonly cause: unknown;
}> {}

export class NotFoundError extends Data.TaggedError("NotFoundError")<{
  readonly entity: string;
  readonly id?: string;
}> {}

export class UnauthorizedError extends Data.TaggedError("UnauthorizedError")<{
  readonly reason?: string;
}> {}

export class ForbiddenError extends Data.TaggedError("ForbiddenError")<{
  readonly reason?: string;
}> {}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly issues: ReadonlyArray<{
    readonly path: string;
    readonly message: string;
  }>;
}> {}

export type AppError =
  | DbError
  | NotFoundError
  | UnauthorizedError
  | ForbiddenError
  | ValidationError;
