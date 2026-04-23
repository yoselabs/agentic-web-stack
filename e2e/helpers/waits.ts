import type { Page } from "@playwright/test";

// Hydration budget. The client-side useEffect that sets [data-hydrated]
// should fire sub-second once the JS bundle is loaded + parsed; 10s is
// generous headroom for cold-start on slow CI runners. If this ever times
// out, it's not a slow page — it's a bundle that failed to hydrate.
const HYDRATION_TIMEOUT_MS = 10_000;

// Wait for the client-side hydration marker set in apps/web/src/routes/
// __root.tsx (document.documentElement[data-hydrated] appears after React's
// first client-side useEffect fires). `waitForLoadState("networkidle")`
// alone doesn't guarantee interactivity — hydration can still be pending
// after the HTTP load settles, and a click landing before hydration
// silently wedges until Playwright's timeout. Call this after every
// page.goto() in step definitions.
export async function waitForHydration(page: Page): Promise<void> {
  try {
    // [data-hydrated] is a custom hydration marker on <html>, not a
    // semantic role. Wait via DOM predicate — avoids raw-locator lint
    // while preserving the "attribute appears after React hydrates"
    // contract.
    await page.waitForFunction(
      () => document.documentElement.hasAttribute("data-hydrated"),
      null,
      { timeout: HYDRATION_TIMEOUT_MS },
    );
  } catch {
    const url = page.url();
    const snippet = await page
      .content()
      .then((html) => html.slice(0, 500))
      .catch(() => "(failed to read page content)");
    throw new Error(
      `waitForHydration timed out at ${url} after ${HYDRATION_TIMEOUT_MS}ms. The [data-hydrated] attribute on <html> never appeared — React hydration didn't complete. Likely causes: SSR/client mismatch, error boundary triggered, or JS bundle 404. Page head (500 chars): ${snippet}`,
    );
  }
}
