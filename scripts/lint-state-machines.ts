// Gherkin `@state-machine(...)` completeness check.
//
// A feature tagged `@state-machine(a,b,c)` must have one scenario per listed
// state, each tagged with `@state:<name>`. Catches the "I added a state but
// forgot to cover one" class of bug at lint time instead of via a flaky
// Playwright run.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AstBuilder,
  GherkinClassicTokenMatcher,
  Parser,
} from "@cucumber/gherkin";
import { IdGenerator } from "@cucumber/messages";
import { type CheckResult, timeCheck } from "./checks-types.ts";

const DEFAULT_ROOT = process.cwd();

const STATE_MACHINE_RE = /@state-machine\(([^)]+)\)/;
const STATE_TAG_RE = /^@state:(.+)$/;

type ParsedFeature = { featureTags: string[]; scenarioTags: string[][] };

function parseFeature(src: string): ParsedFeature {
  const parser = new Parser(
    new AstBuilder(IdGenerator.uuid()),
    new GherkinClassicTokenMatcher(),
  );
  const doc = parser.parse(src);
  const feature = doc.feature;
  if (!feature) return { featureTags: [], scenarioTags: [] };
  const featureTags = (feature.tags ?? []).map((t) => t.name);
  const scenarioTags: string[][] = [];
  for (const child of feature.children ?? []) {
    if (child.scenario) {
      scenarioTags.push((child.scenario.tags ?? []).map((t) => t.name));
    }
  }
  return { featureTags, scenarioTags };
}

export function runStateMachines(root: string = DEFAULT_ROOT): {
  errors: string[];
} {
  const errors: string[] = [];
  let rawList: Buffer;
  try {
    rawList = execSync(
      'git ls-files -z "e2e/features/*.feature" "e2e/features/**/*.feature"',
      {
        cwd: root,
        maxBuffer: 1024 * 1024 * 8,
      },
    );
  } catch {
    return { errors };
  }
  const files = rawList.toString("utf8").split("\0").filter(Boolean);

  for (const rel of files) {
    const abs = join(root, rel);
    const src = readFileSync(abs, "utf8");
    let parsed: ParsedFeature;
    try {
      parsed = parseFeature(src);
    } catch (err) {
      errors.push(
        `${rel}  gherkin parse failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    const smTag = parsed.featureTags.find((t) => STATE_MACHINE_RE.test(t));
    if (!smTag) continue;

    const match = STATE_MACHINE_RE.exec(smTag);
    const listed = (match?.[1] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (listed.length === 0) {
      errors.push(`${rel}  @state-machine(...) declared with no states.`);
      continue;
    }

    const covered = new Set<string>();
    for (const tags of parsed.scenarioTags) {
      for (const t of tags) {
        const m = STATE_TAG_RE.exec(t);
        if (m?.[1]) covered.add(m[1]);
      }
    }

    for (const state of listed) {
      if (!covered.has(state)) {
        errors.push(
          `${rel}  @state-machine declares state \`${state}\` but no scenario is tagged \`@state:${state}\`.`,
        );
      }
    }
  }

  return { errors };
}

export function checkStateMachines(): Promise<CheckResult> {
  return timeCheck("check-state-machines", () => runStateMachines().errors);
}

if (import.meta.main) {
  const result = await checkStateMachines();
  if (!result.ok) {
    for (const e of result.errors) console.error(`[lint-state-machines] ${e}`);
    process.exit(1);
  }
  console.log("[lint-state-machines] OK");
}
