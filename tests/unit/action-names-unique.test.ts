import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MODULE_KEYS } from "@/lib/modules/catalog";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

// registerAction tolerates re-registration (Turbopack re-evaluates a shared
// "use server" module once per route), so name collisions are caught here
// statically instead of at load time (C-03).
const SRC_DIR = path.join(process.cwd(), "src");
const DEFINE_ACTION_CALL = /defineAction\s*(?:<[^>]*>)?\s*\(\s*\{/g;
const DEFINE_ACTION_NAME = /defineAction\s*(?:<[^>]*>)?\s*\(\s*\{\s*name:\s*["'`]([A-Za-z0-9_.]+)["'`]/g;
// M02 — same static-check shape as actions, mirrored for the separate query
// registry/namespace (src/lib/actions/define-query.ts).
const DEFINE_QUERY_CALL = /defineQuery\s*(?:<[^>]*>)?\s*\(\s*\{/g;
const DEFINE_QUERY_NAME = /defineQuery\s*(?:<[^>]*>)?\s*\(\s*\{\s*name:\s*["'`]([A-Za-z0-9_.]+)["'`]/g;

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

  it("every defineAction name is registered after importing the dispatcher manifest", async () => {
    const names = new Set<string>();
    for (const file of walk(SRC_DIR)) {
      if (file.endsWith(path.join("lib", "actions", "define-action.ts"))) continue;
      const content = fs.readFileSync(file, "utf8");
      for (const match of content.matchAll(DEFINE_ACTION_NAME)) names.add(match[1]);
    }

    await import("@/app/api/v1/actions/all-actions");
    const { getRegisteredActions } = await import("@/lib/actions/registry");

    expect(new Set(getRegisteredActions().keys())).toEqual(names);
  });
});

describe("Query names (M02)", () => {
  it("every defineQuery call has a literal name and no two queries share one", () => {
    const names: string[] = [];
    let calls = 0;

    for (const file of walk(SRC_DIR)) {
      if (file.endsWith(path.join("lib", "actions", "define-query.ts"))) continue;
      const content = fs.readFileSync(file, "utf8");
      calls += [...content.matchAll(DEFINE_QUERY_CALL)].length;
      for (const match of content.matchAll(DEFINE_QUERY_NAME)) names.push(match[1]);
    }

    expect(calls).toBeGreaterThan(0);
    expect(names).toHaveLength(calls);
    const duplicates = names.filter((name, i) => names.indexOf(name) !== i);
    expect(duplicates).toEqual([]);
  });

  it("every defineQuery name is registered after importing the query manifest", async () => {
    const names = new Set<string>();
    for (const file of walk(SRC_DIR)) {
      if (file.endsWith(path.join("lib", "actions", "define-query.ts"))) continue;
      const content = fs.readFileSync(file, "utf8");
      for (const match of content.matchAll(DEFINE_QUERY_NAME)) names.add(match[1]);
    }

    await import("@/app/api/v1/query/all-queries");
    const { getRegisteredQueries } = await import("@/lib/actions/define-query");

    expect(new Set(getRegisteredQueries().keys())).toEqual(names);
  });
});

describe("Module declared on every registered action/query (MOD-T13)", () => {
  it("every action meta has a module in MODULE_KEYS", async () => {
    await import("@/app/api/v1/actions/all-actions");
    const { getActionMeta } = await import("@/lib/actions/registry");

    for (const [name, meta] of getActionMeta()) {
      expect(MODULE_KEYS, `action "${name}" has no module`).toContain(meta.module);
    }
  });

  it("every query meta has a module in MODULE_KEYS", async () => {
    await import("@/app/api/v1/query/all-queries");
    const { getQueryMeta } = await import("@/lib/actions/define-query");

    for (const [name, meta] of getQueryMeta()) {
      expect(MODULE_KEYS, `query "${name}" has no module`).toContain(meta.module);
    }
  });
});
