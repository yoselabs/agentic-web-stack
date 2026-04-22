// Enforces the cross-layer naming convention: a domain name that appears in one
// layer must appear in every OTHER layer relevant to it, except when on the
// allowlist.
//
// Layers:
//   - frontend:  apps/web/src/features/<name>/
//   - backend:   packages/api/src/domains/<name>/
//   - e2e-feat:  e2e/features/<name>/
//   - e2e-steps: e2e/steps/<name>/
//
// Allowlist: names intentionally present in only some layers. The VALUE is
// the set of layers where the name is ALLOWED to be missing. These reflect
// the repo's current asymmetries — re-audit whenever a new domain lands.
//
//   - auth       backend lives in packages/auth/ (not @project/api);
//                frontend + e2e present
//                → allowed-missing: backend
//   - admin      admin UI is Hono-mounted Bull Board (apps/server), not
//                apps/web; admin auth lives in apps/server/src/admin/
//                middleware, not @project/api
//                → allowed-missing: frontend, backend
//   - mobile-nav navigation is a WIDGET (apps/web/src/widgets/navbar.tsx),
//                not a feature, so no features/mobile-nav/ folder exists.
//                No backend domain either — purely a frontend/UI concern.
//                e2e coverage exists in its own subfolder.
//                → allowed-missing: frontend, backend
//   - todo       after Task 3's migration, todos merged into the
//                todo-list e2e subfolder (single domain from the BDD
//                perspective); frontend + backend still have their own
//                todo subfolder
//                → allowed-missing: e2e-feat, e2e-steps
//   - user       cross-cutting realtime aggregator (user-inbox channel,
//                username search); its behavior is exercised via
//                todo-list e2e scenarios, not a dedicated user/ e2e
//                folder
//                → allowed-missing: e2e-feat, e2e-steps
//   - dashboard  frontend-only page composing auth + todo-list concerns;
//                no backend domain, coverage lives in the domain e2e
//                folders it composes
//                → allowed-missing: backend, e2e-feat, e2e-steps
//   - landing    frontend-only public landing page; no backend, no
//                dedicated e2e (smoke-tested alongside auth)
//                → allowed-missing: backend, e2e-feat, e2e-steps
//
// Rule:
//   For each name present in any layer, it must also appear in every other
//   layer that's not in the allowlist's set-of-allowed-missing.
//
// Exits 1 on mismatch with a clear file-path message.

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { type CheckResult, timeCheck } from "./checks-types.ts";

const ROOT = process.cwd();

function listSubdirs(rel: string): string[] {
  const full = join(ROOT, rel);
  try {
    return readdirSync(full)
      .filter((name) => statSync(join(full, name)).isDirectory())
      .sort();
  } catch {
    return [];
  }
}

type Layer = "frontend" | "backend" | "e2e-feat" | "e2e-steps";

const ALLOWLIST: Record<string, Set<Layer>> = {
  auth: new Set(["backend"]),
  admin: new Set(["frontend", "backend"]),
  "mobile-nav": new Set(["frontend", "backend"]),
  "activity-feed": new Set(["frontend", "backend", "e2e-steps"]),
  user: new Set(["e2e-feat", "e2e-steps"]),
  dashboard: new Set(["backend", "e2e-feat", "e2e-steps"]),
  landing: new Set(["backend", "e2e-feat", "e2e-steps"]),
};

const layerPath: Record<Layer, string> = {
  frontend: "apps/web/src/features",
  backend: "packages/api/src/domains",
  "e2e-feat": "e2e/features",
  "e2e-steps": "e2e/steps",
};

export function checkDomainNames(): Promise<CheckResult> {
  return timeCheck("check-domain-names", () => {
    const frontend = new Set(listSubdirs("apps/web/src/features"));
    const backend = new Set(listSubdirs("packages/api/src/domains"));
    const e2eFeat = new Set(listSubdirs("e2e/features"));
    const e2eSteps = new Set(listSubdirs("e2e/steps"));
    const layerSets: Record<Layer, Set<string>> = {
      frontend,
      backend,
      "e2e-feat": e2eFeat,
      "e2e-steps": e2eSteps,
    };
    const allNames = new Set<string>([
      ...frontend,
      ...backend,
      ...e2eFeat,
      ...e2eSteps,
    ]);
    const errors: string[] = [];
    for (const name of [...allNames].sort()) {
      const allowedMissing = ALLOWLIST[name] ?? new Set<Layer>();
      const layers: Layer[] = ["frontend", "backend", "e2e-feat", "e2e-steps"];
      for (const layer of layers) {
        if (!layerSets[layer].has(name) && !allowedMissing.has(layer)) {
          errors.push(
            `"${name}" missing from ${layer} (expected at ${layerPath[layer]}/${name}/). If intentional, add to ALLOWLIST in scripts/check-domain-names.ts.`,
          );
        }
      }
    }
    return errors;
  });
}

if (import.meta.main) {
  const result = await checkDomainNames();
  if (!result.ok) {
    for (const e of result.errors) console.error(`[check-domain-names] ${e}`);
    process.exit(1);
  }
  console.log("[check-domain-names] OK");
}
