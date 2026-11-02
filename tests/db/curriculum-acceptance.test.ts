// M10-T6 — curriculum acceptance over HTTP: admin creates 4 units for one
// grade/subject, subject teacher logs a lesson plan and marks coverage,
// principal reads coverageBySection pacing, scope/permission denials are
// 403, guardian reads sectionUnits for the linked child's section only.
// Mirrors tests/db/timetable-acceptance.test.ts (fixture institution + HTTP
// dispatch helpers).
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
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createGrade,
  createSubject,
  createSubjectAssignment,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

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

async function tokenFor(
  inst: TestInstitution,
  role: "admin" | "principal" | "teacher" | "guardian",
): Promise<string> {
  const { data, error } = await inst.clientAs(role).auth.getSession();
  if (error || !data.session) throw error ?? new Error(`no session for ${role}`);
  return data.session.access_token;
}

async function teacherStaffId(institutionId: string): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${institutionId} and role = 'teacher'`;
  return row.staff_id as string;
}

/** Links the fixture guardian to the fixture student, enrolled in `sectionId`. */
async function linkGuardianChild(inst: TestInstitution, sectionId: string, yearId: string): Promise<void> {
  const [studentMembership] = await sql`
    select student_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.student.id}
  `;
  const studentId = studentMembership.student_id as string;
  await sql`
    insert into public.enrolments (institution_id, student_id, class_section_id, academic_year_id, started_on, status)
    values (${inst.institutionId}, ${studentId}, ${sectionId}, ${yearId}, '2026-04-01', 'active')
  `;
  const [guardianMembership] = await sql`
    select guardian_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.guardian.id}
  `;
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${inst.institutionId}, ${guardianMembership.guardian_id}, ${studentId}, 'father', true, true)
  `;
}

async function createUnit(institutionId: string, subjectId: string, gradeId: string, sequence: number): Promise<string> {
  const [row] = await sql`
    insert into public.curriculum_units (institution_id, subject_id, grade_id, title, sequence)
    values (${institutionId}, ${subjectId}, ${gradeId}, ${`Science unit ${sequence}`}, ${sequence})
    returning id
  `;
  return row.id as string;
}

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

describe("M10 curriculum acceptance: coverage over HTTP", () => {
  it(
    "admin creates 4 units, subject teacher logs a plan and marks 2 covered (2/4), unmarks one (1/4); " +
      "teacher of another subject and guardian are forbidden to mark; guardian reads own child's section units only",
    async () => {
      const inst = await createTestInstitution("curriculum-acceptance");
      try {
        const yearId = await createAcademicYear(inst.institutionId);
        const gradeId = await createGrade(inst.institutionId);
        const sectionA = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
        const sectionB = await createClassSection(inst.institutionId, gradeId, yearId, { name: "B" });
        const subjectX = await createSubject(inst.institutionId, { code: "SUB-X", name: "Mathematics" });
        const subjectY = await createSubject(inst.institutionId, { code: "SUB-Y", name: "Science" });
        const teacherId = await teacherStaffId(inst.institutionId);
        await createSubjectAssignment(inst.institutionId, sectionA, subjectX, teacherId);
        await linkGuardianChild(inst, sectionA, yearId);
        const unitY = await createUnit(inst.institutionId, subjectY, gradeId, 1);

        const adminAuth = { authorization: `Bearer ${await tokenFor(inst, "admin")}` };
        const principalAuth = { authorization: `Bearer ${await tokenFor(inst, "principal")}` };
        const teacherAuth = { authorization: `Bearer ${await tokenFor(inst, "teacher")}` };
        const guardianAuth = { authorization: `Bearer ${await tokenFor(inst, "guardian")}` };

        // --- Admin creates 4 units for grade/subjectX ---------------------
        const unitIds: string[] = [];
        for (let sequence = 1; sequence <= 4; sequence += 1) {
          const res = await dispatchAction(
            "curriculum.unit.upsert",
            { institution: inst.slug, input: { gradeId, subjectId: subjectX, title: `Unit ${sequence}`, sequence } },
            adminAuth,
          );
          expect(res.status).toBe(200);
          const body = await res.json();
          expect(body.ok).toBe(true);
          unitIds.push(body.data.id as string);
        }

        // --- Subject teacher logs a lesson plan for unit 1 ----------------
        const planRes = await dispatchAction(
          "curriculum.lessonPlan.upsert",
          {
            institution: inst.slug,
            input: {
              classSectionId: sectionA,
              subjectId: subjectX,
              curriculumUnitId: unitIds[0],
              plannedOn: "2026-07-01",
              title: "Intro to algebra",
              objectives: "Cover unit 1",
            },
          },
          teacherAuth,
        );
        expect(planRes.status).toBe(200);
        const planBody = await planRes.json();
        expect(planBody.ok).toBe(true);
        const planId = planBody.data.id as string;

        // --- Mark units 1 and 2 covered ------------------------------------
        const cover1Res = await dispatchAction(
          "curriculum.markCovered",
          {
            institution: inst.slug,
            input: { classSectionId: sectionA, curriculumUnitId: unitIds[0], covered: true, coveredOn: "2026-07-05", lessonPlanId: planId },
          },
          teacherAuth,
        );
        expect(cover1Res.status).toBe(200);
        expect((await cover1Res.json()).ok).toBe(true);

        const cover2Res = await dispatchAction(
          "curriculum.markCovered",
          {
            institution: inst.slug,
            input: { classSectionId: sectionA, curriculumUnitId: unitIds[1], covered: true, coveredOn: "2026-07-06" },
          },
          teacherAuth,
        );
        expect(cover2Res.status).toBe(200);
        expect((await cover2Res.json()).ok).toBe(true);

        // --- Principal reads coverageBySection: 2/4 ------------------------
        const coverageRes1 = await dispatchQuery(
          "curriculum.coverageBySection",
          inst.slug,
          { classSectionId: sectionA },
          principalAuth,
        );
        expect(coverageRes1.status).toBe(200);
        const coverageBody1 = await coverageRes1.json();
        expect(coverageBody1.ok).toBe(true);
        const mathRow1 = coverageBody1.data.find((row: { subject: string }) => row.subject === "Mathematics");
        expect(mathRow1).toBeDefined();
        expect(mathRow1.planned_units).toBe(4);
        expect(mathRow1.completed_units).toBe(2);

        // --- Unmark unit 2: 1/4 ---------------------------------------------
        const uncoverRes = await dispatchAction(
          "curriculum.markCovered",
          { institution: inst.slug, input: { classSectionId: sectionA, curriculumUnitId: unitIds[1], covered: false } },
          teacherAuth,
        );
        expect(uncoverRes.status).toBe(200);
        const uncoverBody = await uncoverRes.json();
        expect(uncoverBody.ok).toBe(true);
        expect(uncoverBody.data).toEqual({ id: null, covered: false });

        const coverageRes2 = await dispatchQuery(
          "curriculum.coverageBySection",
          inst.slug,
          { classSectionId: sectionA },
          principalAuth,
        );
        const coverageBody2 = await coverageRes2.json();
        const mathRow2 = coverageBody2.data.find((row: { subject: string }) => row.subject === "Mathematics");
        expect(mathRow2.completed_units).toBe(1);

        // --- Teacher of another subject (subjectY) -> 403 forbidden -------
        const wrongSubjectRes = await dispatchAction(
          "curriculum.markCovered",
          { institution: inst.slug, input: { classSectionId: sectionA, curriculumUnitId: unitY, covered: true, coveredOn: "2026-07-05" } },
          teacherAuth,
        );
        expect(wrongSubjectRes.status).toBe(403);
        const wrongSubjectBody = await wrongSubjectRes.json();
        expect(wrongSubjectBody.ok).toBe(false);
        expect(wrongSubjectBody.error.code).toBe("forbidden");

        // --- Guardian -> 403 forbidden on markCovered (permission gate) ---
        const guardianMarkRes = await dispatchAction(
          "curriculum.markCovered",
          { institution: inst.slug, input: { classSectionId: sectionA, curriculumUnitId: unitIds[0], covered: true, coveredOn: "2026-07-05" } },
          guardianAuth,
        );
        expect(guardianMarkRes.status).toBe(403);
        const guardianMarkBody = await guardianMarkRes.json();
        expect(guardianMarkBody.ok).toBe(false);
        expect(guardianMarkBody.error.code).toBe("forbidden");

        // --- Guardian reads sectionUnits for own child's section: coveredOn set ---
        const ownUnitsRes = await dispatchQuery(
          "curriculum.sectionUnits",
          inst.slug,
          { classSectionId: sectionA, subjectId: subjectX },
          guardianAuth,
        );
        expect(ownUnitsRes.status).toBe(200);
        const ownUnitsBody = await ownUnitsRes.json();
        expect(ownUnitsBody.ok).toBe(true);
        const unit1Row = ownUnitsBody.data.find((row: { id: string }) => row.id === unitIds[0]);
        const unit2Row = ownUnitsBody.data.find((row: { id: string }) => row.id === unitIds[1]);
        expect(unit1Row.coveredOn).toBe("2026-07-05");
        expect(unit2Row.coveredOn).toBeNull();

        // --- Guardian reads sectionUnits for another section -> [] --------
        const otherUnitsRes = await dispatchQuery(
          "curriculum.sectionUnits",
          inst.slug,
          { classSectionId: sectionB, subjectId: subjectX },
          guardianAuth,
        );
        expect(otherUnitsRes.status).toBe(200);
        const otherUnitsBody = await otherUnitsRes.json();
        expect(otherUnitsBody.ok).toBe(true);
        expect(otherUnitsBody.data).toEqual([]);

        // --- Guardian reads coverageBySection -> 403 forbidden -------------
        const guardianCoverageRes = await dispatchQuery(
          "curriculum.coverageBySection",
          inst.slug,
          {},
          guardianAuth,
        );
        expect(guardianCoverageRes.status).toBe(403);
        const guardianCoverageBody = await guardianCoverageRes.json();
        expect(guardianCoverageBody.ok).toBe(false);
        expect(guardianCoverageBody.error.code).toBe("forbidden");
      } finally {
        await inst.cleanup();
      }
    },
  );
});
