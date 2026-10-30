import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "@/lib/nav";

// T-044 hosted finding: three sidebar links had no page, so production
// prefetches 404'd on every staff screen. Every nav href must be a real route.
const TENANT_APP_DIR = path.join(process.cwd(), "src", "app", "(tenant)", "[institution]");

describe("Navigation routes", () => {
  it("every sidebar link points to an existing tenant page", () => {
    const missing = NAV_ITEMS.map((item) => item.href).filter(
      (href) => !fs.existsSync(path.join(TENANT_APP_DIR, ...href.split("/").filter(Boolean), "page.tsx")),
    );
    expect(missing).toEqual([]);
  });
});
