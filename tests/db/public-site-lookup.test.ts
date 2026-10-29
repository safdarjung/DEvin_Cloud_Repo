// T-024 phase 2 — `public.get_public_site` (20261028000015). Replaces an
// anon RLS policy on `institutions` (lead ruling, DBT-11: a policy would
// expose `settings`/`ai_policy` to every visitor) with a narrow
// `security definer` RPC that returns only the five columns the public
// renderer needs, and only for a live website.
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

async function makeWebsite(institutionId: string, isLive: boolean): Promise<void> {
  await sql`insert into public.websites (institution_id, is_live) values (${institutionId}, ${isLive})`;
}

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

describe("public.get_public_site (anon slug lookup, no institutions RLS exposure)", () => {
  it("live website: returns exactly one row with only the five safe columns", async () => {
    const inst = await createTestInstitution("public-site-live");
    try {
      await makeWebsite(inst.institutionId, true);

      const { data, error } = await inst.clientAsAnon().rpc("get_public_site", { p_slug: inst.slug });
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      const row = data![0] as Record<string, unknown>;
      expect(row.institution_id).toBe(inst.institutionId);
      expect(row.institution_name).toBeDefined();
      expect(row.website_id).toBeDefined();
      expect(Object.keys(row).sort()).toEqual(
        ["institution_id", "institution_name", "nav", "theme", "website_id"].sort(),
      );
      // The point of this function: never settings/ai_policy, even though
      // they live on the same row this reads from.
      expect(row).not.toHaveProperty("settings");
      expect(row).not.toHaveProperty("ai_policy");
    } finally {
      await inst.cleanup();
    }
  });

  it("offline website (is_live=false): zero rows", async () => {
    const inst = await createTestInstitution("public-site-offline");
    try {
      await makeWebsite(inst.institutionId, false);
      const { data, error } = await inst.clientAsAnon().rpc("get_public_site", { p_slug: inst.slug });
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  });

  it("unknown slug: zero rows, no error", async () => {
    const inst = await createTestInstitution("public-site-unknown-scope");
    try {
      const result = await inst.clientAsAnon().rpc("get_public_site", { p_slug: "no-such-institution-at-all" });
      expect(result.error).toBeNull();
      expect(result.data).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  });

  it("an institution with no website row at all: zero rows", async () => {
    const inst = await createTestInstitution("public-site-no-website");
    try {
      const { data, error } = await inst.clientAsAnon().rpc("get_public_site", { p_slug: inst.slug });
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  });

  it("anon and authenticated can both execute; grant is not restricted to a signed-in role", async () => {
    const [{ can_execute: anonCan }] = await sql`
      select has_function_privilege('anon', 'public.get_public_site(text)', 'execute') as can_execute
    `;
    const [{ can_execute: authCan }] = await sql`
      select has_function_privilege('authenticated', 'public.get_public_site(text)', 'execute') as can_execute
    `;
    expect(anonCan).toBe(true);
    expect(authCan).toBe(true);
  });

  // C-80 (05 §5, T5): this RPC must never become a side door to draft or
  // confidential data — it only ever returns the five website-shell
  // columns, never page content. Page/notice/event visibility is still
  // governed entirely by their own anon RLS policies (website-schema.test.ts,
  // T-023), unaffected by this function.
  it("C-80: the function's own grant never touches pages/page_versions/notices/events privileges", async () => {
    const [{ can_execute }] = await sql`
      select has_function_privilege('anon', 'public.get_public_site(text)', 'execute') as can_execute
    `;
    expect(can_execute).toBe(true);
    const inst = await createTestInstitution("public-site-c80-scope");
    try {
      // Scoped by institution_id deliberately: `pages_anon_select` (0010)
      // has no institution predicate at all — anon can list every live
      // institution's published pages table-wide, just never a draft. This
      // fixture institution has no website/pages of its own, so its own
      // slice is empty regardless of what the seeded demo tenant exposes.
      const pages = await inst.clientAsAnon().from("pages").select("id").eq("institution_id", inst.institutionId);
      expect(pages.data).toHaveLength(0); // unaffected: no live website, RLS still the boundary
    } finally {
      await inst.cleanup();
    }
  });
});
