import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import {
  createAnnouncement,
  publishAnnouncement,
  setNotificationPreference,
} from "@/modules/notifications/announcements.actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { createGrade } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions } from "../helpers/roles";

// M06-T5 — announcement.create / announcement.publish / notification.preferences.set.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

describe("announcement.create / announcement.publish (M06-T5)", () => {
  it("admin creates and publishes a school-wide announcement -> job queued", async () => {
    const inst = await createTestInstitution("announce-actions-create-publish");
    try {
      const created = await callAs(inst, "admin", createAnnouncement, {
        title: "Holiday notice",
        body: "School closed Friday",
        audiences: [{ type: "school" }],
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const published = await callAs(inst, "admin", publishAnnouncement, {
        announcementId: created.data.announcementId,
      });
      expect(published.ok).toBe(true);
      if (!published.ok) return;
      expect(published.data.status).toBe("published");

      const jobs = await sql`
        select payload from public.jobs
        where idempotency_key = ${"announcement:" + created.data.announcementId}
      `;
      expect(jobs).toHaveLength(1);
      expect(jobs[0].payload).toEqual({ announcement_id: created.data.announcementId });
    } finally {
      await inst.cleanup();
    }
  });

  it("a teacher is forbidden from creating an announcement", async () => {
    const inst = await createTestInstitution("announce-actions-teacher-forbidden");
    try {
      const result = await callAs(inst, "teacher", createAnnouncement, {
        title: "Teacher attempt",
        body: "Body text",
        audiences: [{ type: "school" }],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("an audience grade from another institution is rejected", async () => {
    await withTwoInstitutions(async (a, b) => {
      const gradeOfB = await createGrade(b.institutionId);
      const result = await callAs(a, "admin", createAnnouncement, {
        title: "Cross-institution grade",
        body: "Body text",
        audiences: [{ type: "grade", gradeId: gradeOfB }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("validation_failed");
    });
  });
});

describe("notification.preferences.set (M06-T5)", () => {
  it("round-trips a preference for the caller's own row", async () => {
    const inst = await createTestInstitution("announce-actions-preferences");
    try {
      const set = await callAs(inst, "guardian", setNotificationPreference, {
        category: "announcement",
        channel: "sms",
        enabled: false,
      });
      expect(set.ok).toBe(true);
      if (!set.ok) return;
      expect(set.data).toEqual({ category: "announcement", channel: "sms", enabled: false });

      const [row] = await sql`
        select enabled from public.notification_preferences
        where user_id = ${inst.users.guardian.id} and institution_id = ${inst.institutionId}
          and category = 'announcement' and channel = 'sms'
      `;
      expect(row.enabled).toBe(false);

      const updated = await callAs(inst, "guardian", setNotificationPreference, {
        category: "announcement",
        channel: "sms",
        enabled: true,
      });
      expect(updated.ok).toBe(true);
      if (!updated.ok) return;
      expect(updated.data.enabled).toBe(true);
    } finally {
      await inst.cleanup();
    }
  });
});
