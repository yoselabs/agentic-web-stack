// Shape Up pitch ↔ BDD `@ui:<element>` bidirectional coverage check.
//
// For each `docs/requirements/pitches/**/pitch.md` with `status: shipped`
// and `ui_elements:` front-matter, every listed element must be tagged
// `@ui:<element>` in at least one `.feature`.
// Every `@ui:<X>` tag in a feature must resolve to a ui_elements entry
// on a shipped pitch.
//
// Inert when there's no pitches/ directory yet (this template ships without
// one). Fires automatically the first time a pitch lands.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { type CheckResult, timeCheck } from "./checks-types.ts";

const DEFAULT_ROOT = process.cwd();
const PITCH_GLOB = "docs/requirements/pitches/**/pitch.md";
const FEATURE_GLOBS = ["e2e/features/*.feature", "e2e/features/**/*.feature"];
const UI_TAG_RE = /@ui:([A-Za-z0-9_-]+)/g;

type PitchFront = {
  status?: string;
  ui_elements?: string[] | string;
};

export function runPitchCoverage(root: string = DEFAULT_ROOT): {
  errors: string[];
} {
  const errors: string[] = [];
  if (!existsSync(join(root, "docs/requirements/pitches"))) {
    return { errors }; // inert
  }

  let pitchesRaw: Buffer;
  try {
    pitchesRaw = execSync(`git ls-files -z "${PITCH_GLOB}"`, {
      cwd: root,
      maxBuffer: 1024 * 1024 * 4,
    });
  } catch {
    return { errors };
  }
  const pitchFiles = pitchesRaw.toString("utf8").split("\0").filter(Boolean);

  // Map element -> owning pitch path (for resolution in bidirectional check).
  const shippedElements = new Map<string, string>();
  for (const rel of pitchFiles) {
    const { data } = matter(readFileSync(join(root, rel), "utf8")) as {
      data: PitchFront;
    };
    if ((data.status ?? "").toLowerCase() !== "shipped") continue;
    const elements = Array.isArray(data.ui_elements)
      ? data.ui_elements
      : typeof data.ui_elements === "string"
        ? [data.ui_elements]
        : [];
    for (const e of elements) shippedElements.set(e, rel);
  }

  // Collect @ui:X tags across features.
  let featuresRaw: Buffer;
  try {
    featuresRaw = execSync(
      `git ls-files -z ${FEATURE_GLOBS.map((g) => `"${g}"`).join(" ")}`,
      {
        cwd: root,
        maxBuffer: 1024 * 1024 * 8,
      },
    );
  } catch {
    featuresRaw = Buffer.from("");
  }
  const featureFiles = featuresRaw.toString("utf8").split("\0").filter(Boolean);

  const coveredElements = new Set<string>();
  const stragglerTags: Array<{ file: string; line: number; tag: string }> = [];

  for (const rel of featureFiles) {
    const src = readFileSync(join(root, rel), "utf8");
    UI_TAG_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: canonical regex loop
    while ((m = UI_TAG_RE.exec(src))) {
      const tag = m[1];
      if (!tag) continue;
      coveredElements.add(tag);
      if (!shippedElements.has(tag)) {
        const line = src.slice(0, m.index).split("\n").length;
        stragglerTags.push({ file: rel, line, tag });
      }
    }
  }

  // Forward check: shipped element must be covered.
  for (const [element, pitchRel] of shippedElements) {
    if (!coveredElements.has(element)) {
      errors.push(
        `${pitchRel}  ui_elements entry \`${element}\` has no @ui:${element} tag in any .feature.`,
      );
    }
  }

  // Backward check: @ui:X must resolve to a shipped pitch element.
  for (const s of stragglerTags) {
    errors.push(
      `${s.file}:${s.line}  @ui:${s.tag} does not resolve to any shipped pitch's ui_elements.`,
    );
  }

  return { errors };
}

export function checkPitchCoverage(): Promise<CheckResult> {
  return timeCheck("check-pitch-coverage", () => runPitchCoverage().errors);
}

if (import.meta.main) {
  const result = await checkPitchCoverage();
  if (!result.ok) {
    for (const e of result.errors) console.error(`[check-pitch-coverage] ${e}`);
    process.exit(1);
  }
  console.log("[check-pitch-coverage] OK");
}
