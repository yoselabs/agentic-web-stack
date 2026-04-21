# Visual regression baselines (Lost Pixel)

This directory holds pixel baselines produced by `make visual-regression`.
Baselines are committed; current + diff dirs are gitignored
(`apps/web/.lost-pixel/`).

Regenerate locally when a widget's visual surface changes intentionally:

```sh
rm -rf e2e/visual-baselines/*.png
LOST_PIXEL_MODE=update make visual-regression
git add e2e/visual-baselines/
```

## Known first-run issue (2026-04 snapshot)

Lost Pixel 3.22 crawls the Storybook static build looking for
`window.__STORYBOOK_PREVIEW__` or `/stories.json`. Storybook 9 emits
`index.json` instead, and the window handle shape changed — so the
crawler times out on the first run. Tracked upstream; until LP ships
an SB9-compatible crawler the local workflow is:

1. `make build-storybook`
2. Serve `apps/web/storybook-static/` with a static server
   (`pnpm dlx http-server apps/web/storybook-static -p 6006`).
3. Edit `apps/web/lostpixel.config.ts` temporarily to point
   `storybookUrl` at `http://localhost:6006`.
4. `LOST_PIXEL_MODE=update pnpm --filter @project/web exec lost-pixel`.

Revert the URL, commit the generated PNGs, and the subsequent
`make visual-regression` runs green against the static dir.

See ADR-0006 and `apps/web/lostpixel.config.ts`.
