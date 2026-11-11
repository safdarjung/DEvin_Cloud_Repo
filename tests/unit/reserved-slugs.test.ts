import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RESERVED_SLUGS } from "@/modules/core/schemas";

// SQL is authoritative: the latest migration that adds
// institutions_slug_not_reserved holds the reserved list; RESERVED_SLUGS mirrors it.
const SLUG_FORMAT = /^[a-z0-9](-?[a-z0-9])*$/; // create_institution (0064)
const NOT_ROUTES = new Set(["layout", "page", "template", "loading", "error", "global-error", "not-found", "default"]);
const MIGRATIONS = path.join(process.cwd(), "supabase/migrations");

function sqlReservedLists(): string[][] {
  return fs
    .readdirSync(MIGRATIONS)
    .sort()
    .flatMap((file) => {
      const text = fs.readFileSync(path.join(MIGRATIONS, file), "utf8");
      const match = /add constraint institutions_slug_not_reserved\s+check \(slug <> all \(array\[([^\]]*)\]/.exec(text);
      return match ? [[...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1])] : [];
    });
}

// First URL segments under src/app. A route group "(x)" exposes its children at
// the root; dynamic "[x]", parallel "@x" and private "_x" folders are not fixed
// segments; a root file maps to its metadata route (icon.tsx -> /icon).
function topLevelSegments(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      if (/^\(.+\)$/.test(entry.name)) return topLevelSegments(path.join(dir, entry.name));
      return /^[[@_]/.test(entry.name) ? [] : [entry.name];
    }
    const base = entry.name.replace(/\.(tsx?|jsx?)$/, "");
    return NOT_ROUTES.has(base) ? [] : [base];
  });
}

describe("reserved institution slugs", () => {
  const lists = sqlReservedLists();
  const sqlList = lists.at(-1) ?? [];

  it("every top-level app route a slug could equal is reserved in SQL", () => {
    const segments = topLevelSegments(path.join(process.cwd(), "src/app")).filter((s) => SLUG_FORMAT.test(s));
    expect(segments).toContain("start");
    expect(segments.filter((s) => !sqlList.includes(s))).toEqual([]);
  });

  it("RESERVED_SLUGS equals the SQL constraint list", () => {
    expect([...RESERVED_SLUGS].sort()).toEqual([...sqlList].sort());
  });

  it("each re-added constraint keeps every value of the one before it", () => {
    expect(lists.length).toBeGreaterThanOrEqual(2);
    lists.slice(1).forEach((list, i) => expect(lists[i].filter((s) => !list.includes(s))).toEqual([]));
  });
});
