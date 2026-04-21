# @project/http

HTTP client + fetch wrappers. Credentials + base URL helpers.

Add new generic fetch utilities here (retry, offline queue, typed errors) as the app's HTTP surface grows.

## Exports

- `@project/http/client` — `apiClient` object with `baseUrl` and cookie-aware `fetch`. Every non-tRPC HTTP call from the web app goes through this.

## Growth path

- Retry/backoff wrappers for idempotent GETs.
- Offline queue for writes during intermittent connectivity.
- Typed error envelopes shared with the server's error shape.
- Upload progress helpers (will likely pair with `@project/media` future `upload` subpath).

## Rules

- Subpath-only exports (enforced by `check-no-barrel`).
- Imports `@project/env/client` only — never `/server`. This package ships to the browser.
