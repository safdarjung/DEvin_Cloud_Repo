import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// registerAction tolerates re-registration (Turbopack re-evaluates a shared
// "use server" module once per route), so name collisions are caught here
// statically instead of at load time (C-03).
const SRC_DIR = path.join(process.cwd(), "src");
const DEFINE_ACTION_CALL = /defineAction\s*(?:<[^>]*>)?\s*\(\s*\{/g;
const DEFINE_ACTION_NAME = /defineAction\s*(?:<[^>]*>)?\s*\(\s*\{\s*name:\s*["'`]([A-Za-z0-9_.]+)["'`]/g;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe("Action names (C-03)", () => {
  it("every defineAction call has a literal name and no two actions share one", () => {
    const names: string[] = [];
    let calls = 0;

    for (const file of walk(SRC_DIR)) {
      if (file.endsWith(path.join("lib", "actions", "define-action.ts"))) continue;
      const content = fs.readFileSync(file, "utf8");
      calls += [...content.matchAll(DEFINE_ACTION_CALL)].length;
      for (const match of content.matchAll(DEFINE_ACTION_NAME)) names.push(match[1]);
    }

    expect(calls).toBeGreaterThan(0);
    expect(names).toHaveLength(calls);
    const duplicates = names.filter((name, i) => names.indexOf(name) !== i);
    expect(duplicates).toEqual([]);
  });
});
