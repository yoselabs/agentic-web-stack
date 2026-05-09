import { Data } from "effect";

export class TodoListError extends Data.TaggedError("TodoListError")<{
  readonly cause: unknown;
}> {}

export class TodoListNotFoundError extends Data.TaggedError(
  "TodoListNotFoundError",
)<{
  readonly id: string;
}> {}

export class TodoNotFoundError extends Data.TaggedError("TodoNotFoundError")<{
  readonly id: string;
}> {}

export class TodoNotOwnedError extends Data.TaggedError("TodoNotOwnedError")<{
  readonly listId: string;
  readonly userId: string;
}> {}

export class TodoSkippedError extends Data.TaggedError("TodoSkippedError")<{
  readonly id: string;
  readonly reason: string;
}> {}
