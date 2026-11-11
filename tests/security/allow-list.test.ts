import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// 07 §6 C-90 / C-91 (T-042). The ESLint `no-restricted-imports` rule is the CI
// gate for C-90; this walk is the same check as a test, independent of the
// lint config's override globs.
const ROOT = process.cwd();

// 07 §4 service-role allow-list, as src/ paths.
const ADMIN_IMPORT_ALLOWED = [
  "src/lib/ai/usage.ts",
  "src/modules/jobs/with-service-role.ts",
  "src/modules/website/with-service-role.ts",
  "src/modules/finance/with-service-role.ts",
  "src/modules/agents/service-role.ts",
  "src/modules/ai/tasks/service-role.ts",
  "src/modules/insights/briefings.service-role.ts",
  "src/modules/core/setup/with-service-role.ts",
];

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.(ts|tsx|js|mjs)$/.test(e.name) ? [full] : [];
  });
}

describe("C-90: service-role client imports stay on the allow-list", () => {
  it("only allow-listed src files import @/lib/supabase/admin", () => {
    const importers = walk(path.join(ROOT, "src"))
      .filter((f) => /from\s+["'](@\/lib\/supabase\/admin|(\.\.?\/)+(lib\/)?supabase\/admin)["']/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f))
      .sort();
    expect(importers.filter((f) => !ADMIN_IMPORT_ALLOWED.includes(f))).toEqual([]);
  });

  it("ESLint still restricts @/lib/supabase/admin imports", () => {
    const config = fs.readFileSync(path.join(ROOT, "eslint.config.mjs"), "utf8");
    expect(config).toMatch(/"no-restricted-imports"[\s\S]*name:\s*"@\/lib\/supabase\/admin"/);
  });
});

describe("C-91: secret scanning runs in CI", () => {
  it("a workflow runs gitleaks on push and pull_request", () => {
    const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/secrets.yml"), "utf8");
    expect(workflow).toMatch(/gitleaks\/gitleaks-action@/);
    expect(workflow).toMatch(/pull_request/);
    expect(workflow).toMatch(/push/);
  });
});
