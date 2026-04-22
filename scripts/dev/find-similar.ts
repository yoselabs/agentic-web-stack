// Similar-name detector — help AI agents find reusable code.
//
// Walks apps/*/src/** and packages/*/src/** (skipping tests, dist, generated,
// .output), extracts exported functions / React components / hooks / types,
// groups them by semantic name similarity, and writes a report so agents can
// find existing code to reuse instead of recreating it.
//
// Output:
//   - Markdown summary on stdout
//   - .similar-report.json at repo root (gitignored)
//
// Invocation: `make similar` → `bun scripts/dev/find-similar.ts`.
// Flags: --json (suppress markdown), --markdown (suppress json). Default: both.
//
// Advisory-only — always exits 0.

import { writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  type ArrowFunction,
  type FunctionDeclaration,
  Node,
  Project,
  type SourceFile,
  type VariableDeclaration,
} from "ts-morph";

const ROOT = process.cwd();

type ItemKind = "function" | "component" | "hook" | "type";

type Item = {
  name: string;
  path: string;
  line: number;
  kind: ItemKind;
  signature: string;
};

type Group = {
  normalizedName: string;
  similarity: "normalized-match" | "jaro-winkler";
  items: Item[];
};

const args = new Set(process.argv.slice(2));
const wantJson = !args.has("--markdown") || args.has("--json");
const wantMarkdown = !args.has("--json") || args.has("--markdown");

// ──────────────────────────────────────────────────────────────────────────
// File discovery
// ──────────────────────────────────────────────────────────────────────────

const INCLUDE_GLOBS = [
  "apps/*/src/**/*.ts",
  "apps/*/src/**/*.tsx",
  "packages/*/src/**/*.ts",
  "packages/*/src/**/*.tsx",
];

const EXCLUDE_GLOBS = [
  "**/__tests__/**",
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.spec.ts",
  "**/*.spec.tsx",
  "**/dist/**",
  "**/generated/**",
  "**/.output/**",
  "**/node_modules/**",
  "**/routeTree.gen.ts",
];

const project = new Project({
  skipAddingFilesFromTsConfig: true,
  skipFileDependencyResolution: true,
  useInMemoryFileSystem: false,
  compilerOptions: {
    allowJs: false,
    jsx: 4 /* Preserve */,
  },
});

project.addSourceFilesAtPaths([
  ...INCLUDE_GLOBS,
  ...EXCLUDE_GLOBS.map((g) => `!${g}`),
]);

// ──────────────────────────────────────────────────────────────────────────
// Extraction
// ──────────────────────────────────────────────────────────────────────────

const items: Item[] = [];

function signatureOfFunction(fn: FunctionDeclaration | ArrowFunction): string {
  const params = fn
    .getParameters()
    .map((p) => {
      const name = p.getName();
      const typeNode = p.getTypeNode();
      const typeText = typeNode ? typeNode.getText() : undefined;
      return typeText ? `${name}: ${typeText}` : name;
    })
    .join(", ");
  const returnTypeNode = fn.getReturnTypeNode();
  const returnType = returnTypeNode ? returnTypeNode.getText() : "";
  return returnType ? `(${params}) => ${returnType}` : `(${params})`;
}

function returnsJsx(fn: FunctionDeclaration | ArrowFunction): boolean {
  const body = fn.getBody();
  if (!body) return false;
  const bodyText = body.getText();
  // Cheap heuristic: looks for JSX tag opening or return with JSX.
  return (
    /return\s*\(\s*</.test(bodyText) ||
    /return\s*</.test(bodyText) ||
    /=>\s*</.test(bodyText)
  );
}

function classifyFunction(
  name: string,
  fn: FunctionDeclaration | ArrowFunction,
): ItemKind {
  if (name.startsWith("use") && name.length > 3 && /[A-Z]/.test(name[3] ?? ""))
    return "hook";
  if (/^[A-Z]/.test(name) && returnsJsx(fn)) return "component";
  return "function";
}

function pushItem(
  name: string,
  kind: ItemKind,
  signature: string,
  sf: SourceFile,
  pos: number,
): void {
  const { line } = sf.getLineAndColumnAtPos(pos);
  items.push({
    name,
    path: relative(ROOT, sf.getFilePath()),
    line,
    kind,
    signature,
  });
}

function extractFromVariableDeclaration(
  decl: VariableDeclaration,
  sf: SourceFile,
): void {
  const name = decl.getName();
  if (!name) return;
  const init = decl.getInitializer();
  if (!init) return;
  if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
    // FunctionExpression shares enough of the surface we treat similarly.
    const arrow = init as ArrowFunction;
    const kind = classifyFunction(name, arrow);
    pushItem(name, kind, signatureOfFunction(arrow), sf, decl.getStart());
  }
}

for (const sf of project.getSourceFiles()) {
  // Exported function declarations
  for (const fn of sf.getFunctions()) {
    if (!fn.isExported()) continue;
    const name = fn.getName();
    if (!name) continue;
    const kind = classifyFunction(name, fn);
    pushItem(name, kind, signatureOfFunction(fn), sf, fn.getStart());
  }

  // Exported variable statements (const foo = ..., const Foo = () => ...)
  for (const vs of sf.getVariableStatements()) {
    if (!vs.isExported()) continue;
    for (const decl of vs.getDeclarations()) {
      extractFromVariableDeclaration(decl, sf);
    }
  }

  // Exported type aliases
  for (const ta of sf.getTypeAliases()) {
    if (!ta.isExported()) continue;
    const name = ta.getName();
    const typeNode = ta.getTypeNodeOrThrow();
    const text = typeNode.getText();
    const summary = text.length <= 80 ? text : `${text.slice(0, 77)}...`;
    pushItem(name, "type", summary, sf, ta.getStart());
  }

  // Exported interfaces
  for (const iface of sf.getInterfaces()) {
    if (!iface.isExported()) continue;
    const name = iface.getName();
    const fieldCount = iface.getProperties().length;
    pushItem(
      name,
      "type",
      `interface with ${fieldCount} field${fieldCount === 1 ? "" : "s"}`,
      sf,
      iface.getStart(),
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Normalization + grouping
// ──────────────────────────────────────────────────────────────────────────

const PREFIXES = [
  "use",
  "create",
  "get",
  "set",
  "fetch",
  "load",
  "update",
  "delete",
  "remove",
  "make",
  "build",
  "handle",
  "on",
  "is",
  "has",
  "with",
  "to",
  "from",
  "parse",
  "format",
  "ensure",
];

const SUFFIXES = [
  "handler",
  "options",
  "props",
  "component",
  "service",
  "controller",
  "factory",
  "provider",
  "context",
  "hook",
  "type",
  "input",
  "output",
  "result",
  "response",
  "request",
  "config",
  "schema",
];

function normalizeName(name: string): string {
  // Split camelCase / PascalCase / snake_case / kebab-case into words
  const words = name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  // Strip leading prefixes (greedy while matches)
  let start = 0;
  while (start < words.length - 1 && PREFIXES.includes(words[start] ?? ""))
    start++;

  // Strip trailing suffixes
  let end = words.length;
  while (end > start + 1 && SUFFIXES.includes(words[end - 1] ?? "")) end--;

  const stripped = words.slice(start, end);
  // Fallback: if stripping emptied the name, use original word list
  const final = stripped.length > 0 ? stripped : words;
  return final.join("");
}

// Jaro-Winkler implementation (compact, no deps).
function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;

  const matchDistance = Math.floor(Math.max(a.length, b.length) / 2) - 1;
  const aMatches = new Array<boolean>(a.length).fill(false);
  const bMatches = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j]) continue;
      if (a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const transpositions = t / 2;

  const jaro =
    (matches / a.length +
      matches / b.length +
      (matches - transpositions) / matches) /
    3;

  // Winkler boost for up to 4-char common prefix
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

// Group by normalized name first.
const byNormalized = new Map<string, Item[]>();
for (const item of items) {
  const norm = normalizeName(item.name);
  if (!norm) continue;
  const bucket = byNormalized.get(norm) ?? [];
  bucket.push(item);
  byNormalized.set(norm, bucket);
}

const groups: Group[] = [];
const claimed = new Set<string>(); // item identity: path:line:name

function itemKey(i: Item): string {
  return `${i.path}:${i.line}:${i.name}`;
}

// First pass: normalized-match groups with ≥2 items.
for (const [norm, bucket] of byNormalized) {
  if (bucket.length < 2) continue;
  groups.push({
    normalizedName: norm,
    similarity: "normalized-match",
    items: bucket,
  });
  for (const it of bucket) claimed.add(itemKey(it));
}

// Second pass: Jaro-Winkler over remaining normalized names (singletons).
const remainingNorms = [...byNormalized.entries()].filter(
  ([_, bucket]) => bucket.length === 1 && !claimed.has(itemKey(bucket[0])),
);

const THRESHOLD = 0.9;
const JW_MIN_LEN = 4; // avoid pairing very short names

for (let i = 0; i < remainingNorms.length; i++) {
  const [normA, bucketA] = remainingNorms[i];
  const itemA = bucketA[0];
  if (claimed.has(itemKey(itemA))) continue;
  if (normA.length < JW_MIN_LEN) continue;

  const cluster: Item[] = [itemA];
  for (let j = i + 1; j < remainingNorms.length; j++) {
    const [normB, bucketB] = remainingNorms[j];
    const itemB = bucketB[0];
    if (claimed.has(itemKey(itemB))) continue;
    if (normB.length < JW_MIN_LEN) continue;
    const score = jaroWinkler(normA, normB);
    if (score >= THRESHOLD) {
      cluster.push(itemB);
      claimed.add(itemKey(itemB));
    }
  }
  if (cluster.length >= 2) {
    claimed.add(itemKey(itemA));
    groups.push({
      normalizedName: normA,
      similarity: "jaro-winkler",
      items: cluster,
    });
  }
}

// Sort groups: largest first, then alphabetical.
groups.sort((a, b) => {
  if (b.items.length !== a.items.length) return b.items.length - a.items.length;
  return a.normalizedName.localeCompare(b.normalizedName);
});

// Sort items within a group by path.
for (const g of groups) {
  g.items.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}

// ──────────────────────────────────────────────────────────────────────────
// Output
// ──────────────────────────────────────────────────────────────────────────

const totalItems = groups.reduce((n, g) => n + g.items.length, 0);

if (wantMarkdown) {
  const lines: string[] = [];
  lines.push(
    `## Similar names found — ${groups.length} group${groups.length === 1 ? "" : "s"}, ${totalItems} item${totalItems === 1 ? "" : "s"}`,
    "",
  );
  let idx = 1;
  for (const g of groups) {
    lines.push(
      `### Group ${idx}: "${g.normalizedName}" (${g.similarity}, ${g.items.length})`,
    );
    for (const it of g.items) {
      lines.push(`- **${it.name}** [${it.kind}] \`${it.signature}\``);
      lines.push(`  \`${it.path}:${it.line}\``);
    }
    lines.push("");
    idx++;
  }
  if (groups.length === 0) lines.push("_No similar-name clusters found._", "");
  process.stdout.write(`${lines.join("\n")}\n`);
}

if (wantJson) {
  const payload = {
    generatedAt: new Date().toISOString(),
    totalItems,
    groupCount: groups.length,
    groups,
  };
  const out = join(ROOT, ".similar-report.json");
  writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
  if (wantMarkdown)
    process.stdout.write(`\n[find-similar] Wrote ${relative(ROOT, out)}\n`);
}

process.exit(0);
