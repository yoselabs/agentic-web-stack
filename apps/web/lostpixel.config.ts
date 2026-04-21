// @adr 0006
import type { CustomProjectConfig } from "lost-pixel";

/**
 * Lost Pixel — OSS visual regression against the built Storybook static
 * bundle. Baselines live under `e2e/visual-baselines/` so they sit
 * alongside BDD artifacts (the "pixel-level" gate in the pyramid —
 * docs/qa-strategy.md §3.6).
 *
 * NOT run in `make lint` — visual diff is seconds-to-minutes and flakes
 * on font/antialiasing differences between OSes. Run manually or in a
 * dedicated CI job via `make visual-regression`. See ADR-0006.
 *
 * Paths are resolved from the repo root (the directory where
 * `make visual-regression` is invoked).
 */
export const config: CustomProjectConfig = {
  storybookShots: {
    storybookUrl: "apps/web/storybook-static",
  },
  imagePathBaseline: "e2e/visual-baselines/",
  imagePathCurrent: "apps/web/.lost-pixel/current/",
  imagePathDifference: "apps/web/.lost-pixel/difference/",
  // 5% pixel tolerance — forgiving enough to survive antialiasing drift
  // between macOS and linux CI runners without masking real regressions.
  threshold: 0.05,
  // Default: run once locally with `lostPixel: 'update'` to seed the
  // baseline directory, commit the PNGs, then run again to confirm green.
  generateOnly: false,
  failOnDifference: true,
};
