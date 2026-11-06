// M02-T8 — exercises the real exported GET/POST of
// src/app/api/v1/query/[name]/route.ts against the live Supabase instance
// and the real query registry (every defineQuery()-built query, same
// manifest the dispatcher imports). Real bearer tokens via
// clientAs(role).auth.getSession(), mirroring api-actions-route.test.ts —
// @/lib/supabase/server is NOT mocked, so withBearerToken's real scoping
// (and RLS underneath it) is what's under test.
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { GET, POST } from "@/app/api/v1/query/[name]/route";
import { getRegisteredQueries } from "@/lib/actions/define-query";
import { closeRolesHelper, createTestInstitution, type FixtureRole, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

function postRequest(name: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request(`http://localhost/api/v1/query/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ name }) },
  );
}

function getRequest(
  name: string,
  institution: string,
  input: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  const url = new URL(`http://localhost/api/v1/query/${name}`);
  url.searchParams.set("institution", institution);
  if (input !== undefined) url.searchParams.set("input", JSON.stringify(input));
  return GET(new Request(url, { headers }), { params: Promise.resolve({ name }) });
}

async function tokenFor(inst: TestInstitution, role: FixtureRole): Promise<string> {
  const { data, error } = await inst.clientAs(role).auth.getSession();
  if (error || !data.session) throw error ?? new Error(`no session for ${role}`);
  return data.session.access_token;
}

async function createStudent(institutionId: string, admissionNo: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Test', '2015-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

async function linkGuardian(
  institutionId: string,
  guardianId: string,
  studentId: string,
  portalAccess: boolean,
): Promise<void> {
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, portal_access)
    values (${institutionId}, ${guardianId}, ${studentId}, 'mother', ${portalAccess})
  `;
}

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

describe("GET+POST /api/v1/query/[name] (M02-T8, RLS still the filter)", () => {
  it("guardian: people.listMyChildren -> 200, only own (portal_access) child", async () => {
    const inst = await createTestInstitution("api-query-children");
    try {
      const [guardianRow] = await sql`select guardian_id from public.memberships where institution_id = ${inst.institutionId} and role = 'guardian'`;
      const visible = await createStudent(inst.institutionId, "ADM-VIS-001");
      const hidden = await createStudent(inst.institutionId, "ADM-HID-001");
      await linkGuardian(inst.institutionId, guardianRow.guardian_id, visible, true);
      await linkGuardian(inst.institutionId, guardianRow.guardian_id, hidden, false);
      const token = await tokenFor(inst, "guardian");

      const res = await postRequest(
        "people.listMyChildren",
        { institution: inst.slug, input: {} },
        { authorization: `Bearer ${token}` },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.data.map((c: { id: string }) => c.id)).toEqual([visible]);
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian: people.getStudentProfile for another (unlinked) student -> 200, data: null (RLS hides, no leak)", async () => {
    const inst = await createTestInstitution("api-query-profile");
    try {
      const [guardianRow] = await sql`select guardian_id from public.memberships where institution_id = ${inst.institutionId} and role = 'guardian'`;
      const own = await createStudent(inst.institutionId, "ADM-OWN-001");
      const other = await createStudent(inst.institutionId, "ADM-OTHER-001");
      await linkGuardian(inst.institutionId, guardianRow.guardian_id, own, true);
      const token = await tokenFor(inst, "guardian");

      const res = await postRequest(
        "people.getStudentProfile",
        { institution: inst.slug, input: { studentId: other } },
        { authorization: `Bearer ${token}` },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, data: null });
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian: jobs.listAttentionJobs -> 403 forbidden (lacks job.manage)", async () => {
    const inst = await createTestInstitution("api-query-jobs");
    try {
      const token = await tokenFor(inst, "guardian");
      const res = await postRequest(
        "jobs.listAttentionJobs",
        { institution: inst.slug, input: {} },
        { authorization: `Bearer ${token}` },
      );

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher: people.listStudents via GET with url-encoded input -> 200", async () => {
    const inst = await createTestInstitution("api-query-list-students");
    try {
      const token = await tokenFor(inst, "teacher");
      const res = await getRequest(
        "people.listStudents",
        inst.slug,
        { page: 1 },
        { authorization: `Bearer ${token}` },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    } finally {
      await inst.cleanup();
    }
  });

  it("no token -> 401 unauthenticated", async () => {
    const inst = await createTestInstitution("api-query-notoken");
    try {
      const res = await postRequest("people.listMyChildren", { institution: inst.slug, input: {} });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("unauthenticated");
    } finally {
      await inst.cleanup();
    }
  });

  it("unknown query -> 404 not_found", async () => {
    const inst = await createTestInstitution("api-query-unknown");
    try {
      const token = await tokenFor(inst, "owner");
      const res = await postRequest(
        "no.such.query",
        { institution: inst.slug, input: {} },
        { authorization: `Bearer ${token}` },
      );
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("not_found");
    } finally {
      await inst.cleanup();
    }
  });

  // Owner smoke: every registered query (M2 — 68 at authoring time) runs
  // with a sample input built from its own schema shape (uuid placeholders
  // for ids that won't resolve to a row, so most handlers see an RLS-empty
  // read). not_found/validation_failed/forbidden/ok all pass — only
  // `internal` (an unhandled exception reaching the envelope) fails.
  // One sequential HTTP round-trip per registered query; the registry has
  // grown past the 5s default as M19 adds queries (M19-T19), so this one
  // test gets a longer budget rather than a flaky timeout.
  it("owner smoke: every registered query runs, none returns internal", async () => {
    const inst = await createTestInstitution("api-query-smoke");
    try {
      const token = await tokenFor(inst, "owner");
      const UUID = "00000000-0000-4000-8000-000000000000";
      const DATE = "2026-10-01";
      const sampleInputs: Record<string, unknown> = {
        "people.listStudents": { page: 1 },
        "people.getStudentProfile": { studentId: UUID },
        "imports.getBatch": { batchId: UUID },
        "insights.list": {},
        "insights.actions": { insightId: UUID },
        "insights.priorityActions": {},
        "insights.riskIndicators": {},
        "insights.cards": {},
        "briefings.today": {},
        "people.getCurrentTermId": { academicYearId: UUID },
        "people.listMyChildren": {},
        "people.getMyStudent": {},
        "people.staffAvailabilityToday": {},
        "people.pendingLeaveApprovals": {},
        "people.leaveRequests": {},
        "people.staffAttendanceForDate": { date: DATE },
        "jobs.listAttentionJobs": {},
        "academics.listTeacherAssignments": {},
        "academics.getAssignment": { assignmentId: UUID },
        "academics.listStudentAssignments": { studentId: UUID },
        "academics.listCurriculumUnits": { gradeId: UUID, subjectId: UUID },
        "academics.listTeachableSections": {},
        "academics.listSectionSubjects": { classSectionId: UUID },
        "academics.submissionsForAssignment": { assignmentId: UUID },
        "academics.mySubmissions": {},
        "curriculum.coverageBySection": {},
        "curriculum.sectionUnits": { classSectionId: UUID, subjectId: UUID },
        "curriculum.lessonPlans": { classSectionId: UUID },
        "admissions.listEnquiriesByStage": {},
        "admissions.getEnquiry": { enquiryId: UUID },
        "admissions.listApplications": {},
        "admissions.getApplication": { applicationId: UUID },
        "admissions.listApplicationDecisions": { applicationId: UUID },
        "admissions.listSectionsForGrade": { gradeId: UUID, academicYearId: UUID },
        "admissions.getAdmissionsFunnelCounts": {},
        "agents.definitions": {},
        "agents.runs": {},
        "agents.runDetail": { runId: UUID },
        "ai.usageSummary": {},
        "ai.listStudyItems": {},
        "ai.listStudyFolders": {},
        "ai.getStudyItem": { itemId: UUID },
        "attendance.getTodaySectionsForTeacher": {},
        "attendance.getSession": { classSectionId: UUID, date: DATE },
        "attendance.getStudentAttendanceSummary": { studentId: UUID, termId: UUID },
        "attendance.periodSummary": { classSectionId: UUID, date: DATE },
        "attendance.attendanceTodaySummary": {},
        "attendance.sectionsBelowThreshold": {},
        "attendance.getSectionAttendancePatterns": { classSectionId: UUID, termId: UUID },
        "calendar.forRole": {},
        "certificates.list": { studentId: UUID },
        "certificates.printHtml": { certificateId: UUID },
        "certificates.idCardsHtml": { classSectionId: UUID },
        "core.getDashboardData": {},
        "core.audit.list": { page: 1 },
        "core.modules.list": {},
        "core.approvals.pending": {},
        "dashboard.finance": {},
        "dashboard.admissions": {},
        "dashboard.principal": {},
        "dashboard.operations": {},
        "dashboard.attendanceTrend": {},
        "dashboard.teacher": {},
        "dashboard.parent": { studentId: UUID },
        "dashboard.student": {},
        "diary.forSection": { classSectionId: UUID },
        "diary.forStudent": { studentId: UUID },
        "diary.ackStatus": { entryId: UUID },
        "documents.listForEntity": { entityType: "student", entityId: UUID },
        "examSeating.slots": { examId: UUID },
        "examSeating.chart": { planId: UUID },
        "examSeating.studentSeats": { studentId: UUID },
        "examSeating.chartHtml": { planId: UUID },
        "examSeating.admitCardsHtml": { examId: UUID, classSectionId: UUID },
        "exams.listTermOptions": {},
        "exams.listSectionOptions": {},
        "exams.listSubjectOptions": {},
        "exams.listExams": {},
        "exams.getExamWithPapers": { examId: UUID },
        "exams.getPaperMarks": { paperId: UUID },
        "exams.getMyPapers": {},
        "exams.getCurrentResult": { examId: UUID, studentId: UUID },
        "exams.listResultsForExam": { examId: UUID },
        "exams.listResultsForStudent": { studentId: UUID },
        "exams.getResultHistory": { examId: UUID, studentId: UUID },
        "exams.listRechecksForResult": { resultId: UUID },
        "exams.listRecheckQueue": {},
        "exams.getRecheck": { requestId: UUID },
        "exams.getResultRemark": { resultId: UUID },
        "exams.examGradeDistribution": {},
        "exams.schedule": {},
        "exams.scheduleConflicts": { examId: UUID },
        "exams.reportCardHtml": { examId: UUID, studentId: UUID },
        "facilities.assets": {},
        "facilities.maintenanceRequests": {},
        "feePlans.lateFeeRules": {},
        "feePlans.instalments": { invoiceId: UUID },
        "feePlans.ledgerExport": { from: DATE, to: DATE },
        "finance.listAcademicYears": {},
        "finance.listGradeOptions": {},
        "finance.listTermOptions": {},
        "finance.listFeeStructures": {},
        "finance.getFeeStructure": { id: UUID },
        "finance.listInvoices": {},
        "finance.listInvoicesForStudent": { studentId: UUID },
        "finance.getInvoice": { id: UUID },
        "finance.getReceipt": { id: UUID },
        "finance.listReceiptsForStudent": { studentId: UUID },
        "finance.listLedgerEntries": { from: DATE, to: DATE },
        "finance.listDefaulters": { termId: UUID },
        "finance.termCollectionSummary": { termId: UUID },
        "forecasts.cards": {},
        "forecasts.financeSeries": {},
        "forecasts.list": {},
        "finance.collectionReport": { groupBy: "mode" },
        "library.catalog": {},
        "library.overdue": {},
        "library.myLoans": {},
        "lifecycle.history": { studentId: UUID },
        "mastery.heatmapBySection": {},
        "mastery.gapsForStudent": { studentId: UUID },
        "mastery.studentSuccessRows": { classSectionId: UUID },
        "mastery.interventions": {},
        "notifications.listMyNotifications": {},
        "notifications.unreadCount": {},
        "ptm.events": {},
        "ptm.teacherSchedule": { eventId: UUID },
        "ptm.forStudent": { studentId: UUID },
        "survey.list": {},
        "survey.results": { surveyId: UUID },
        "survey.mine": {},
        "notifications.listDeliveryLog": {},
        "questionBank.list": { page: 1 },
        "report.list": {},
        "report.runs": { reportId: UUID },
        "report.export": { source: "attendance.daily", params: {} },
        "studentLeave.list": {},
        "timetable.forSection": { classSectionId: UUID },
        "timetable.forTeacher": {},
        "timetable.forStudent": { studentId: UUID },
        "timetable.todayFor": {},
        "timetable.conflicts": { versionId: UUID },
        "timetable.teacherWorkload": { versionId: UUID },
        "timetable.roomUtilisation": { versionId: UUID },
        "timetable.coverNeeded": {},
        "timetable.substitutionCandidates": { slotId: UUID, date: DATE },
        "timetable.substitutions": {},
        "timetable.suggest": { versionId: UUID },
        "transport.routes": {},
        "transport.forStudent": { studentId: UUID },
        "visitors.list": {},
        "visitors.gatePasses": {},
        "visitors.pickupList": { studentId: UUID },
        "website.listPages": {},
        "website.getPageWithVersions": { pageId: UUID },
        "website.getVersion": { pageId: UUID, versionId: UUID },
        "website.listNotices": {},
        "website.listEvents": {},
        "website.getWebsite": {},
        "workflows.list": {},
        "workflows.runs": {},
      };

      const names = [...getRegisteredQueries().keys()];
      const failing: string[] = [];

      for (const name of names) {
        if (!(name in sampleInputs)) {
          failing.push(`${name}: no sample input mapped in this test`);
          continue;
        }
        const res = await postRequest(
          name,
          { institution: inst.slug, input: sampleInputs[name] },
          { authorization: `Bearer ${token}` },
        );
        const body = await res.json();
        if (!body.ok && body.error.code === "internal") {
          failing.push(`${name}: ${body.error.message}`);
        }
      }

      expect(failing).toEqual([]);
    } finally {
      await inst.cleanup();
    }
  }, 30000);
});
