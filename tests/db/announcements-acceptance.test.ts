// M06-T6 — announcements acceptance over HTTP: admin publishes (section +
// role=teacher) -> job runner fans out -> right people notified, opt-outs
// honoured, audit visible. Mirrors documents-acceptance.test.ts /
// imports-acceptance.test.ts: @/lib/supabase/server is NOT mocked, real
// bearer tokens, real RLS. The job runner is run once via runOnceCore, the
// same way tests/db/jobs.test.ts does (never notifyAnnouncement directly).
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { POST as actionsPost } from "@/app/api/v1/actions/[name]/route";
import { GET as queryGet } from "@/app/api/v1/query/[name]/route";
import { createRunnerPorts, runOnceCore } from "@/modules/jobs/runner";
import { closeRolesHelper, createTestInstitution, type FixtureRole, type TestInstitution } from "../helpers/roles";

process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

function actionRequest(name: string, body: unknown, headers: Record<string, string>): Request {
  return new Request(`http://localhost/api/v1/actions/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function dispatchAction(name: string, body: unknown, headers: Record<string, string>): Promise<Response> {
  return actionsPost(actionRequest(name, body, headers), { params: Promise.resolve({ name }) });
}

function queryUrl(name: string, institution: string, input: unknown): URL {
  const url = new URL(`http://localhost/api/v1/query/${name}`);
  url.searchParams.set("institution", institution);
  url.searchParams.set("input", JSON.stringify(input));
  return url;
}

function dispatchQuery(name: string, institution: string, input: unknown, headers: Record<string, string>): Promise<Response> {
  return queryGet(new Request(queryUrl(name, institution, input), { headers }), { params: Promise.resolve({ name }) });
}

async function tokenFor(inst: TestInstitution, role: FixtureRole): Promise<string> {
  const { data, error } = await inst.clientAs(role).auth.getSession();
  if (error || !data.session) throw error ?? new Error(`no session for ${role}`);
  return data.session.access_token;
}

/** Current academic year + one grade + one section, with the fixture student actively enrolled there. */
async function makeSectionFixture(inst: TestInstitution): Promise<{ sectionId: string }> {
  const [year] = await sql`
    insert into public.academic_years (institution_id, name, starts_on, ends_on, is_current)
    values (${inst.institutionId}, 'AY', '2026-04-01', '2027-03-31', true)
    returning id
  `;
  const [grade] = await sql`
    insert into public.grades (institution_id, code, display_name, sort_key, grade_group)
    values (${inst.institutionId}, 'VI', 'Grade VI', 6, 'middle')
    returning id
  `;
  const [section] = await sql`
    insert into public.class_sections (institution_id, grade_id, academic_year_id, name)
    values (${inst.institutionId}, ${grade.id}, ${year.id}, 'A')
    returning id
  `;

  const [studentMembership] = await sql`
    select student_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.student.id}
  `;
  const studentId = studentMembership.student_id as string;
  await sql`
    insert into public.enrolments (institution_id, student_id, class_section_id, academic_year_id, started_on, status)
    values (${inst.institutionId}, ${studentId}, ${section.id}, ${year.id}, '2026-04-01', 'active')
  `;

  const [guardianMembership] = await sql`
    select guardian_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.guardian.id}
  `;
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${inst.institutionId}, ${guardianMembership.guardian_id}, ${studentId}, 'father', true, true)
  `;

  return { sectionId: section.id as string };
}

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

describe("M06 announcements acceptance: admin publishes -> job runner fans out -> recipients notified over HTTP", () => {
  it(
    "guardian of the section sees the section notice (not the teacher notice); guardian's direct PostgREST " +
      "select on announcements is empty; a guardian with sms disabled for 'announcement' gets no sms delivery " +
      "attempt; admin's audit log shows announcement.published",
    async () => {
      const inst = await createTestInstitution("announcements-acceptance");
      try {
        const { sectionId } = await makeSectionFixture(inst);

        const adminAuth = { authorization: `Bearer ${await tokenFor(inst, "admin")}` };
        const guardianAuth = { authorization: `Bearer ${await tokenFor(inst, "guardian")}` };

        // --- guardian opts out of sms for 'announcement' before publish ---
        const prefRes = await dispatchAction(
          "notification.preferences.set",
          { institution: inst.slug, input: { category: "announcement", channel: "sms", enabled: false } },
          guardianAuth,
        );
        expect(prefRes.status).toBe(200);
        expect((await prefRes.json()).ok).toBe(true);

        // --- admin creates + publishes a section announcement ----------
        const createSection = await dispatchAction(
          "announcement.create",
          {
            institution: inst.slug,
            input: {
              title: "Section Holiday Notice",
              body: "Section A is closed Friday for a festival.",
              audiences: [{ type: "section", classSectionId: sectionId }],
            },
          },
          adminAuth,
        );
        expect(createSection.status).toBe(200);
        const createSectionBody = await createSection.json();
        expect(createSectionBody.ok).toBe(true);
        const sectionAnnouncementId = createSectionBody.data.announcementId as string;

        const publishSection = await dispatchAction(
          "announcement.publish",
          { institution: inst.slug, input: { announcementId: sectionAnnouncementId } },
          adminAuth,
        );
        expect(publishSection.status).toBe(200);
        expect((await publishSection.json()).ok).toBe(true);

        // --- admin creates + publishes a role=teacher announcement -----
        const createTeacher = await dispatchAction(
          "announcement.create",
          {
            institution: inst.slug,
            input: {
              title: "Staff Meeting Notice",
              body: "All teachers meet in the staff room Monday.",
              audiences: [{ type: "role", role: "teacher" }],
            },
          },
          adminAuth,
        );
        expect(createTeacher.status).toBe(200);
        const createTeacherBody = await createTeacher.json();
        expect(createTeacherBody.ok).toBe(true);
        const teacherAnnouncementId = createTeacherBody.data.announcementId as string;

        const publishTeacher = await dispatchAction(
          "announcement.publish",
          { institution: inst.slug, input: { announcementId: teacherAnnouncementId } },
          adminAuth,
        );
        expect(publishTeacher.status).toBe(200);
        expect((await publishTeacher.json()).ok).toBe(true);

        // --- run the job runner once (as tests/db/jobs.test.ts does) ---
        const summary = await runOnceCore({ workerId: "test-worker-announcements-acceptance" }, createRunnerPorts(admin));
        expect(summary.succeeded).toBeGreaterThanOrEqual(2);
        expect(summary.dead).toBe(0);

        // --- guardian sees the section notice, not the teacher notice --
        const notifsRes = await dispatchQuery("notifications.listMyNotifications", inst.slug, {}, guardianAuth);
        expect(notifsRes.status).toBe(200);
        const notifsBody = await notifsRes.json();
        expect(notifsBody.ok).toBe(true);
        // Notification `title` is the fixed per-type template title ("New
        // announcement"); the announcement's own title is interpolated
        // into `body` (`${title}: ${excerpt}` — src/modules/notifications/templates.ts).
        const bodies = (notifsBody.data as { body: string }[]).map((n) => n.body);
        expect(bodies.some((b) => b.includes("Section Holiday Notice"))).toBe(true);
        expect(bodies.some((b) => b.includes("Staff Meeting Notice"))).toBe(false);

        // --- guardian's direct PostgREST select on announcements: empty -
        const directSelect = await inst.clientAs("guardian").from("announcements").select("id");
        expect(directSelect.error).toBeNull();
        expect(directSelect.data).toEqual([]);

        // --- guardian has in-app but no sms delivery attempt -----------
        const [notification] = await sql<{ id: string }[]>`
          select id from public.notifications
          where institution_id = ${inst.institutionId}::uuid
            and recipient_user_id = ${inst.users.guardian.id}::uuid
            and type = 'announcement'
        `;
        expect(notification).toBeDefined();
        const attempts = await sql<{ channel: string }[]>`
          select channel from public.delivery_attempts where notification_id = ${notification.id}::uuid
        `;
        const channels = attempts.map((a) => a.channel);
        expect(channels).toContain("in_app");
        expect(channels).not.toContain("sms");

        // --- admin's audit log shows announcement.published ------------
        const auditRes = await dispatchQuery("core.audit.list", inst.slug, { page: 1, pageSize: 50 }, adminAuth);
        expect(auditRes.status).toBe(200);
        const auditBody = await auditRes.json();
        expect(auditBody.ok).toBe(true);
        const events = auditBody.data.rows as { event: string }[];
        expect(events.filter((e) => e.event === "announcement.published")).toHaveLength(2);
      } finally {
        await inst.cleanup();
      }
    },
  );
});
