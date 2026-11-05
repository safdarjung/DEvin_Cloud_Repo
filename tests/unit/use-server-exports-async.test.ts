import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// M16 security review (MEDIUM): src/modules/exams/actions.ts exported
// `throwMappedSchedule`, a non-async function, from a "use server" file.
// Next.js requires every export of a "use server" module to be an async
// Server Action; a non-async export 500s EVERY action route built on that
// module at request time (not at build/typecheck time), which is how this
// broke /login app-wide for M16's e2e runs (T10/T11/T12/T14). Fixed by
// moving throwMapped/throwMappedSchedule into schedule-conflicts.ts (no
// "use server" directive). This guards against the pattern recurring in
// any "use server" module.
const SRC_DIR = path.join(process.cwd(), "src");
const DIRECTIVE = '"use server";';
const BAD_EXPORT = /^export function \w/m;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('"use server" files export only async functions', () => {
  it("no \"use server\" module has a non-async top-level `export function`", () => {
    const offenders: string[] = [];

    for (const file of walk(SRC_DIR)) {
      const content = fs.readFileSync(file, "utf8");
      const firstLine = content.split("\n").find((line) => line.trim().length > 0)?.trim();
      if (firstLine !== DIRECTIVE) continue;
      if (BAD_EXPORT.test(content)) offenders.push(path.relative(process.cwd(), file));
    }

    expect(offenders).toEqual([]);
  });
});
