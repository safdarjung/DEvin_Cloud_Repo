import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS } from "@/lib/auth/permissions";

const SRC_DIR = path.join(process.cwd(), "src");
const VALID_PERMISSIONS = new Set(Object.values(ROLE_PERMISSIONS).flat());

const REQUIRE_PERMISSION_CALL = /requirePermission\s*\([^,]+,\s*["'`]([a-z][a-z.]+)["'`]/g;
const PERMISSION_FIELD = /permission:\s*["'`]([a-z][a-z.]+)["'`]/g;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe("Permission literals (C-03 criterion 4)", () => {
  it("every literal passed to requirePermission(...)/permission: exists in the matrix", () => {
    const found = new Set<string>();

    for (const file of walk(SRC_DIR)) {
      const content = fs.readFileSync(file, "utf8");
      for (const match of content.matchAll(REQUIRE_PERMISSION_CALL)) found.add(match[1]);
      for (const match of content.matchAll(PERMISSION_FIELD)) found.add(match[1]);
    }

    const unknown = [...found].filter((p) => !VALID_PERMISSIONS.has(p as never));
    expect(unknown).toEqual([]);
  });
});
