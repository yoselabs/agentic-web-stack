// Enforce: no email literal is used in more than one scenario across all
// e2e feature files. Two scenarios referencing the same email race on
// user/session state under `fullyParallel: true`. Current convention gives
// every scenario a unique email (e.g. "signin@example.com", "create-todo@
// example.com"). This check locks that in at lint time.
//
// Intra-scenario reuse is allowed: the same email can appear in a Given and
// a When within one scenario. That's the common case (set up a user, then
// act as them).

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { type CheckResult, timeCheck } from "@project/lint/checks-types";

const FEATURES_DIR = path.resolve(import.meta.dirname, "../features");

const EMAIL_RE = /"([^"@\s]+@[^"@\s]+)"/g;
const SCENARIO_RE = /^\s*Scenario(?: Outline)?:\s*(.+?)\s*$/;
const BACKGROUND_RE = /^\s*Background:/;

type ScenarioRef = { file: string; line: number; title: string };

export function checkFeatureEmails(): Promise<CheckResult> {
  return timeCheck("check-feature-emails", () => {
    const errors: string[] = [];
    const emailToScenarios = new Map<string, ScenarioRef[]>();

    let featureFiles: string[];
    try {
      const allEntries = readdirSync(FEATURES_DIR, {
        recursive: true,
      }) as string[];
      featureFiles = allEntries
        .filter((entry) => entry.endsWith(".feature"))
        .sort();
    } catch {
      return [];
    }

    for (const file of featureFiles) {
      const content = readFileSync(path.join(FEATURES_DIR, file), "utf8");
      const lines = content.split("\n");

      let currentScenario: ScenarioRef | null = null;
      let inBackground = false;
      const scenarioEmails = new Set<string>();

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";

        if (BACKGROUND_RE.test(line)) {
          inBackground = true;
          currentScenario = null;
          continue;
        }

        const scenarioMatch = line.match(SCENARIO_RE);
        if (scenarioMatch) {
          inBackground = false;
          currentScenario = {
            file,
            line: i + 1,
            title: scenarioMatch[1] ?? "",
          };
          scenarioEmails.clear();
          continue;
        }

        if (inBackground) {
          const match = line.match(EMAIL_RE);
          if (match) {
            errors.push(
              `${file}:${i + 1}: email literal ${match[0]} used in Background — Background emails collide across every sibling scenario. Put the email in each scenario's Given step instead.`,
            );
          }
        }

        if (!currentScenario) continue;

        for (const match of line.matchAll(EMAIL_RE)) {
          const email = match[1];
          if (!email || scenarioEmails.has(email)) continue;
          scenarioEmails.add(email);
          const list = emailToScenarios.get(email) ?? [];
          list.push(currentScenario);
          emailToScenarios.set(email, list);
        }
      }
    }

    const duplicates = [...emailToScenarios.entries()].filter(
      ([, refs]) => refs.length > 1,
    );
    for (const [email, refs] of duplicates) {
      const refsStr = refs
        .map((r) => `${r.file}:${r.line} "${r.title}"`)
        .join(", ");
      errors.push(
        `email "${email}" used in ${refs.length} scenarios: ${refsStr}. Give each scenario a unique email — parallel workers sharing a user ID race on DB state.`,
      );
    }
    return errors;
  });
}

if (import.meta.main) {
  // TODO(Phase-3): remove WIPE_IN_PROGRESS guard once e2e/features/**/*.feature files are restored.
  // See docs/superpowers/specs/2026-04-28-effect-rewrite-phase-1-design.md
  if (process.env.WIPE_IN_PROGRESS === "1") {
    console.log(
      "[check-feature-emails] skipped — wipe in progress (Phase 1 design doc)",
    );
    process.exit(0);
  }

  const result = await checkFeatureEmails();
  if (!result.ok) {
    console.error(`FAIL: ${result.errors.length} email collision(s).`);
    for (const e of result.errors) console.error(`  ${e}`);
    process.exit(1);
  }
  console.log(`OK: feature-file emails unique per scenario.`);
}
