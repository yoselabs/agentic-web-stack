import { env } from "@project/env/client";

// Single source of truth for the API base URL and all HTTP calls from
// the web app. Every fetch to the server MUST go through this module
// — direct `fetch(url, ...)` with a hardcoded or inlined URL is a
// lint error.
//
// This module imports env.VITE_API_URL from @project/env/client ONLY
// — never from @project/env/server. Any file under apps/web/ that
// imports from @project/env/server is a build-breaking mistake (see
// root CLAUDE.md: SSOT + split-brain env + no-barrel rule).

export const API_BASE_URL = env.VITE_API_URL;

// Thin fetch wrapper: prepends base URL for relative paths, sets
// cookie-auth credentials, preserves caller-provided init options.
// Returns the raw Response — callers check res.ok and parse as needed.
//
// Accepts string | URL | Request so it is compatible with tRPC's
// httpBatchLink `fetch` option (FetchEsque). Full URLs (starting with
// http) and URL/Request objects pass through unchanged; relative
// string paths get the base URL prepended.
export async function apiFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  let url: string | URL | Request;
  if (typeof input === "string" && !input.startsWith("http")) {
    url = `${API_BASE_URL}${input}`;
  } else {
    url = input;
  }
  return fetch(url, {
    credentials: "include",
    ...init,
  });
}

// Namespaced export so call sites read `apiClient.fetch(...)` rather
// than `apiFetch(...)` — matches the "all HTTP via apiClient" mental
// model established in apps/web/CLAUDE.md.
export const apiClient = {
  baseUrl: API_BASE_URL,
  fetch: apiFetch,
};
