// translate_notices reads the notices a guardian already sees in the portal (public, live), never the staff-only editor list.
import { describe, expect, it, vi } from "vitest";
import { permissionsFor } from "@/lib/auth/permissions";

const calls: Array<[string, string, unknown]> = [];
vi.mock("@/lib/supabase/server", () => {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "lte", "or", "order", "limit"]) builder[m] = () => builder;
  builder.eq = (col: string, val: unknown) => (calls.push(["eq", col, val]), builder);
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: [{ id: "n1", title: "Holiday", body: "Closed Friday", publish_at: "2026-11-01" }], error: null });
  const client = { from: () => builder };
  return { createClient: async () => client, createAnonClient: () => client };
});

describe("translate_notices source", () => {
  it("points at a query a guardian may call, not the website.edit one", async () => {
    const { CAPABILITIES } = await import("@/modules/ai/capabilities/catalog");
    await import("@/modules/website/query-defs");
    const { getQueryMeta } = await import("@/lib/actions/define-query");
    const names = CAPABILITIES.translate_notices.queries ?? [];
    expect(names).toEqual(["website.listPublishedNotices"]);
    const meta = getQueryMeta().get(names[0]!)!;
    expect(permissionsFor("guardian")).toContain(meta.permission);
    expect(getQueryMeta().get("website.listNotices")!.permission).toBe("website.edit");
    expect(permissionsFor("guardian")).not.toContain("website.edit");
  });

  it("reads only public notices of the institution", async () => {
    const { listPublicNotices } = await import("@/modules/website/queries");
    const rows = await listPublicNotices("inst-1", 20);
    expect(rows.map((r) => r.title)).toEqual(["Holiday"]);
    expect(calls).toContainEqual(["eq", "is_public", true]);
    expect(calls).toContainEqual(["eq", "institution_id", "inst-1"]);
  });
});
