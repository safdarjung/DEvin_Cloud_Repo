import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { saveOwnTeacherProfile, saveQualificationRules } from "@/modules/people/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createGrade, createSubject } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

// 0155 — teaching profiles: a staff member writes only their own row; ids must be the school's;
// the qualification rule lives in settings.staff and only settings managers write it.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});
const created: TestInstitution[] = [];
afterEach(async () => {
  await Promise.all(created.splice(0).map((inst) => inst.cleanup()));
});

async function teacherStaffId(institutionId: string): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${institutionId} and role = 'teacher'`;
  return row.staff_id as string;
}

describe("teaching profiles (0155)", () => {
  it("a teacher saves their own profile: highest level derived, onboarded once, readable through my_teacher_profile", async () => {
    const inst = await createTestInstitution("tprof-own");
    created.push(inst);
    const gradeId = await createGrade(inst.institutionId);
    const subjectId = await createSubject(inst.institutionId, { code: "PHY", name: "Physics" });
    const result = await callAs(inst, "teacher", saveOwnTeacherProfile, {
      qualifications: [
        { level: "bachelors", degree: "B.Ed." },
        { level: "masters", degree: "M.Sc.", subject: "Physics", year: 2015 },
      ],
      subjectIds: [subjectId],
      gradeIds: [gradeId],
      experienceYears: 7,
    });
    expect(result).toMatchObject({ ok: true, data: { highest_qualification: "masters" } });
    const [row] = await sql`select highest_qualification, can_teach_subject_ids, can_teach_grade_ids, experience_years, onboarded_at from public.staff where id = ${await teacherStaffId(inst.institutionId)}`;
    expect(row).toMatchObject({ highest_qualification: "masters", can_teach_subject_ids: [subjectId], can_teach_grade_ids: [gradeId], experience_years: 7 });
    expect(row.onboarded_at).not.toBeNull();

    const { data } = await inst.clientAs("teacher").rpc("my_teacher_profile", { p_institution_id: inst.institutionId });
    expect(data?.[0]).toMatchObject({ highest_qualification: "masters", experience_years: 7 });
  });

  it("a student or guardian has no staff row to write, and a subject from another school is refused", async () => {
    const inst = await createTestInstitution("tprof-guard");
    const other = await createTestInstitution("tprof-other");
    created.push(inst, other);
    const foreignSubject = await createSubject(other.institutionId, { code: "BIO", name: "Biology" });
    const asGuardian = await inst.clientAs("guardian").rpc("save_own_teacher_profile", {
      p_institution_id: inst.institutionId, p_qualifications: [{ level: "bachelors", degree: "B.A." }], p_subject_ids: [], p_grade_ids: [], p_experience_years: 1,
    });
    expect(asGuardian.error?.message).toContain("code:forbidden");
    const foreign = await callAs(inst, "teacher", saveOwnTeacherProfile, {
      qualifications: [{ level: "bachelors", degree: "B.A." }], subjectIds: [foreignSubject], gradeIds: [], experienceYears: null,
    });
    expect(foreign).toMatchObject({ ok: false, error: { code: "validation_failed" } });
  });

  it("a level the school does not know is refused by the database even if the action schema is bypassed", async () => {
    const inst = await createTestInstitution("tprof-level");
    created.push(inst);
    const { error } = await inst.clientAs("teacher").rpc("save_own_teacher_profile", {
      p_institution_id: inst.institutionId, p_qualifications: [{ level: "honorary", degree: "X" }], p_subject_ids: [], p_grade_ids: [], p_experience_years: 1,
    });
    expect(error?.message).toContain("code:validation_failed");
  });

  it("the qualification rule: a principal saves it to settings.staff, a teacher cannot, an unknown class is refused", async () => {
    const inst = await createTestInstitution("tprof-rules");
    created.push(inst);
    await createGrade(inst.institutionId, { code: "III", displayName: "Class III", sortKey: 3 });
    const ok = await callAs(inst, "principal", saveQualificationRules, { maxGradeByLevel: { bachelors: "III" } });
    expect(ok.ok).toBe(true);
    const [row] = await sql`select settings -> 'staff' -> 'max_grade_by_level' ->> 'bachelors' as b from public.institutions where id = ${inst.institutionId}`;
    expect(row.b).toBe("III");
    expect(await callAs(inst, "teacher", saveQualificationRules, { maxGradeByLevel: { bachelors: "III" } })).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await callAs(inst, "principal", saveQualificationRules, { maxGradeByLevel: { masters: "XIII" } })).toMatchObject({ ok: false, error: { code: "validation_failed" } });
  });
});
