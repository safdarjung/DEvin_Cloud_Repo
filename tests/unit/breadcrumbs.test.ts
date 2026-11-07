import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PAGE_PATHS, crumbsFor } from "@/components/breadcrumbs";

describe("crumbsFor (F-BE-01)", () => {
  it("renders an intermediate segment with no page.tsx as text, not a link", () => {
    const crumbs = crumbsFor(
      "/demo/exams/11111111-1111-1111-1111-111111111111/papers/22222222-2222-2222-2222-222222222222",
    );
    const papers = crumbs.find((c) => c.label === "Papers");
    expect(papers).toBeDefined();
    expect(papers?.isLink).toBe(false);
  });

  it("renders a segment with a page.tsx as a link", () => {
    const crumbs = crumbsFor("/demo/finance/invoices/33333333-3333-3333-3333-333333333333");
    const invoices = crumbs.find((c) => c.label === "Invoices");
    expect(invoices).toBeDefined();
    expect(invoices?.isLink).toBe(true);
  });
});

describe("PAGE_PATHS", () => {
  it("lists every page.tsx under (tenant)/[institution]", () => {
    const root = join(process.cwd(), "src/app/(tenant)/[institution]");
    const found: string[] = [];
    const walk = (dir: string, rel: string[]) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, [...rel, /^\[.+\]$/.test(name) ? "*" : name]);
        else if (name === "page.tsx" && rel.length > 0) found.push(rel.join("/"));
      }
    };
    walk(root, []);
    expect(found.filter((p) => !PAGE_PATHS.has(p))).toEqual([]);
  });
});
