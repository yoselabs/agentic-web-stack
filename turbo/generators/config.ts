import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PlopTypes } from "@turbo/gen";

/**
 * `turbo gen feature` — scaffolds a full vertical slice for a new feature.
 *
 * Given a kebab-case `{name}`, emits 9 files spanning web, api, and e2e
 * layers (see spec §4 WS3). Also inserts the new router into
 * `packages/api/src/router.ts` at the alphabetical position per the
 * append-alpha rule (packages/api/CLAUDE.md).
 *
 * Run via: `pnpm new:feature` (interactive) or `pnpm new:feature <name>`.
 */

function toPascalCase(kebab: string): string {
  return kebab
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function toCamelCase(kebab: string): string {
  const pascal = toPascalCase(kebab);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * Insert the new router registration into `packages/api/src/router.ts`
 * at the correct alphabetical position. Two edits:
 *   1. Add `import { <camel>Router } from "./domains/<name>/<name>-router.js";`
 *      into the import block, alpha-sorted by import specifier path.
 *   2. Add `<camel>: <camel>Router,` into the `router({...})` block,
 *      alpha-sorted by key.
 *
 * Uses AST-free regex editing — the file's shape is narrow and stable.
 */
function registerRouterAlpha(repoRoot: string, name: string): void {
  const filePath = join(repoRoot, "packages/api/src/router.ts");
  const original = readFileSync(filePath, "utf8");
  const camel = toCamelCase(name);
  const routerVar = `${camel}Router`;
  const importLine = `import { ${routerVar} } from "./domains/${name}/${name}-router.js";`;
  const registrationLine = `  ${camel}: ${routerVar},`;

  if (original.includes(importLine)) return; // idempotent

  // Step 1: insert import line alpha-sorted among existing `import { xRouter } from "./domains/..."` lines.
  const importRe =
    /^(import \{ \w+ \} from "\.\/domains\/[\w-]+\/[\w-]+\.js";)$/gm;
  const importMatches = [...original.matchAll(importRe)];
  if (importMatches.length === 0) {
    throw new Error(
      "registerRouterAlpha: no existing domain-router imports found; bail out.",
    );
  }

  const imports = importMatches.map((m) => ({
    line: m[0],
    index: m.index ?? 0,
  }));
  const inserted = [...imports.map((i) => i.line), importLine].sort();
  const insertPos = inserted.indexOf(importLine);
  let newImportBlock: string;
  const firstImportStart = imports[0].index;
  const lastImportEnd =
    imports[imports.length - 1].index + imports[imports.length - 1].line.length;
  if (insertPos === 0) {
    newImportBlock = `${importLine}\n${original.slice(firstImportStart, lastImportEnd)}`;
  } else if (insertPos === inserted.length - 1) {
    newImportBlock = `${original.slice(firstImportStart, lastImportEnd)}\n${importLine}`;
  } else {
    const before = inserted.slice(0, insertPos);
    const after = inserted.slice(insertPos + 1);
    newImportBlock = [...before, importLine, ...after].join("\n");
  }
  let updated =
    original.slice(0, firstImportStart) +
    newImportBlock +
    original.slice(lastImportEnd);

  // Step 2: insert registration line alpha-sorted inside `router({ ... })`.
  const regRe = /^ {2}(\w+): \w+Router,$/gm;
  const regMatches = [...updated.matchAll(regRe)];
  if (regMatches.length === 0) {
    throw new Error(
      "registerRouterAlpha: no existing router registrations found; bail out.",
    );
  }
  const regLines = regMatches.map((m) => ({
    line: m[0],
    key: m[1],
    index: m.index ?? 0,
  }));
  const regFirstStart = regLines[0].index;
  const regLastEnd =
    regLines[regLines.length - 1].index +
    regLines[regLines.length - 1].line.length;

  const combined = [
    ...regLines.map((r) => ({ line: r.line, key: r.key })),
    { line: registrationLine, key: camel },
  ].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const newRegBlock = combined.map((r) => r.line).join("\n");
  updated =
    updated.slice(0, regFirstStart) + newRegBlock + updated.slice(regLastEnd);

  writeFileSync(filePath, updated);
}

export default function generator(plop: PlopTypes.NodePlopAPI): void {
  plop.setHelper("pascalCase", (s: string) => toPascalCase(s));
  plop.setHelper("camelCase", (s: string) => toCamelCase(s));

  plop.setActionType("registerRouter", (answers, _config, plopApi) => {
    const name = (answers as { name: string }).name;
    const repoRoot = plopApi.getDestBasePath();
    registerRouterAlpha(repoRoot, name);
    return `Registered ${toCamelCase(name)}Router in packages/api/src/router.ts`;
  });

  plop.setGenerator("feature", {
    description:
      "Scaffold a full vertical slice: web feature hook + widget + api domain + e2e feature/steps",
    prompts: [
      {
        type: "input",
        name: "name",
        message: "Feature name (kebab-case, e.g. `blog-post`):",
        validate: (raw: string) => {
          const v = raw.trim();
          if (!v) return "Name is required.";
          if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(v)) {
            return "Must be kebab-case: lowercase letters, digits, hyphens; must start with a letter.";
          }
          return true;
        },
      },
    ],
    actions: [
      {
        type: "add",
        path: "apps/web/src/features/{{name}}/use-{{name}}.ts",
        templateFile: "templates/use-feature.ts.hbs",
      },
      {
        type: "add",
        path: "apps/web/src/features/{{name}}/use-{{name}}.test.ts",
        templateFile: "templates/use-feature.test.ts.hbs",
      },
      {
        type: "add",
        path: "apps/web/src/widgets/{{name}}-panel/{{name}}-panel.tsx",
        templateFile: "templates/widget-panel.tsx.hbs",
      },
      {
        type: "add",
        path: "apps/web/src/widgets/{{name}}-panel/{{name}}-panel.stories.tsx",
        templateFile: "templates/widget-panel.stories.tsx.hbs",
      },
      {
        type: "add",
        path: "packages/api/src/domains/{{name}}/{{name}}-service.ts",
        templateFile: "templates/service.ts.hbs",
      },
      {
        type: "add",
        path: "packages/api/src/domains/{{name}}/{{name}}-router.ts",
        templateFile: "templates/router.ts.hbs",
      },
      {
        type: "add",
        path: "packages/api/src/domains/{{name}}/__tests__/{{name}}-service.test.ts",
        templateFile: "templates/service.test.ts.hbs",
      },
      {
        type: "add",
        path: "e2e/features/{{name}}/{{name}}.feature",
        templateFile: "templates/feature.feature.hbs",
      },
      {
        type: "add",
        path: "e2e/steps/{{name}}/{{name}}.steps.ts",
        templateFile: "templates/steps.ts.hbs",
      },
      { type: "registerRouter" },
      () =>
        "\n  Next steps:\n    1. Add a Prisma model in packages/db/prisma/schema/ if this feature owns persistent state.\n    2. Replace the @adr NNNN placeholders in the hook + service once you create an ADR.\n    3. Implement the generated TODO markers — the scaffold is a compilable stub, not a finished feature.\n    4. Run `make lint` + `make test-unit` to confirm green.\n",
    ],
  });
}
