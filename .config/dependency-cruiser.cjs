/**
 * dependency-cruiser config — enforces FSD layering and cross-workspace boundaries.
 *
 * Run via `pnpm exec depcruise` (wired into `make lint`).
 */
module.exports = {
  forbidden: [
    // --- FSD layer rules (apps/web) ---
    {
      name: "fsd-features-no-widgets",
      severity: "error",
      comment:
        "apps/web/src/features/** must NOT import from apps/web/src/widgets/** (FSD: widgets compose features, not the other way).",
      from: { path: "^apps/web/src/features/" },
      to: { path: "^apps/web/src/widgets/" },
    },
    {
      name: "fsd-features-no-routes",
      severity: "error",
      comment:
        "apps/web/src/features/** must NOT import from apps/web/src/routes/** (FSD: routes compose features).",
      from: { path: "^apps/web/src/features/" },
      to: { path: "^apps/web/src/routes/" },
    },
    {
      name: "fsd-widgets-no-routes",
      severity: "error",
      comment:
        "apps/web/src/widgets/** must NOT import from apps/web/src/routes/**.",
      from: { path: "^apps/web/src/widgets/" },
      to: { path: "^apps/web/src/routes/" },
    },
    {
      name: "fsd-shared-no-upward",
      severity: "error",
      comment:
        "apps/web/src/shared/** must NOT import from features/widgets/routes (shared is the base layer).",
      from: { path: "^apps/web/src/shared/" },
      to: {
        path: [
          "^apps/web/src/features/",
          "^apps/web/src/widgets/",
          "^apps/web/src/routes/",
        ],
      },
    },
    // NOTE: "apps/web must not import packages/api/src/** directly" is
    // already enforced at the specifier level by biome.json's
    // noRestrictedImports rule (forbids bare "@project/api" in favor of
    // the published subpaths). dependency-cruiser resolves specifiers to
    // physical paths, so a legitimate subpath import
    // ("@project/api/router" → packages/api/src/router.ts) is
    // indistinguishable from a forbidden relative escape. We don't
    // duplicate that rule here.

    // --- Sanity: no-circular ---
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular dependencies",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    exclude: {
      path: [
        "node_modules",
        "\\.output",
        "dist",
        "routeTree\\.gen\\.ts",
        "\\.features-gen",
        "packages/db/src/generated",
        "test-results",
      ],
    },
    tsConfig: {
      fileName: "tsconfig.json",
    },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
