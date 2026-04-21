// Guard against CASL's plain-object fallback. Every rule that receives a
// fetched Prisma row MUST wrap it with asSubject(name, row) — otherwise
// CASL falls back to class-level checks and can over-grant access.

import { subject } from "@casl/ability";

export function asSubject<N extends string, T extends object>(
  name: N,
  row: T,
): T & { __caslSubjectType__: N } {
  return subject(name, row) as T & { __caslSubjectType__: N };
}
