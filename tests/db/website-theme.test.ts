// website.theme.save + `websites.theme` access (0010 policies, 0045 grants):
// website.publish roles save through the action; teacher/guardian are
// refused by both the action and RLS; one school never writes another's row;
// anon reads the theme only for a live site.
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { saveWebsiteTheme } from "@/modules/website/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

const THEME = {
  primary: "#1E3A8A",
  accent: "#D4A017",
  background: "#FFFDF7",
  foreground: "#1F2937",
  headingFont: "classic_serif",
  bodyFont: "system",
  radius: "small",
  heroStyle: "banner",
} as const;

async function themeOf(institutionId: string): Promise<unknown> {
  const rows = await sql`select theme from public.websites where institution_id = ${institutionId}::uuid`;
  return rows[0]?.theme ?? null;
}

describe("website.theme.save", () => {
  it("owner saves the theme (creating the website row); principal and admin can overwrite it; each save is audited", async () => {
    const inst = await createTestInstitution("theme-save");
    try {
      const saved = await callAs(inst, "owner", saveWebsiteTheme, THEME);
      expect(saved.ok).toBe(true);
      expect(await themeOf(inst.institutionId)).toEqual(THEME);

      for (const role of ["principal", "admin"] as const) {
        const next = { ...THEME, heroStyle: role === "principal" ? "centered" : "split" } as const;
        const res = await callAs(inst, role, saveWebsiteTheme, next);
        expect(res.ok, role).toBe(true);
        expect(await themeOf(inst.institutionId)).toEqual(next);
      }

      const audits = await sql`
        select 1 from public.audit_events
        where institution_id = ${inst.institutionId}::uuid and action = 'website.theme.saved'
      `;
      expect(audits).toHaveLength(3);
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher, guardian and admissions get forbidden and nothing is written", async () => {
    const inst = await createTestInstitution("theme-forbidden");
    try {
      for (const role of ["teacher", "guardian", "admissions"] as const) {
        const res = await callAs(inst, role, saveWebsiteTheme, THEME);
        expect(res.ok, role).toBe(false);
        if (!res.ok) expect(res.error.code, role).toBe("forbidden");
      }
      expect(await themeOf(inst.institutionId)).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("a colour carrying CSS (url(), ';') is validation_failed and never stored", async () => {
    const inst = await createTestInstitution("theme-invalid");
    try {
      const res = await callAs(inst, "owner", saveWebsiteTheme, { ...THEME, primary: "#000000;background:url(x)" });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("validation_failed");
      expect(await themeOf(inst.institutionId)).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });
});

describe("websites.theme RLS", () => {
  it("teacher and guardian cannot write the theme directly", async () => {
    const inst = await createTestInstitution("theme-rls");
    try {
      await sql`insert into public.websites (institution_id, is_live) values (${inst.institutionId}, false)`;
      for (const role of ["teacher", "guardian"] as const) {
        const { data } = await inst
          .clientAs(role)
          .from("websites")
          .update({ theme: THEME })
          .eq("institution_id", inst.institutionId)
          .select("id");
        expect(data ?? [], role).toEqual([]);
      }
      expect(await themeOf(inst.institutionId)).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("school A's owner cannot write school B's theme, directly or through the action", async () => {
    await withTwoInstitutions(async (a, b) => {
      await sql`insert into public.websites (institution_id, is_live) values (${b.institutionId}, true)`;

      const { data } = await a.clientAs("owner").from("websites").update({ theme: THEME }).eq("institution_id", b.institutionId).select("id");
      expect(data ?? []).toEqual([]);

      const viaAction = await callAs(a, "owner", saveWebsiteTheme, THEME);
      expect(viaAction.ok).toBe(true);
      expect(await themeOf(a.institutionId)).toEqual(THEME);
      expect(await themeOf(b.institutionId)).toBeNull();
    });
  });

  it("anon reads the theme only while the site is live", async () => {
    const inst = await createTestInstitution("theme-anon");
    try {
      await sql`insert into public.websites (institution_id, is_live, theme) values (${inst.institutionId}, false, ${sql.json(THEME)})`;
      const anon = inst.clientAsAnon();

      const offline = await anon.from("websites").select("theme").eq("institution_id", inst.institutionId);
      expect(offline.data ?? []).toEqual([]);
      const offlineSite = await anon.rpc("get_public_site", { p_slug: inst.slug });
      expect(offlineSite.data ?? []).toEqual([]);

      await sql`update public.websites set is_live = true where institution_id = ${inst.institutionId}::uuid`;

      const live = await anon.from("websites").select("theme").eq("institution_id", inst.institutionId);
      expect(live.data).toEqual([{ theme: THEME }]);
      const liveSite = await anon.rpc("get_public_site", { p_slug: inst.slug });
      expect((liveSite.data as Array<{ theme: unknown }>)[0]?.theme).toEqual(THEME);
    } finally {
      await inst.cleanup();
    }
  });
});
