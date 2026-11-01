import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

async function insertDraft(inst: { institutionId: string; users: { admin: { id: string } } }) {
  const [row] = await sql`
    insert into public.announcements (institution_id, title, body, created_by)
    values (${inst.institutionId}, 'Test announcement', 'Body text', ${inst.users.admin.id})
    returning id
  `;
  return row.id as string;
}

describe("announcements migration (0068) RLS + publish_announcement", () => {
  it("admin creates a draft announcement with an audience", async () => {
    const inst = await createTestInstitution("announce-create");
    try {
      const { data, error } = await inst
        .clientAs("admin")
        .from("announcements")
        .insert({
          institution_id: inst.institutionId,
          title: "Holiday notice",
          body: "School closed Friday",
          created_by: inst.users.admin.id,
        })
        .select("id")
        .single();
      expect(error).toBeNull();

      const audience = await inst.clientAs("admin").from("announcement_audiences").insert({
        announcement_id: data!.id,
        institution_id: inst.institutionId,
        audience_type: "school",
      });
      expect(audience.error).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher cannot insert or select announcements", async () => {
    const inst = await createTestInstitution("announce-teacher-write");
    try {
      const announcementId = await insertDraft(inst);

      const insertAttempt = await inst.clientAs("teacher").from("announcements").insert({
        institution_id: inst.institutionId,
        title: "Teacher attempt",
        body: "Body text",
        created_by: inst.users.teacher.id,
      });
      expect(insertAttempt.error).not.toBeNull();

      const { data, error } = await inst.clientAs("teacher").from("announcements").select("id").eq("id", announcementId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian cannot insert or select announcements", async () => {
    const inst = await createTestInstitution("announce-guardian-write");
    try {
      const announcementId = await insertDraft(inst);

      const insertAttempt = await inst.clientAs("guardian").from("announcements").insert({
        institution_id: inst.institutionId,
        title: "Guardian attempt",
        body: "Body text",
        created_by: inst.users.guardian.id,
      });
      expect(insertAttempt.error).not.toBeNull();

      const { data, error } = await inst.clientAs("guardian").from("announcements").select("id").eq("id", announcementId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian cannot read a role=teacher announcement (recipients never read this table)", async () => {
    const inst = await createTestInstitution("announce-guardian-role-audience");
    try {
      const announcementId = await insertDraft(inst);
      await sql`
        insert into public.announcement_audiences (announcement_id, institution_id, audience_type, role)
        values (${announcementId}, ${inst.institutionId}, 'role', 'teacher')
      `;

      const { data, error } = await inst.clientAs("guardian").from("announcements").select("id").eq("id", announcementId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    } finally {
      await inst.cleanup();
    }
  });

  it("publish as admin: status published + exactly one notify.announcement job with {announcement_id}", async () => {
    const inst = await createTestInstitution("announce-publish");
    try {
      const announcementId = await insertDraft(inst);
      await sql`
        insert into public.announcement_audiences (announcement_id, institution_id, audience_type)
        values (${announcementId}, ${inst.institutionId}, 'school')
      `;

      const { data, error } = await inst.clientAs("admin").rpc("publish_announcement", { p_announcement_id: announcementId });
      expect(error).toBeNull();
      expect(data.status).toBe("published");
      expect(data.published_at).not.toBeNull();

      const jobs = await sql`select payload from public.jobs where idempotency_key = ${"announcement:" + announcementId}`;
      expect(jobs).toHaveLength(1);
      expect(jobs[0].payload).toEqual({ announcement_id: announcementId });
    } finally {
      await inst.cleanup();
    }
  });

  it("publishing an announcement with no audience is rejected", async () => {
    const inst = await createTestInstitution("announce-publish-no-audience");
    try {
      const announcementId = await insertDraft(inst);

      const { error } = await inst.clientAs("admin").rpc("publish_announcement", { p_announcement_id: announcementId });
      expect(error).not.toBeNull();
      expect(error?.message).toContain("code:validation_failed");
    } finally {
      await inst.cleanup();
    }
  });

  it("publishing twice is rejected as invalid_state", async () => {
    const inst = await createTestInstitution("announce-publish-twice");
    try {
      const announcementId = await insertDraft(inst);
      await sql`
        insert into public.announcement_audiences (announcement_id, institution_id, audience_type)
        values (${announcementId}, ${inst.institutionId}, 'school')
      `;

      const first = await inst.clientAs("admin").rpc("publish_announcement", { p_announcement_id: announcementId });
      expect(first.error).toBeNull();

      const second = await inst.clientAs("admin").rpc("publish_announcement", { p_announcement_id: announcementId });
      expect(second.error).not.toBeNull();
      expect(second.error?.message).toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("editing an announcement after publish is rejected", async () => {
    const inst = await createTestInstitution("announce-edit-after-publish");
    try {
      const announcementId = await insertDraft(inst);
      await sql`
        insert into public.announcement_audiences (announcement_id, institution_id, audience_type)
        values (${announcementId}, ${inst.institutionId}, 'school')
      `;
      const published = await inst.clientAs("admin").rpc("publish_announcement", { p_announcement_id: announcementId });
      expect(published.error).toBeNull();

      const { error } = await inst
        .clientAs("admin")
        .from("announcements")
        .update({ title: "Edited after publish" })
        .eq("id", announcementId);
      expect(error).not.toBeNull();

      const [row] = await sql`select title from public.announcements where id = ${announcementId}`;
      expect(row.title).toBe("Test announcement");
    } finally {
      await inst.cleanup();
    }
  });

  it("audience insert on a published announcement is rejected", async () => {
    const inst = await createTestInstitution("announce-audience-after-publish");
    try {
      const announcementId = await insertDraft(inst);
      await sql`
        insert into public.announcement_audiences (announcement_id, institution_id, audience_type)
        values (${announcementId}, ${inst.institutionId}, 'school')
      `;
      const published = await inst.clientAs("admin").rpc("publish_announcement", { p_announcement_id: announcementId });
      expect(published.error).toBeNull();

      const { error } = await inst.clientAs("admin").from("announcement_audiences").insert({
        announcement_id: announcementId,
        institution_id: inst.institutionId,
        audience_type: "role",
        role: "teacher",
      });
      expect(error).not.toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher cannot publish (forbidden)", async () => {
    const inst = await createTestInstitution("announce-teacher-publish");
    try {
      const announcementId = await insertDraft(inst);
      await sql`
        insert into public.announcement_audiences (announcement_id, institution_id, audience_type)
        values (${announcementId}, ${inst.institutionId}, 'school')
      `;

      const { error } = await inst.clientAs("teacher").rpc("publish_announcement", { p_announcement_id: announcementId });
      expect(error).not.toBeNull();
      expect(error?.message).toContain("code:forbidden");

      const [row] = await sql`select status from public.announcements where id = ${announcementId}`;
      expect(row.status).toBe("draft");
    } finally {
      await inst.cleanup();
    }
  });

  it("user sets own notification preference, cannot read or write another user's", async () => {
    const inst = await createTestInstitution("announce-preferences");
    try {
      const setOwn = await inst.clientAs("teacher").from("notification_preferences").insert({
        user_id: inst.users.teacher.id,
        institution_id: inst.institutionId,
        category: "announcement",
        channel: "sms",
        enabled: false,
      });
      expect(setOwn.error).toBeNull();

      const readOwn = await inst
        .clientAs("teacher")
        .from("notification_preferences")
        .select("enabled")
        .eq("user_id", inst.users.teacher.id)
        .eq("category", "announcement")
        .eq("channel", "sms");
      expect(readOwn.data).toEqual([{ enabled: false }]);

      const writeOther = await inst.clientAs("guardian").from("notification_preferences").insert({
        user_id: inst.users.teacher.id,
        institution_id: inst.institutionId,
        category: "announcement",
        channel: "email",
        enabled: false,
      });
      expect(writeOther.error).not.toBeNull();

      const readOther = await inst
        .clientAs("guardian")
        .from("notification_preferences")
        .select("enabled")
        .eq("user_id", inst.users.teacher.id)
        .eq("category", "announcement")
        .eq("channel", "sms");
      expect(readOther.data).toEqual([]);
    } finally {
      await inst.cleanup();
    }
  });
});
