import type { TodoHttpRouter } from "@project/api/domains/todo-list/todo-http";
import { apiClient } from "@project/http/client";
import { hc } from "hono/client";

// `apiClient.baseUrl` is the bare origin (no trailing slash, no path) per
// `api-client.ts`. hc's first arg is the path prefix for this router and
// must match the server-side mount `app.route("/api/todos", todoHttpRouter)`.
// `fetch: apiClient.fetch` inherits credentials:"include" + base-URL rules,
// keeping the "all HTTP via apiClient" rule from apps/web/CLAUDE.md.
export const todoHttpClient = hc<TodoHttpRouter>(
  `${apiClient.baseUrl}/api/todos`,
  { fetch: apiClient.fetch },
);
