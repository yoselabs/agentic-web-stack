import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Run testing-library cleanup after each test to unmount components and
// remove DOM nodes — prevents leak across tests when `globals: false`
// (RTL won't auto-register its own afterEach).
afterEach(() => {
  cleanup();
});
