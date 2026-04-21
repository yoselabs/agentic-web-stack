import type { ImgHTMLAttributes } from "react";

/**
 * Minimal `<img>` wrapper intended for authenticated media URLs.
 *
 * **This is a reference stub.** The template has no attachment feature
 * today; `AuthedImage` exists as the target of the `*.browser.test.tsx`
 * exemplar (see `authed-image.browser.test.tsx`) and as the import
 * surface a fork can grow when it adds signed-URL attachments.
 *
 * The component intentionally does nothing authentication-flavoured —
 * it renders a plain `<img>` and forwards props. Forks adding
 * attachments should:
 *
 * 1. Swap the `src` for a signed short-TTL URL from a `useQuery` call.
 * 2. Keep the `alt` requirement (unmodifiable — a11y gate).
 * 3. Grow the `.browser.test.tsx` sibling with assertions against
 *    `naturalWidth` for the new URL shape.
 *
 * See ADR-0007 for the rationale behind the browser-mode test path.
 */
export type AuthedImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  src: string;
  alt: string;
};

export function AuthedImage({ src, alt, ...rest }: AuthedImageProps) {
  return <img src={src} alt={alt} {...rest} />;
}
