// Enforce: no email literal is used in more than one scenario across all
// e2e feature files. Two scenarios referencing the same email race on
// user/session state under `fullyParallel: true`. Current convention gives
// every scenario a unique email (e.g. "signin@example.com", "create-todo@
// example.com"). This check locks that in at lint time.
//
// Intra-scenario reuse is allowed: the same email can appear in a Given and
// a When within one scenario. That's the common case (set up a user, then
// act as them).

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const FEATURES_DIR = path.resolve(import.meta.dirname, "../features");

const EMAIL_RE = /"([^"@\s]+@[^"@\s]+)"/g;
const SCENARIO_RE = /^\s*Scenario(?: Outline)?:\s*(.+?)\s*$/;
const BACKGROUND_RE = /^\s*Background:/;

type ScenarioRef = { file: string; line: number; title: string };

const emailToScenarios = new Map<string, ScenarioRef[]>();

for (const file of readdirSync(FEATURES_DIR).sort()) {
  if (!file.endsWith(".feature")) continue;
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

    // Emails in a Background apply to every scenario in the file — that's
    // cross-scenario collision by definition. Fail loudly rather than trying
    // to track them per-sibling-scenario.
    if (inBackground) {
      const match = line.match(EMAIL_RE);
      if (match) {
        console.error(
          `FAIL: email literal "${match[0]}" used in Background at ${file}:${i + 1}. Background emails collide across every sibling scenario — put the email in each scenario's Given step instead.`,
        );
        process.exit(1);
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

if (duplicates.length === 0) {
  console.log(
    `OK: ${emailToScenarios.size} emails, each used in exactly one scenario.`,
  );
  process.exit(0);
}

console.error(
  `FAIL: ${duplicates.length} email(s) used in multiple scenarios. Parallel workers sharing a user ID race on DB state — give each scenario a unique email.`,
);
for (const [email, refs] of duplicates) {
  console.error(`\n  "${email}" used in:`);
  for (const r of refs) {
    console.error(`    ${r.file}:${r.line}  ${r.title}`);
  }
}
process.exit(1);
