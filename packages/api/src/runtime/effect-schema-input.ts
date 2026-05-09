// tRPC `input(...)` accepts a function `(raw: unknown) => parsedValue`.
// This adapter wraps an Effect Schema with the expected shape so tRPC
// procedures can declare Effect-Schema-typed inputs.
//
// Throws on parse failure — tRPC catches and surfaces as BAD_REQUEST.
// Future commits may upgrade to a typed TRPCError; this minimal form
// closes ADR-0014's "Zod everywhere" hypothesis without scope creep.
//
// Spec: docs/superpowers/specs/2026-05-07-effect-contract-first-design.md §D4.

import { Either, Schema } from "effect";

export const effectSchemaInput = <A, I>(
  schema: Schema.Schema<A, I, never>,
): ((raw: unknown) => A) => {
  const decode = Schema.decodeUnknownEither(schema);
  return (raw: unknown): A => {
    const result = decode(raw);
    if (Either.isLeft(result)) {
      // ParseError has a .toString() that's reasonable for dev; tRPC
      // wraps as BAD_REQUEST with this message.
      throw new Error(`schema parse failed: ${result.left.toString()}`);
    }
    return result.right;
  };
};
