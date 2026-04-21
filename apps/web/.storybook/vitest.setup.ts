import "@testing-library/jest-dom/vitest";
import * as a11yAnnotations from "@storybook/addon-a11y/preview";
import { setProjectAnnotations } from "@storybook/react-vite";
import { beforeAll } from "vitest";
import preview from "./preview";

/**
 * Applies the project-level annotations to every story when run under
 * Vitest + `@storybook/addon-vitest`.
 *
 * We register:
 * - `addon-a11y`'s preview (the `afterEach` hook that runs axe and —
 *   with our `a11y.test: "error"` parameter — throws on violations).
 *   In the SB dev server `main.addons` wires this automatically; under
 *   Vitest we have to opt in explicitly via `setProjectAnnotations`.
 * - Our local `preview` (the `withTRPC` decorator + the `a11y.test`
 *   flag).
 *
 * Without this, stories render without `QueryClientProvider` and the
 * a11y addon never runs — a hook test inside a widget would crash on
 * `useQuery` and violations would escape to silent panel warnings.
 */
const project = setProjectAnnotations([a11yAnnotations, preview]);
beforeAll(project.beforeAll);
