import type { Session } from "@project/auth";
import { auth } from "@project/auth";
import { Option } from "effect";

// tRPC v11 context: session is resolved from request headers via
// Better-Auth, then passed to runEffect as a per-request service. We
// resolve the session in the context (not inside Effect) because the
// tRPC fetch adapter wants a plain object on each call — keeping the
// resolution here also lets public procedures inspect `ctx.session`
// without paying the Effect cost.

export interface Context {
  readonly session: Option.Option<Session>;
  readonly headers: Headers;
}

export const createContext = async (opts: {
  req: Request;
}): Promise<Context> => {
  const session = await auth.api
    .getSession({ headers: opts.req.headers })
    .catch(() => null);
  return {
    headers: opts.req.headers,
    session: session ? Option.some(session as Session) : Option.none(),
  };
};
