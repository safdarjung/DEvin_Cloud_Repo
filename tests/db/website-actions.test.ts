import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mocks (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import {
  createPage,
  publishPage,
  savePageVersion,
  setWebsiteLive,
  upsertEvent,
  upsertNotice,
} from "@/modules/website/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

async function createdPageId(inst: TestInstitution): Promise<string> {
  const created = await callAs(inst, "owner", createPage, { slug: "home", title: "Home" });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error("setup failed");
  return created.data.id;
}

describe("website editor actions (T-025)", () => {
  it("owner creates a page, saves a draft -> v1, saves again -> v2 (never updates an existing version)", async () => {
    const inst = await createTestInstitution("website-versions");
    try {
      const pageId = await createdPageId(inst);

      const v1 = await callAs(inst, "owner", savePageVersion, {
        pageId,
        blocks: [{ type: "hero", heading: "Welcome" }],
      });
      expect(v1.ok).toBe(true);
      if (!v1.ok) return;
      expect(v1.data.versionNo).toBe(1);

      const v2 = await callAs(inst, "owner", savePageVersion, {
        pageId,
        blocks: [{ type: "hero", heading: "Welcome, updated" }],
      });
      expect(v2.ok).toBe(true);
      if (!v2.ok) return;
      expect(v2.data.versionNo).toBe(2);

      const rows = await sql`
        select version_no, blocks from public.page_versions where page_id = ${pageId}::uuid order by version_no
      `;
      expect(rows).toHaveLength(2);
      // v1's row was never touched by the second save (insert-only, 0010's trigger would reject an UPDATE anyway).
      expect(rows[0].blocks).toEqual([{ type: "hero", heading: "Welcome" }]);
      expect(rows[1].blocks).toEqual([{ type: "hero", heading: "Welcome, updated" }]);

      const [page] = await sql`select published_version_id from public.pages where id = ${pageId}::uuid`;
      expect(page.published_version_id).toBeNull();

      const auditRows = await sql`
        select action from public.audit_events
        where entity_id = ${v2.data.id}::uuid and action = 'website.page.version_saved'
      `;
      expect(auditRows).toHaveLength(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("invalid block (missing hero heading) -> validation_failed, no version row created", async () => {
    const inst = await createTestInstitution("website-invalid-block");
    try {
      const pageId = await createdPageId(inst);

      const result = await callAs(inst, "owner", savePageVersion, {
        pageId,
        blocks: [{ type: "hero", heading: "" }],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("validation_failed");

      const rows = await sql`select 1 from public.page_versions where page_id = ${pageId}::uuid`;
      expect(rows).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  });

  it("two concurrent saves for the same page both succeed with distinct version numbers, never a duplicate", async () => {
    const inst = await createTestInstitution("website-race");
    try {
      const pageId = await createdPageId(inst);

      const [a, b] = await Promise.all([
        callAs(inst, "owner", savePageVersion, { pageId, blocks: [{ type: "hero", heading: "A" }] }),
        callAs(inst, "principal", savePageVersion, { pageId, blocks: [{ type: "hero", heading: "B" }] }),
      ]);

      // Either both land (most likely, thanks to the retry) or the loser
      // gets `conflict` rather than a corrupted/duplicate row — never two
      // ok results sharing the same version_no.
      const okResults = [a, b].filter((r) => r.ok) as Array<{ ok: true; data: { versionNo: number } }>;
      expect(okResults.length).toBeGreaterThanOrEqual(1);
      const versionNos = okResults.map((r) => r.data.versionNo);
      expect(new Set(versionNos).size).toBe(versionNos.length);

      const rows = await sql`select version_no from public.page_versions where page_id = ${pageId}::uuid order by version_no`;
      const rowVersionNos = rows.map((r) => r.version_no as number);
      expect(new Set(rowVersionNos).size).toBe(rowVersionNos.length);
    } finally {
      await inst.cleanup();
    }
  });

  it("publishPage sets published_version_id and page_versions.published_at; admissions gets forbidden", async () => {
    const inst = await createTestInstitution("website-publish");
    try {
      const pageId = await createdPageId(inst);
      const saved = await callAs(inst, "owner", savePageVersion, {
        pageId,
        blocks: [{ type: "hero", heading: "Welcome" }],
      });
      expect(saved.ok).toBe(true);
      if (!saved.ok) return;

      const forbidden = await callAs(inst, "admissions", publishPage, { pageId, versionId: saved.data.id });
      expect(forbidden.ok).toBe(false);
      if (!forbidden.ok) expect(forbidden.error.code).toBe("forbidden");

      const published = await callAs(inst, "owner", publishPage, { pageId, versionId: saved.data.id });
      expect(published.ok).toBe(true);

      const [page] = await sql`select published_version_id from public.pages where id = ${pageId}::uuid`;
      expect(page.published_version_id).toBe(saved.data.id);

      const [version] = await sql`select published_at from public.page_versions where id = ${saved.data.id}::uuid`;
      expect(version.published_at).not.toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("publishPage rejects a page id from another institution with not_found, never leaking the other tenant's row", async () => {
    const instA = await createTestInstitution("website-cross-a");
    const instB = await createTestInstitution("website-cross-b");
    try {
      const pageIdB = await createdPageId(instB);
      const savedB = await callAs(instB, "owner", savePageVersion, {
        pageId: pageIdB,
        blocks: [{ type: "hero", heading: "B's page" }],
      });
      expect(savedB.ok).toBe(true);
      if (!savedB.ok) return;

      const result = await callAs(instA, "owner", publishPage, { pageId: pageIdB, versionId: savedB.data.id });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("not_found");
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  });

  it("setWebsiteLive: owner can flip is_live; admissions is forbidden (website.publish only)", async () => {
    const inst = await createTestInstitution("website-live");
    try {
      await createdPageId(inst); // provisions the websites row via createPage's getOrCreateWebsite

      const forbidden = await callAs(inst, "admissions", setWebsiteLive, { isLive: true });
      expect(forbidden.ok).toBe(false);
      if (!forbidden.ok) expect(forbidden.error.code).toBe("forbidden");

      const result = await callAs(inst, "owner", setWebsiteLive, { isLive: true });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.isLive).toBe(true);

      const [website] = await sql`select is_live from public.websites where institution_id = ${inst.institutionId}::uuid`;
      expect(website.is_live).toBe(true);
    } finally {
      await inst.cleanup();
    }
  });

  it("upsertNotice: admissions (website.edit) can create a notice; audit row carries only flags, never title/body", async () => {
    const inst = await createTestInstitution("website-notice");
    try {
      const result = await callAs(inst, "admissions", upsertNotice, {
        title: "Term 2 begins",
        body: "Classes resume Monday.",
        publishAt: new Date("2026-10-01T00:00:00Z").toISOString(),
        isPublic: true,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const [row] = await sql`select title, is_public from public.notices where id = ${result.data.id}::uuid`;
      expect(row.title).toBe("Term 2 begins");
      expect(row.is_public).toBe(true);

      const [auditRow] = await sql`
        select action, after from public.audit_events where entity_id = ${result.data.id}::uuid and action = 'website.notice.saved'
      `;
      expect(auditRow.after).toEqual({ isPublic: true, publishAt: expect.any(String) });
    } finally {
      await inst.cleanup();
    }
  });

  it("upsertEvent: admissions (website.edit) can create an event", async () => {
    const inst = await createTestInstitution("website-event");
    try {
      const result = await callAs(inst, "admissions", upsertEvent, {
        title: "Annual Sports Day",
        startsAt: new Date("2026-11-28T08:00:00Z").toISOString(),
        isPublic: true,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const [row] = await sql`select title, is_public from public.events where id = ${result.data.id}::uuid`;
      expect(row.title).toBe("Annual Sports Day");
      expect(row.is_public).toBe(true);
    } finally {
      await inst.cleanup();
    }
  });

  it("upsertNotice with another institution's notice id returns not_found, not internal (fix round 1)", async () => {
    const instA = await createTestInstitution("website-notice-cross-a");
    const instB = await createTestInstitution("website-notice-cross-b");
    try {
      const created = await callAs(instB, "owner", upsertNotice, {
        title: "B's notice",
        body: "Belongs to institution B.",
        publishAt: new Date("2026-10-01T00:00:00Z").toISOString(),
        isPublic: true,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await callAs(instA, "owner", upsertNotice, {
        id: created.data.id,
        title: "Hijacked",
        body: "Attempted cross-tenant edit.",
        publishAt: new Date("2026-10-01T00:00:00Z").toISOString(),
        isPublic: true,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("not_found");

      const [row] = await sql`select title from public.notices where id = ${created.data.id}::uuid`;
      expect(row.title).toBe("B's notice");
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  });

  it("upsertEvent with another institution's event id returns not_found, not internal (fix round 1)", async () => {
    const instA = await createTestInstitution("website-event-cross-a");
    const instB = await createTestInstitution("website-event-cross-b");
    try {
      const created = await callAs(instB, "owner", upsertEvent, {
        title: "B's event",
        startsAt: new Date("2026-11-28T08:00:00Z").toISOString(),
        isPublic: true,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await callAs(instA, "owner", upsertEvent, {
        id: created.data.id,
        title: "Hijacked",
        startsAt: new Date("2026-11-28T08:00:00Z").toISOString(),
        isPublic: true,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("not_found");

      const [row] = await sql`select title from public.events where id = ${created.data.id}::uuid`;
      expect(row.title).toBe("B's event");
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  });

  it("teacher (no website.edit) cannot create a page", async () => {
    const inst = await createTestInstitution("website-teacher-forbidden");
    try {
      const result = await callAs(inst, "teacher", createPage, { slug: "home", title: "Home" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });
});
