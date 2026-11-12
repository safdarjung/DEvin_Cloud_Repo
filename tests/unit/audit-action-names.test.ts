import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// public.record_audit_event rejects anything outside these patterns with
// validation_failed (supabase/migrations/20261028000013_audit_event_rpc.sql),
// which fails the action after its write already landed.
const ACTION_RE = /^[a-z_]+(\.[a-z_]+)+$/;
const ENTITY_RE = /^[a-z_]+$/;
const AUDIT_CALL = /\baudit\(\s*\w+,\s*\{([^}]*)\}/g;
const ACTION_EXPR = /action:\s*([^,]+?)\s*,\s*entityType/;
const ENTITY_LITERAL = /entityType:\s*"([^"]+)"/;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe("audit event names", () => {
  it("every literal audit action and entityType matches the record_audit_event regex", () => {
    const bad: string[] = [];
    let checked = 0;

    for (const file of walk(path.join(process.cwd(), "src"))) {
      const content = fs.readFileSync(file, "utf8");
      for (const [, body] of content.matchAll(AUDIT_CALL)) {
        // covers plain literals and `cond ? "a.b" : "a.c"` (condition dropped); template literals are skipped
        const actionExpr = (body.match(ACTION_EXPR)?.[1] ?? "").split("?").pop() ?? "";
        for (const [, name] of actionExpr.matchAll(/"([^"]+)"/g)) {
          checked += 1;
          if (!ACTION_RE.test(name)) bad.push(`${path.relative(process.cwd(), file)}: action ${name}`);
        }
        const entity = body.match(ENTITY_LITERAL)?.[1];
        if (entity && !ENTITY_RE.test(entity)) bad.push(`${path.relative(process.cwd(), file)}: entityType ${entity}`);
      }
    }

    expect(checked).toBeGreaterThan(100);
    expect(bad).toEqual([]);
  });
});
