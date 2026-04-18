import { createFileRoute } from "@tanstack/react-router";
// Server-only health endpoint matching the API's /health contract.
// Probed by the image-level HEALTHCHECK (Dockerfile) to prove Nitro SSR is
// alive. The type-only import below loads start-client-core's module
// augmentation that adds the `server:` handler option onto route options.
import type {} from "@tanstack/start-client-core";

export const Route = createFileRoute("/health")({
  server: {
    handlers: {
      GET: () =>
        Response.json({
          status: "ok",
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
        }),
    },
  },
});
