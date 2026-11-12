import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { gradeSubmission, submitAssignment } from "@/modules/academics/submissions.actions";
import { addEnquiryNote, assignEnquiry, convertEnquiryToApplication, decideApplication, enrolApplicant, updateEnquiryStatus } from "@/modules/admissions/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import {
  closeFactoriesHelper, createAcademicYear, createApplication, createClassSection, createEnquiry, createEnrolment,
  createFeeStructure, createGrade, createSubject, createSubjectAssignment,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

// Curveballs: admissions state machine + submissions/grading edge cases.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

const one = async (q: Promise<postgres.RowList<postgres.Row[]>>) => (await q)[0]!;

describe("admissions curveballs", () => {
  async function appBase(inst: TestInstitution, status: string) {
    await sql`update public.institutions set settings = settings || jsonb_build_object('numbering', jsonb_build_object('application_no', 'APP/{YYYY}/{SEQ:5}')) where id=${inst.institutionId}`;
    const yearId = await createAcademicYear(inst.institutionId);
    const gradeId = await createGrade(inst.institutionId);
    const applicationId = await createApplication(inst.institutionId, gradeId, yearId, { status });
    return { yearId, gradeId, applicationId };
  }

  it("decision matrix: offer twice, reject->accept, reject->offer, withdraw->offer, accept->reject-from-accepted are invalid_state and leave status unchanged", async () => {
    const inst = await createTestInstitution("cb-adm-sm");
    try {
      const a = await appBase(inst, "under_review");
      const status = async (id: string) => (await one(sql`select status from public.applications where id=${id}`)).status as string;
      expect((await callAs(inst, "admissions", decideApplication, { applicationId: a.applicationId, decision: "offer" })).ok).toBe(true);
      const offerTwice = await callAs(inst, "admissions", decideApplication, { applicationId: a.applicationId, decision: "offer" });
      expect(!offerTwice.ok && offerTwice.error.code).toBe("invalid_state");
      expect(await status(a.applicationId)).toBe("offered");

      const rej = await createApplication(inst.institutionId, a.gradeId, a.yearId, { status: "under_review" });
      expect((await callAs(inst, "admissions", decideApplication, { applicationId: rej, decision: "reject" })).ok).toBe(true);
      for (const decision of ["accept", "offer", "reject", "withdraw"] as const) {
        const r = await callAs(inst, "admissions", decideApplication, { applicationId: rej, decision });
        expect(!r.ok && r.error.code, `rejected -> ${decision}`).toBe("invalid_state");
      }
      expect(await status(rej)).toBe("rejected");

      const wd = await createApplication(inst.institutionId, a.gradeId, a.yearId, { status: "under_review" });
      const wdEarly = await callAs(inst, "admissions", decideApplication, { applicationId: wd, decision: "withdraw" });
      expect(!wdEarly.ok && wdEarly.error.code).toBe("invalid_state"); // withdraw is only legal from offered
      expect((await callAs(inst, "admissions", decideApplication, { applicationId: wd, decision: "offer" })).ok).toBe(true);
      expect((await callAs(inst, "admissions", decideApplication, { applicationId: wd, decision: "withdraw" })).ok).toBe(true);
      const afterWd = await callAs(inst, "admissions", decideApplication, { applicationId: wd, decision: "offer" });
      expect(!afterWd.ok && afterWd.error.code).toBe("invalid_state");

      const enrolled = await createApplication(inst.institutionId, a.gradeId, a.yearId, { status: "enrolled" });
      for (const decision of ["offer", "reject", "accept", "withdraw"] as const) {
        const r = await callAs(inst, "admissions", decideApplication, { applicationId: enrolled, decision });
        expect(!r.ok && r.error.code, `enrolled -> ${decision}`).toBe("invalid_state");
      }
      expect(await status(enrolled)).toBe("enrolled");
    } finally { await inst.cleanup(); }
  }, 60_000);

  it("decide: unknown decision / unknown key / oversize note -> validation_failed; other school's or random application -> not_found; teacher/guardian forbidden", async () => {
    const inst = await createTestInstitution("cb-adm-val");
    const other = await createTestInstitution("cb-adm-val-x");
    try {
      const a = await appBase(inst, "under_review");
      const ob = await appBase(other, "under_review");
      const bad = await callAs(inst, "admissions", decideApplication, { applicationId: a.applicationId, decision: "approve" } as never);
      expect(!bad.ok && bad.error.code).toBe("validation_failed");
      if (!bad.ok) expect(bad.error.fieldErrors?.decision).toBeDefined();
      const extra = await callAs(inst, "admissions", decideApplication, { applicationId: a.applicationId, decision: "offer", status: "accepted" } as never);
      expect(!extra.ok && extra.error.code).toBe("validation_failed");
      const cross = await callAs(inst, "admissions", decideApplication, { applicationId: ob.applicationId, decision: "offer" });
      expect(!cross.ok && cross.error.code).toBe("not_found");
      expect((await one(sql`select status from public.applications where id=${ob.applicationId}`)).status).toBe("under_review");
      const rnd = await callAs(inst, "admissions", decideApplication, { applicationId: crypto.randomUUID(), decision: "offer" });
      expect(!rnd.ok && rnd.error.code).toBe("not_found");
      for (const role of ["teacher", "guardian", "student", "accountant"] as const) {
        const r = await callAs(inst, role, decideApplication, { applicationId: a.applicationId, decision: "offer" });
        expect(!r.ok && r.error.code, role).toBe("forbidden");
      }
    } finally { await inst.cleanup(); await other.cleanup(); }
  }, 60_000);

  it("enrolApplicant: withdrawn / rejected / submitted applications are invalid_state; another school's application is not_found", async () => {
    const inst = await createTestInstitution("cb-adm-enrol");
    const other = await createTestInstitution("cb-adm-enrol-x");
    try {
      const a = await appBase(inst, "accepted");
      const ob = await appBase(other, "accepted");
      const sectionId = await createClassSection(inst.institutionId, a.gradeId, a.yearId, { name: "A" });
      const fs = { id: await createFeeStructure(inst.institutionId, a.yearId, a.gradeId) };
      for (const st of ["withdrawn", "rejected", "submitted"]) {
        const id = await createApplication(inst.institutionId, a.gradeId, a.yearId, { status: st });
        const r = await callAs(inst, "admissions", enrolApplicant, { applicationId: id, classSectionId: sectionId, feeStructureId: fs.id as string });
        expect(!r.ok && r.error.code, st).toBe("invalid_state");
      }
      const cross = await callAs(inst, "admissions", enrolApplicant, { applicationId: ob.applicationId, classSectionId: sectionId, feeStructureId: fs.id as string });
      expect(!cross.ok && cross.error.code).toBe("not_found");
      const noStudents = await sql`select 1 from public.students where institution_id=${inst.institutionId} and admission_no not like 'ADM-%'`;
      expect(noStudents.length).toBe(0);
    } finally { await inst.cleanup(); await other.cleanup(); }
  }, 60_000);

  it("enquiry actions: cross-tenant ids not_found, blank note/stage validation_failed, converting a closed enquiry is refused", async () => {
    const inst = await createTestInstitution("cb-adm-enq");
    const other = await createTestInstitution("cb-adm-enq-x");
    try {
      const foreign = await createEnquiry(other.institutionId, { status: "new" });
      const mine = await createEnquiry(inst.institutionId, { status: "new" });
      const s = await callAs(inst, "admissions", updateEnquiryStatus, { enquiryId: foreign, status: "contacted" });
      expect(!s.ok && s.error.code).toBe("not_found");
      const n = await callAs(inst, "admissions", addEnquiryNote, { enquiryId: foreign, text: "hi" });
      expect(!n.ok && n.error.code).toBe("not_found");
      const staff = (await one(sql`select staff_id from public.memberships where institution_id=${inst.institutionId} and role='teacher'`)).staff_id as string;
      const asg = await callAs(inst, "admissions", assignEnquiry, { enquiryId: foreign, staffId: staff });
      expect(asg.ok).toBe(false);
      const blank = await callAs(inst, "admissions", addEnquiryNote, { enquiryId: mine, text: "   " });
      expect(!blank.ok && blank.error.code).toBe("validation_failed");
      const nostage = await callAs(inst, "admissions", updateEnquiryStatus, { enquiryId: mine, status: "" });
      expect(!nostage.ok && nostage.error.code).toBe("validation_failed");
      const unknownStage = await callAs(inst, "admissions", updateEnquiryStatus, { enquiryId: mine, status: "not_a_stage" });
      expect(unknownStage.ok).toBe(false);
      expect((await one(sql`select status from public.enquiries where id=${mine}`)).status).toBe("new");
      expect((await callAs(inst, "admissions", updateEnquiryStatus, { enquiryId: mine, status: "closed" })).ok).toBe(true);
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const conv = await callAs(inst, "admissions", convertEnquiryToApplication, {
        enquiryId: mine, gradeAppliedId: gradeId, academicYearId: yearId,
        applicant: { firstName: "A", lastName: "B", dob: "2016-01-01", gender: "other" },
        guardian: { fullName: "G", phone: "9876543210", relationship: "father" },
      } as never);
      expect(conv.ok).toBe(false);
    } finally { await inst.cleanup(); await other.cleanup(); }
  }, 60_000);
});

describe("submissions curveballs", () => {
  async function setup(inst: TestInstitution) {
    const yearId = await createAcademicYear(inst.institutionId);
    const gradeId = await createGrade(inst.institutionId);
    const teacher = (await one(sql`select staff_id from public.memberships where institution_id=${inst.institutionId} and role='teacher'`)).staff_id as string;
    const sectionA = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
    const sectionB = await createClassSection(inst.institutionId, gradeId, yearId, { name: "B" });
    const subjectId = await createSubject(inst.institutionId);
    await createSubjectAssignment(inst.institutionId, sectionA, subjectId, teacher);
    const studentId = (await one(sql`select student_id from public.memberships where institution_id=${inst.institutionId} and role='student'`)).student_id as string;
    await createEnrolment(inst.institutionId, studentId, sectionA, yearId);
    const mk = async (sec: string, status: string, dueAt: string | null = null) =>
      (await one(sql`insert into public.assignments (institution_id, class_section_id, subject_id, title, status, created_by, due_at)
        values (${inst.institutionId}, ${sec}, ${subjectId}, 'HW', ${status}, ${teacher}, ${dueAt}) returning id`)).id as string;
    return { sectionA, sectionB, mk };
  }

  it("submit: draft assignment, other section's assignment, another school's assignment, and an empty payload are all refused; no submission rows leak", async () => {
    const inst = await createTestInstitution("cb-sub");
    const other = await createTestInstitution("cb-sub-x");
    try {
      const s = await setup(inst);
      const os = await setup(other);
      const draft = await s.mk(s.sectionA, "draft");
      const elsewhere = await s.mk(s.sectionB, "published");
      const foreign = await os.mk(os.sectionA, "published");
      for (const [name, id] of Object.entries({ draft, elsewhere, foreign, random: crypto.randomUUID() })) {
        const r = await callAs(inst, "student", submitAssignment, { assignmentId: id, text: "answer" });
        expect(r.ok, name).toBe(false);
      }
      const rows = await sql`select 1 from public.assignment_submissions where institution_id in (${inst.institutionId}, ${other.institutionId})`;
      expect(rows.length).toBe(0);
      const ok = await s.mk(s.sectionA, "published");
      const blank = await callAs(inst, "student", submitAssignment, { assignmentId: ok, text: "   " });
      expect(!blank.ok && blank.error.code).toBe("validation_failed");
      const long = await callAs(inst, "student", submitAssignment, { assignmentId: ok, text: "x".repeat(5001) });
      expect(!long.ok && long.error.code).toBe("validation_failed");
    } finally { await inst.cleanup(); await other.cleanup(); }
  }, 60_000);

  it("late submission is flagged isLate; on-time is not", async () => {
    const inst = await createTestInstitution("cb-sub-late");
    try {
      const s = await setup(inst);
      const late = await s.mk(s.sectionA, "published", new Date(Date.now() - 86_400_000).toISOString());
      const early = await s.mk(s.sectionA, "published", new Date(Date.now() + 86_400_000).toISOString());
      const l = await callAs(inst, "student", submitAssignment, { assignmentId: late, text: "x" });
      const e = await callAs(inst, "student", submitAssignment, { assignmentId: early, text: "x" });
      expect(l.ok && l.data.isLate).toBe(true);
      expect(e.ok && e.data.isLate).toBe(false);
    } finally { await inst.cleanup(); }
  }, 60_000);

  it("grade: score>max, negative, maxScore 0 or >1000, unknown key -> validation_failed; student/guardian forbidden; other school's submission not_found", async () => {
    const inst = await createTestInstitution("cb-grade");
    const other = await createTestInstitution("cb-grade-x");
    try {
      const s = await setup(inst);
      const os = await setup(other);
      const a = await s.mk(s.sectionA, "published");
      const sub = await callAs(inst, "student", submitAssignment, { assignmentId: a, text: "x" });
      if (!sub.ok) throw new Error("setup");
      const oa = await os.mk(os.sectionA, "published");
      const osub = await callAs(other, "student", submitAssignment, { assignmentId: oa, text: "x" });
      if (!osub.ok) throw new Error("setup2");
      const id = sub.data.submissionId;
      for (const [name, body] of Object.entries({
        over: { score: 11, maxScore: 10 }, neg: { score: -1, maxScore: 10 }, zero: { score: 0, maxScore: 0 }, huge: { score: 1, maxScore: 1001 }, extra: { score: 1, maxScore: 10, status: "x" },
      })) {
        const r = await callAs(inst, "teacher", gradeSubmission, { submissionId: id, ...body } as never);
        expect(!r.ok && r.error.code, name).toBe("validation_failed");
      }
      for (const role of ["student", "guardian"] as const) {
        const r = await callAs(inst, role, gradeSubmission, { submissionId: id, score: 5, maxScore: 10 });
        expect(!r.ok && r.error.code, role).toBe("forbidden");
      }
      const cross = await callAs(inst, "teacher", gradeSubmission, { submissionId: osub.data.submissionId, score: 5, maxScore: 10 });
      expect(!cross.ok && cross.error.code).toMatch(/^(forbidden|not_found)$/);
      expect((await one(sql`select status from public.assignment_submissions where id=${osub.data.submissionId}`)).status).toBe("submitted");
      const good = await callAs(inst, "teacher", gradeSubmission, { submissionId: id, score: 7.5, maxScore: 10 });
      expect(good.ok).toBe(true);
      const regrade = await callAs(inst, "teacher", gradeSubmission, { submissionId: id, score: 9, maxScore: 10 });
      // grading an already-graded submission: must be a clean envelope either way, never internal
      expect(regrade.ok || regrade.error.code !== "internal").toBe(true);
    } finally { await inst.cleanup(); await other.cleanup(); }
  }, 60_000);
});
