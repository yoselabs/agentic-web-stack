// Browser-mode exemplar for ADR-0007 — proves that real Chromium
// surfaces the bug class jsdom can't see: `<img>` load failure.
//
// Assertions:
//   1. Valid (decodable) data URL → `naturalWidth > 0` after load.
//   2. Bogus `src` → `naturalWidth === 0` after the browser gives up.
//   3. `alt` is always rendered (a11y invariant that survives load
//      state).
//
// This file is the `verified_by:` anchor for docs/adrs/0007-*.md and
// the reference a fork can copy when it grows a real attachment
// feature. See @adr 0007.

import { describe, expect, it, vi } from "vitest";
import { renderWithTRPC } from "../../test/browser-render.js";
import { AuthedImage } from "@project/media/authed-image";

// 1×1 transparent PNG as a base64 data URL. Decodes cleanly in every
// browser — `naturalWidth` is 1, not 0.
const VALID_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

// Garbage data URL — the bytes after `base64,` are not a valid
// image. The browser fires `onerror`, `naturalWidth` stays at 0.
const BOGUS_DATA_URL = "data:image/png;base64,AAAA";

describe("AuthedImage (browser-mode)", () => {
  it("loads a valid image — naturalWidth > 0", async () => {
    const { getByAltText } = renderWithTRPC(
      <AuthedImage src={VALID_PNG_DATA_URL} alt="valid pixel" />,
    );

    const img = getByAltText("valid pixel").element() as HTMLImageElement;

    // The image decode is async even for a data URL. `vi.waitFor`
    // polls until `naturalWidth` flips off 0.
    await vi.waitFor(
      () => {
        expect(img.naturalWidth).toBeGreaterThan(0);
      },
      { timeout: 2000 },
    );
  });

  it("fails to load a bogus image — naturalWidth stays 0", async () => {
    const { getByAltText } = renderWithTRPC(
      <AuthedImage src={BOGUS_DATA_URL} alt="bogus pixel" />,
    );

    const img = getByAltText("bogus pixel").element() as HTMLImageElement;

    // Wait long enough for the browser to attempt + fail the decode.
    // If the browser somehow loaded it, this assertion would flip.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(img.naturalWidth).toBe(0);
  });

  it("renders alt text regardless of load state", async () => {
    const { getByAltText } = renderWithTRPC(
      <AuthedImage src={BOGUS_DATA_URL} alt="always-there alt" />,
    );

    // `getByAltText` throws if the alt isn't present — this is the
    // a11y contract the `alt: string` type also enforces statically.
    const img = getByAltText("always-there alt").element() as HTMLImageElement;
    expect(img.alt).toBe("always-there alt");
  });
});
