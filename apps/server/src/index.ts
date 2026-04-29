import { createServer } from "node:http";
import {
  HttpApp,
  HttpMiddleware,
  HttpRouter,
  HttpServer,
  HttpServerResponse,
} from "@effect/platform";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { createContext } from "@project/api/context";
import { appRouter } from "@project/api/router";
import { auth } from "@project/auth";
import { db } from "@project/db";
import { env } from "@project/env/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Effect, Layer } from "effect";

// ADR-0011 — server-process HTTP boundary on @effect/platform HttpServer.
//
// Mounted apps:
//   - /api/auth/*  → Better-Auth web handler wrapped via HttpApp.fromWebHandler
//   - /trpc/*      → tRPC fetch adapter wrapped via HttpApp.fromWebHandler
//   - /health      → DB ping (200 ok / 503 degraded)
//
// CORS: HttpMiddleware.cors (env.CORS_ORIGIN). credentials:true so the
// Better-Auth session cookie crosses origins.
//
// Bull Board mount + ws upgrade are deferred to Phase 4. The slice's
// Better-Auth + tRPC requirements are sufficient to validate the
// HttpServer choice; deferring the dev-only Bull Board mount and the
// realtime ws upgrade is documented in §Spike findings of ADR-0011.

const trpcWebHandler = (req: Request): Promise<Response> =>
  fetchRequestHandler({
    endpoint: "/trpc",
    req,
    router: appRouter,
    createContext: () => createContext({ req }),
  });

const healthRoute = Effect.gen(function* () {
  const dbStatus = yield* Effect.tryPromise(
    () => db.$queryRaw`SELECT 1` as Promise<unknown>,
  ).pipe(
    Effect.map(() => "ok" as const),
    Effect.catchAll(() => Effect.succeed("error" as const)),
  );
  const status = dbStatus === "ok" ? "ok" : "degraded";
  return yield* HttpServerResponse.json(
    {
      status,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      db: dbStatus,
    },
    { status: dbStatus === "ok" ? 200 : 503 },
  );
});

const router = HttpRouter.empty.pipe(
  HttpRouter.get("/health", healthRoute),
  HttpRouter.mountApp(
    "/api/auth",
    HttpApp.fromWebHandler((req) => auth.handler(req)),
    { includePrefix: true },
  ),
  HttpRouter.mountApp("/trpc", HttpApp.fromWebHandler(trpcWebHandler), {
    includePrefix: true,
  }),
);

const corsMiddleware = HttpMiddleware.cors({
  allowedOrigins: [env.CORS_ORIGIN],
  allowedMethods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
});

const ServerLive = HttpServer.serve(router, corsMiddleware).pipe(
  HttpServer.withLogAddress,
  Layer.provide(
    NodeHttpServer.layer(() => createServer(), {
      port: env.PORT,
      // ADR-0011 — bind 0.0.0.0 so containers can reach the API; checked
      // by packages/lint/src/check-server-bind.ts.
      host: "0.0.0.0",
    }),
  ),
);

NodeRuntime.runMain(Layer.launch(ServerLive));
