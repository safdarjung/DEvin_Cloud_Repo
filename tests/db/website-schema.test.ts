import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

async function makeWebsite(institutionId: string, isLive: boolean): Promise<string> {
  const [row] = await sql`
    insert into public.websites (institution_id, is_live) values (${institutionId}, ${isLive}) returning id
  `;
  return row.id as string;
}

async function makePage(institutionId: string, websiteId: string, slug = "home"): Promise<string> {
  const [row] = await sql`
    insert into public.pages (institution_id, website_id, slug, title)
    values (${institutionId}, ${websiteId}, ${slug}, 'Home')
    returning id
  `;
  return row.id as string;
}

async function makeVersion(institutionId: string, pageId: string, versionNo: number): Promise<string> {
  const [row] = await sql`
    insert into public.page_versions (institution_id, page_id, version_no, blocks)
    values (${institutionId}, ${pageId}, ${versionNo}, '[]'::jsonb)
    returning id
  `;
  return row.id as string;
}

describe("website migration (0010) schema + RLS", () => {
  // C-80 / T5: v1 published, v2 is still a draft — anon must see v1 only,
  // never v2, even though both versions belong to the same (live) page.
  it("C-80: anon sees only the published version, never a sibling draft", async () => {
    const inst = await createTestInstitution("web-c80");
    try {
      const websiteId = await makeWebsite(inst.institutionId, true);
      const pageId = await makePage(inst.institutionId, websiteId);
      const v1 = await makeVersion(inst.institutionId, pageId, 1);
      const v2 = await makeVersion(inst.institutionId, pageId, 2);

      const publish = await inst.clientAs("admin").rpc("publish_page", { p_page_id: pageId, p_version_id: v1 });
      expect(publish.error).toBeNull();

      const anonVersions = await inst
        .clientAsAnon()
        .from("page_versions")
        .select("id")
        .eq("page_id", pageId);
      expect(anonVersions.data?.map((r) => r.id)).toEqual([v1]);
      expect(anonVersions.data?.map((r) => r.id)).not.toContain(v2);

      const anonPage = await inst.clientAsAnon().from("pages").select("id").eq("id", pageId);
      expect(anonPage.data).toHaveLength(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("C-80: anon on a non-live website sees nothing, even with a published page", async () => {
    const inst = await createTestInstitution("web-c80-offline");
    try {
      const websiteId = await makeWebsite(inst.institutionId, false);
      const pageId = await makePage(inst.institutionId, websiteId);
      const v1 = await makeVersion(inst.institutionId, pageId, 1);
      await inst.clientAs("admin").rpc("publish_page", { p_page_id: pageId, p_version_id: v1 });

      const anonWebsite = await inst.clientAsAnon().from("websites").select("id").eq("id", websiteId);
      expect(anonWebsite.data).toHaveLength(0);

      const anonPage = await inst.clientAsAnon().from("pages").select("id").eq("id", pageId);
      expect(anonPage.data).toHaveLength(0);

      const anonVersion = await inst.clientAsAnon().from("page_versions").select("id").eq("id", v1);
      expect(anonVersion.data).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  });

  it("app.publish_page: admissions is forbidden, admin succeeds and audits", async () => {
    const inst = await createTestInstitution("web-publish-role");
    try {
      const websiteId = await makeWebsite(inst.institutionId, true);
      const pageId = await makePage(inst.institutionId, websiteId);
      const v1 = await makeVersion(inst.institutionId, pageId, 1);

      const asAdmissions = await inst
        .clientAs("admissions")
        .rpc("publish_page", { p_page_id: pageId, p_version_id: v1 });
      expect(asAdmissions.error).not.toBeNull();

      const asAdmin = await inst.clientAs("admin").rpc("publish_page", { p_page_id: pageId, p_version_id: v1 });
      expect(asAdmin.error).toBeNull();
      expect(asAdmin.data.published_version_id).toBe(v1);

      const [versionRow] = await sql`select published_at from public.page_versions where id = ${v1}`;
      expect(versionRow.published_at).not.toBeNull();

      const [auditRow] = await sql`
        select action, entity_id from public.audit_events
        where institution_id = ${inst.institutionId} and action = 'website.page.published'
      `;
      expect(auditRow.entity_id).toBe(pageId);
    } finally {
      await inst.cleanup();
    }
  });

  it("app.publish_page: a version of a different page is code:validation_failed", async () => {
    const inst = await createTestInstitution("web-publish-mismatch");
    try {
      const websiteId = await makeWebsite(inst.institutionId, true);
      const pageA = await makePage(inst.institutionId, websiteId, "a");
      const pageB = await makePage(inst.institutionId, websiteId, "b");
      const versionOfB = await makeVersion(inst.institutionId, pageB, 1);

      const result = await inst
        .clientAs("admin")
        .rpc("publish_page", { p_page_id: pageA, p_version_id: versionOfB });
      expect(result.error?.message).toMatch(/validation_failed/);
    } finally {
      await inst.cleanup();
    }
  });

  it("page_versions is immutable: UPDATE of blocks raises, DELETE raises", async () => {
    const inst = await createTestInstitution("web-immutable");
    try {
      const websiteId = await makeWebsite(inst.institutionId, true);
      const pageId = await makePage(inst.institutionId, websiteId);
      const v1 = await makeVersion(inst.institutionId, pageId, 1);

      await expect(
        sql`update public.page_versions set blocks = '[{"x":1}]'::jsonb where id = ${v1}`,
      ).rejects.toThrow(/invalid_state/);

      await expect(sql`delete from public.page_versions where id = ${v1}`).rejects.toThrow(/invalid_state/);
    } finally {
      await inst.cleanup();
    }
  });

  it("pages.published_version_id cannot be set directly over PostgREST, only via app.publish_page", async () => {
    const inst = await createTestInstitution("web-guard-published");
    try {
      const websiteId = await makeWebsite(inst.institutionId, true);
      const pageId = await makePage(inst.institutionId, websiteId);
      const v1 = await makeVersion(inst.institutionId, pageId, 1);

      const direct = await inst
        .clientAs("admin")
        .from("pages")
        .update({ published_version_id: v1 })
        .eq("id", pageId);
      expect(direct.error).not.toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("website.edit members (owner/principal/admin/admissions) can write; others cannot", async () => {
    const inst = await createTestInstitution("web-edit-roles");
    try {
      for (const role of ["owner", "principal", "admin", "admissions"] as const) {
        const result = await inst
          .clientAs(role)
          .from("notices")
          .insert({ institution_id: inst.institutionId, title: `n-${role}`, body: "b" });
        expect(result.error).toBeNull();
      }

      for (const role of ["accountant", "exam_controller", "teacher", "student", "guardian"] as const) {
        const result = await inst
          .clientAs(role)
          .from("notices")
          .insert({ institution_id: inst.institutionId, title: `n-${role}`, body: "b" });
        expect(result.error).not.toBeNull();
      }

      // Every member reads every row of their institution, including drafts.
      const asTeacher = await inst.clientAs("teacher").from("notices").select("id");
      expect(asTeacher.data?.length).toBeGreaterThan(0);
    } finally {
      await inst.cleanup();
    }
  });
});
