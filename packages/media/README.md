# @project/media

Media UI primitives with auth awareness — authed images, uploads (future), crops (future).

## Exports

- `@project/media/authed-image` — `<AuthedImage src alt />` reference stub. See ADR-0007 for the browser-mode test rationale the component anchors.

## Growth path

- `@project/media/use-signed-url` — `useQuery` wrapper that resolves a short-TTL signed URL.
- `@project/media/upload` — upload widget + progress state; pairs with `@project/http` retry helpers.
- `@project/media/crop` — in-browser image crop/resize before upload.

## Rules

- Subpath-only exports (enforced by `check-no-barrel`).
- Client-only.
