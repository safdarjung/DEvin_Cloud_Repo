// X08-T9 — PTM + survey acceptance over HTTP (real /api/v1/actions and
// /api/v1/query routes, real bearer tokens, real RLS) plus the one MOD
// gate test for this milestone. Fixture shape mirrors
// tests/db/announcements-acceptance.test.ts (dispatchAction/dispatchQuery)
// and tests/db/ptm-rls.test.ts (newFamily: a second guardian+child outside
// the one-per-role roster, for the double-booking case).
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
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
import { closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type FixtureRole, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const PASSWORD = "correct-horse-battery-staple";

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

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

async function tokenForClient(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) throw error ?? new Error("no session for second family");
  return data.session.access_token;
}

function adminSupabaseClient(): SupabaseClient {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SECRET_KEY as string,
  );
}

async function signedInClient(email: string): Promise<SupabaseClient> {
  const client = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
  );
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

/** A second guardian+child family outside the fixture's one-per-role roster (ptm-rls.test.ts pattern), enrolled in the same section as G1. */
async function newFamily(
  institutionId: string,
  sectionId: string,
  academicYearId: string,
  fullName: string,
): Promise<{ studentId: string; client: SupabaseClient }> {
  const email = `ptm-acc-${crypto.randomUUID()}@test.coolskool.test`;
  const { data, error } = await adminSupabaseClient().auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("test user was not created");

  const [guardian] = await sql`
    insert into public.guardians (institution_id, full_name, phone)
    values (${institutionId}, ${fullName}, ${`9${String(Math.floor(100000000 + Math.random() * 900000000))}`})
    returning id
  `;
  await sql`
    insert into public.memberships (institution_id, user_id, role, guardian_id)
    values (${institutionId}, ${data.user.id}, 'guardian', ${guardian.id})
  `;
  const [student] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, ${fullName}, '2015-06-01', 'other')
    returning id
  `;
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${institutionId}, ${guardian.id}, ${student.id}, 'father', true, true)
  `;
  await createEnrolment(institutionId, student.id as string, sectionId, academicYearId, { status: "active" });

  return { studentId: student.id as string, client: await signedInClient(email) };
}

function isoFuture(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function staffIdFor(institutionId: string, role: string): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${institutionId} and role = ${role}`;
  return row.staff_id as string;
}

async function studentIdFor(institutionId: string): Promise<string> {
  const [row] = await sql`select student_id from public.memberships where institution_id = ${institutionId} and role = 'student'`;
  return row.student_id as string;
}

async function guardianIdFor(institutionId: string): Promise<string> {
  const [row] = await sql`select guardian_id from public.memberships where institution_id = ${institutionId} and role = 'guardian'`;
  return row.guardian_id as string;
}

/** Academic year + grade VI + section A (class teacher = fixture teacher) + section B; fixture student (G1) enrolled in A. */
async function makeBase(inst: TestInstitution) {
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId, { code: "VI" });
  const teacherStaffId = await staffIdFor(inst.institutionId, "teacher");
  const sectionA = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A", classTeacherId: teacherStaffId });
  const sectionB = await createClassSection(inst.institutionId, gradeId, yearId, { name: "B" });
  const studentId = await studentIdFor(inst.institutionId);
  const guardianId = await guardianIdFor(inst.institutionId);
  await createEnrolment(inst.institutionId, studentId, sectionA, yearId, { status: "active" });
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${inst.institutionId}, ${guardianId}, ${studentId}, 'father', true, true)
  `;
  return { yearId, gradeId, sectionA, sectionB, teacherStaffId, studentId, guardianId };
}

describe("X08 PTM + survey acceptance over HTTP, with the one module-off -> forbidden gate check", () => {
  it(
    "admin publishes a 2-section PTM event -> teacher adds slots -> guardians book/conflict/cancel over HTTP; " +
      "admin runs an anonymous section survey -> guardian responds/conflicts, suppressed results; " +
      "disabling the ptm module forbids both booking and surveys for a guardian",
    async () => {
      const inst = await createTestInstitution("ptm-acceptance");
      try {
        const base = await makeBase(inst);
        const g2 = await newFamily(inst.institutionId, base.sectionA, base.yearId, "Second Family Child");

        const adminAuth = { authorization: `Bearer ${await tokenFor(inst, "admin")}` };
        const ownerAuth = { authorization: `Bearer ${await tokenFor(inst, "owner")}` };
        const teacherAuth = { authorization: `Bearer ${await tokenFor(inst, "teacher")}` };
        const g1Auth = { authorization: `Bearer ${await tokenFor(inst, "guardian")}` };
        const g2Auth = { authorization: `Bearer ${await tokenForClient(g2.client)}` };

        // --- admin creates a draft PTM event over both sections, publishes ---
        const createEvent = await dispatchAction(
          "ptm.event.create",
          {
            institution: inst.slug,
            input: {
              title: "Term PTM",
              eventDate: isoFuture(14),
              dayStartsAt: "10:00",
              dayEndsAt: "11:00",
              slotMinutes: 10,
              bookingClosesAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
              classSectionIds: [base.sectionA, base.sectionB],
            },
          },
          adminAuth,
        );
        expect(createEvent.status).toBe(200);
        const createEventBody = await createEvent.json();
        expect(createEventBody.ok).toBe(true);
        const eventId = createEventBody.data.id as string;

        const publishEvent = await dispatchAction("ptm.event.publish", { institution: inst.slug, input: { eventId } }, adminAuth);
        expect(publishEvent.status).toBe(200);
        expect((await publishEvent.json()).ok).toBe(true);

        // --- teacher adds own 10-minute slots 10:00-10:30 (3 slots) --------
        const addSlots = await dispatchAction(
          "ptm.slots.add",
          { institution: inst.slug, input: { eventId, from: "10:00", to: "10:30" } },
          teacherAuth,
        );
        expect(addSlots.status).toBe(200);
        const addSlotsBody = await addSlots.json();
        expect(addSlotsBody.ok).toBe(true);
        expect(addSlotsBody.data.added).toBe(3);

        // --- G1 sees 3 open slots for the child -----------------------------
        const forStudentRes = await dispatchQuery("ptm.forStudent", inst.slug, { studentId: base.studentId, eventId }, g1Auth);
        expect(forStudentRes.status).toBe(200);
        const forStudentBody = await forStudentRes.json();
        expect(forStudentBody.ok).toBe(true);
        const slots = forStudentBody.data as { slotId: string; seq: number; state: string }[];
        expect(slots).toHaveLength(3);
        expect(slots.every((s) => s.state === "open")).toBe(true);
        const [slot0, slot1] = slots.sort((a, b) => a.seq - b.seq);

        // --- G1 books slot 0 -> 200 ------------------------------------------
        const g1Books = await dispatchAction(
          "ptm.booking.create",
          { institution: inst.slug, input: { slotId: slot0.slotId, studentId: base.studentId } },
          g1Auth,
        );
        expect(g1Books.status).toBe(200);
        const g1BooksBody = await g1Books.json();
        expect(g1BooksBody.ok).toBe(true);
        const g1BookingId = g1BooksBody.data.bookingId as string;

        // --- G2 books the same slot -> 409 conflict (slot already taken) ---
        const g2Books = await dispatchAction(
          "ptm.booking.create",
          { institution: inst.slug, input: { slotId: slot0.slotId, studentId: g2.studentId } },
          g2Auth,
        );
        expect(g2Books.status).toBe(409);
        const g2BooksBody = await g2Books.json();
        expect(g2BooksBody.ok).toBe(false);
        expect(g2BooksBody.error.code).toBe("conflict");

        // --- G1 books a second slot with the same teacher for the same child -> 409
        const g1BooksAgain = await dispatchAction(
          "ptm.booking.create",
          { institution: inst.slug, input: { slotId: slot1.slotId, studentId: base.studentId } },
          g1Auth,
        );
        expect(g1BooksAgain.status).toBe(409);
        const g1BooksAgainBody = await g1BooksAgain.json();
        expect(g1BooksAgainBody.ok).toBe(false);
        expect(g1BooksAgainBody.error.code).toBe("conflict");

        // --- teacher's schedule shows the booked child -----------------------
        const scheduleRes = await dispatchQuery("ptm.teacherSchedule", inst.slug, { eventId }, teacherAuth);
        expect(scheduleRes.status).toBe(200);
        const scheduleBody = await scheduleRes.json();
        expect(scheduleBody.ok).toBe(true);
        const scheduleRows = scheduleBody.data as { slotId: string; booking: { studentId: string } | null }[];
        const bookedRow = scheduleRows.find((r) => r.slotId === slot0.slotId);
        expect(bookedRow?.booking?.studentId).toBe(base.studentId);

        // --- G1 cancels -> slot open again -----------------------------------
        const cancelRes = await dispatchAction(
          "ptm.booking.cancel",
          { institution: inst.slug, input: { bookingId: g1BookingId } },
          g1Auth,
        );
        expect(cancelRes.status).toBe(200);
        expect((await cancelRes.json()).ok).toBe(true);

        const afterCancelRes = await dispatchQuery("ptm.forStudent", inst.slug, { studentId: base.studentId, eventId }, g1Auth);
        const afterCancelBody = await afterCancelRes.json();
        const reopened = (afterCancelBody.data as { slotId: string; state: string }[]).find((s) => s.slotId === slot0.slotId);
        expect(reopened?.state).toBe("open");

        // --- admin runs an anonymous section survey --------------------------
        const createSurveyRes = await dispatchAction(
          "survey.create",
          {
            institution: inst.slug,
            input: {
              title: "PTM feedback",
              closesAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
              questions: [{ type: "text", prompt: "Any feedback on the PTM slots?" }],
              audiences: [{ type: "section", classSectionId: base.sectionA }],
            },
          },
          adminAuth,
        );
        expect(createSurveyRes.status).toBe(200);
        const createSurveyBody = await createSurveyRes.json();
        expect(createSurveyBody.ok).toBe(true);
        const surveyId = createSurveyBody.data.id as string;

        // --- G1 sees it in survey.mine -----------------------------------------
        const mineRes = await dispatchQuery("survey.mine", inst.slug, {}, g1Auth);
        expect(mineRes.status).toBe(200);
        const mineBody = await mineRes.json();
        expect(mineBody.ok).toBe(true);
        expect((mineBody.data as { id: string }[]).some((s) => s.id === surveyId)).toBe(true);

        // --- G1 responds -> 200, again -> 409 conflict --------------------------
        const respondRes = await dispatchAction(
          "survey.respond",
          { institution: inst.slug, input: { surveyId, answers: ["All good"] } },
          g1Auth,
        );
        expect(respondRes.status).toBe(200);
        expect((await respondRes.json()).ok).toBe(true);

        const respondAgainRes = await dispatchAction(
          "survey.respond",
          { institution: inst.slug, input: { surveyId, answers: ["Once more"] } },
          g1Auth,
        );
        expect(respondAgainRes.status).toBe(409);
        const respondAgainBody = await respondAgainRes.json();
        expect(respondAgainBody.ok).toBe(false);
        expect(respondAgainBody.error.code).toBe("conflict");

        // --- admin's results are suppressed (1 response, anonymous, < 3) -------
        const resultsRes = await dispatchQuery("survey.results", inst.slug, { surveyId }, adminAuth);
        expect(resultsRes.status).toBe(200);
        const resultsBody = await resultsRes.json();
        expect(resultsBody.ok).toBe(true);
        expect(resultsBody.data.suppressed).toBe(true);

        // --- G1 (no survey.manage) cannot read results -> 403 forbidden --------
        const g1ResultsRes = await dispatchQuery("survey.results", inst.slug, { surveyId }, g1Auth);
        expect(g1ResultsRes.status).toBe(403);
        const g1ResultsBody = await g1ResultsRes.json();
        expect(g1ResultsBody.ok).toBe(false);
        expect(g1ResultsBody.error.code).toBe("forbidden");

        // --- owner disables the ptm module: both booking and surveys forbid G1
        const disableModule = await dispatchAction(
          "core.module.set",
          { institution: inst.slug, input: { key: "ptm", enabled: false } },
          ownerAuth,
        );
        expect(disableModule.status).toBe(200);
        expect((await disableModule.json()).ok).toBe(true);

        const g1BookWhileOff = await dispatchAction(
          "ptm.booking.create",
          { institution: inst.slug, input: { slotId: slots[2].slotId, studentId: base.studentId } },
          g1Auth,
        );
        expect(g1BookWhileOff.status).toBe(403);
        const g1BookWhileOffBody = await g1BookWhileOff.json();
        expect(g1BookWhileOffBody.ok).toBe(false);
        expect(g1BookWhileOffBody.error.code).toBe("forbidden");

        const g1SurveyMineWhileOff = await dispatchQuery("survey.mine", inst.slug, {}, g1Auth);
        expect(g1SurveyMineWhileOff.status).toBe(403);
        const g1SurveyMineWhileOffBody = await g1SurveyMineWhileOff.json();
        expect(g1SurveyMineWhileOffBody.ok).toBe(false);
        expect(g1SurveyMineWhileOffBody.error.code).toBe("forbidden");

        // --- re-enable -----------------------------------------------------------
        const reenableModule = await dispatchAction(
          "core.module.set",
          { institution: inst.slug, input: { key: "ptm", enabled: true } },
          ownerAuth,
        );
        expect(reenableModule.status).toBe(200);
        expect((await reenableModule.json()).ok).toBe(true);
      } finally {
        await inst.cleanup();
      }
    },
    60_000,
  );
});
