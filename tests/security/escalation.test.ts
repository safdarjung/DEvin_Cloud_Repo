import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Handlers that are reached call createClient() first; with no acting client
// set, this mock throws, so an authorized call ends as `internal` with no side
// effects — the walk never touches a database.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import "@/app/api/v1/actions/all-actions";
import { getRegisteredActions } from "@/lib/actions/registry";
import type { ActionResult } from "@/lib/actions/result";
import { permissionsFor, type Permission, type Role } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import { allModulesOn } from "@/lib/modules/catalog";

// 07 §6 C-03 (T-042): walk the action registry and call every action as
// every role. A role without the action's permission must get `forbidden`; a
// role with it must get past the gate; unknown keys must be `validation_failed`.
const ROLES: Role[] = ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"];
const U = () => crypto.randomUUID();
const at = "2026-10-01T09:00:00.000Z";

const FIXTURES: Record<string, { permission: Permission; input: () => Record<string, unknown> }> = {
  "core.feature.set": { permission: "institution.settings.manage", input: () => ({ key: "teacher_ai_agent", enabled: true }) },
  "core.module.set": { permission: "institution.settings.manage", input: () => ({ key: "timetable", enabled: true }) },
  "agent.run": { permission: "agent.run", input: () => ({ slug: "finance", task: "x" }) },
  "agent.definition.setEnabled": { permission: "agent.approve", input: () => ({ slug: "finance", enabled: true }) },
  "agent.approve": { permission: "agent.run", input: () => ({ runId: U() }) },
  "agent.reject": { permission: "agent.run", input: () => ({ runId: U() }) },
  "ai.study.chat.save": {
    permission: "ai.study",
    input: () => ({ title: "Probe", messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "Probe" }] }] }),
  },
  "ai.study.note.save": {
    permission: "ai.study",
    input: () => ({ title: "Probe", blocks: [{ kind: "callout", tone: "tip", text: "Probe" }] }),
  },
  "ai.study.item.update": { permission: "ai.study", input: () => ({ itemId: U(), pinned: true }) },
  "ai.study.item.delete": { permission: "ai.study", input: () => ({ itemId: U() }) },
  "job.requeue": { permission: "job.manage", input: () => ({ jobId: U() }) },
  "library.book.upsert": { permission: "library.manage", input: () => ({ title: "Probe", author: "Probe" }) },
  "library.copies.add": { permission: "library.manage", input: () => ({ bookId: U(), accessionNos: ["LIB-PROBE"] }) },
  "library.copy.setStatus": { permission: "library.manage", input: () => ({ copyId: U(), status: "withdrawn" }) },
  "library.loan.issue": { permission: "library.manage", input: () => ({ accessionNo: "LIB-0001", studentId: U() }) },
  "library.loan.renew": { permission: "library.manage", input: () => ({ accessionNo: "LIB-0001" }) },
  "library.loan.return": { permission: "library.manage", input: () => ({ accessionNo: "LIB-0001" }) },
  "lifecycle.promote": {
    permission: "academics.manage",
    input: () => ({ fromYearId: U(), toYearId: U(), mappings: [{ fromSectionId: U(), toSectionId: U() }] }),
  },
  "lifecycle.transfer": {
    permission: "student.write",
    input: () => ({ studentId: U(), reason: "Probe reason text.", destinationSchool: "Probe School" }),
  },
  "lifecycle.withdraw": {
    permission: "student.write",
    input: () => ({ studentId: U(), reason: "Probe reason text." }),
  },
  "exam.create": { permission: "exam.manage", input: () => ({ termId: U(), name: "Probe", type: "unit_test" }) },
  "exam.papers.create": {
    permission: "exam.manage",
    input: () => ({ examId: U(), papers: [{ classSectionId: U(), subjectId: U(), maxMarks: 100, passMarks: 33 }] }),
  },
  "exam.paper.schedule": {
    permission: "exam.manage",
    input: () => ({ examId: U(), papers: [{ paperId: U(), scheduledAt: null }] }),
  },
  "exam.marks_entry.open": { permission: "exam.manage", input: () => ({ examId: U() }) },
  "exam.marks_entry.close": { permission: "exam.manage", input: () => ({ examId: U() }) },
  "exam.marks_entry.reopen": { permission: "exam.manage", input: () => ({ examId: U() }) },
  "exam.verify": { permission: "exam.manage", input: () => ({ examId: U() }) },
  "exam.marks.enter": {
    permission: "exam.marks.enter",
    input: () => ({ examPaperId: U(), marks: [{ studentId: U(), marksObtained: 50, isAbsent: false }] }),
  },
  "exam.result.publish": { permission: "exam.result.publish", input: () => ({ examId: U() }) },
  "exam.recheck.request": {
    permission: "exam.recheck.request",
    input: () => ({ resultId: U(), examPaperId: U(), reason: "Please recheck this paper." }),
  },
  "exam.recheck.review": { permission: "exam.recheck.review", input: () => ({ requestId: U() }) },
  "exam.recheck.decide": { permission: "exam.recheck.decide", input: () => ({ requestId: U(), decision: "reject" }) },
  "exam.remark.save": { permission: "exam.marks.enter", input: () => ({ resultId: U(), remark: "Probe remark." }) },
  "examSeating.generate": {
    permission: "exam.manage",
    input: () => ({ examId: U(), slotStart: "2026-11-16T04:00:00.000Z", rooms: [{ roomId: U() }] }),
  },
  "finance.structure.upsert": {
    permission: "finance.structure.manage",
    input: () => ({
      academicYearId: U(),
      gradeId: U(),
      name: "Probe",
      components: [{ head: "tuition", amount: 100, frequency: "term" }],
    }),
  },
  "finance.structure.assign": {
    permission: "finance.structure.manage",
    input: () => ({ studentId: U(), feeStructureId: U(), academicYearId: U() }),
  },
  "finance.invoice.generateTerm": { permission: "finance.invoice.generate", input: () => ({ termId: U() }) },
  "finance.invoice.generateStudent": { permission: "finance.invoice.generate", input: () => ({ studentId: U(), termId: U() }) },
  "finance.payment.record": {
    permission: "finance.payment.record",
    input: () => ({ invoiceId: U(), amount: 100, mode: "cash", receivedAt: "2026-10-01", idempotencyKey: U() }),
  },
  "finance.payment.void": {
    permission: "finance.payment.void",
    input: () => ({ paymentId: U(), kind: "void", reason: "Probe reversal reason.", idempotencyKey: U() }),
  },
  "finance.payment.createIntent": {
    permission: "finance.payment.online",
    input: () => ({ invoiceId: U(), amount: 100, idempotencyKey: U() }),
  },
  "finance.reminders.send": { permission: "finance.reminder.send", input: () => ({ termId: U() }) },
  "notification.read": { permission: "notification.read", input: () => ({ notificationId: U() }) },
  "assignment.create": { permission: "assignment.manage", input: () => ({ classSectionId: U(), subjectId: U(), title: "Probe" }) },
  "assignment.update": { permission: "assignment.manage", input: () => ({ assignmentId: U(), title: "Probe" }) },
  "assignment.publish": { permission: "assignment.manage", input: () => ({ assignmentId: U() }) },
  "assignment.submit": { permission: "assignment.submit", input: () => ({ assignmentId: U() }) },
  "assignment.grade": { permission: "assignment.manage", input: () => ({ submissionId: U(), score: 1, maxScore: 10 }) },
  "attendance.mark": {
    permission: "attendance.mark",
    input: () => ({ classSectionId: U(), date: "2026-10-01", records: [{ studentId: U(), status: "P" }] }),
  },
  "attendance.submit": { permission: "attendance.mark", input: () => ({ sessionId: U() }) },
  "attendance.correct": { permission: "attendance.correct", input: () => ({ recordId: U(), newStatus: "P", reason: "Probe" }) },
  "attendance.markPeriod": {
    permission: "attendance.mark",
    input: () => ({ classSectionId: U(), periodId: U(), date: "2026-10-01", records: [{ studentId: U(), status: "P" }] }),
  },
  "website.page.create": { permission: "website.edit", input: () => ({ slug: "probe", title: "Probe" }) },
  "website.page.save_version": { permission: "website.edit", input: () => ({ pageId: U(), blocks: [] }) },
  "website.page.publish": { permission: "website.publish", input: () => ({ pageId: U(), versionId: U() }) },
  "website.live_set": { permission: "website.publish", input: () => ({ isLive: true }) },
  "website.notice.upsert": {
    permission: "website.edit",
    input: () => ({ title: "Probe", body: "Probe", publishAt: at, isPublic: true }),
  },
  "website.event.upsert": { permission: "website.edit", input: () => ({ title: "Probe", startsAt: at, isPublic: true }) },
  "admissions.enquiry.status": { permission: "admissions.enquiry.write", input: () => ({ enquiryId: U(), status: "contacted" }) },
  "admissions.enquiry.note": { permission: "admissions.enquiry.write", input: () => ({ enquiryId: U(), text: "Probe" }) },
  "admissions.enquiry.assign": { permission: "admissions.enquiry.write", input: () => ({ enquiryId: U(), staffId: U() }) },
  "admissions.enquiry.convert": {
    permission: "admissions.enquiry.write",
    input: () => ({
      enquiryId: U(),
      applicant: { firstName: "Probe", dob: "2015-01-01", gender: "other" },
      guardian: { fullName: "Probe", phone: "9876543210", relationship: "father" },
      gradeId: U(),
      academicYearId: U(),
    }),
  },
  "admissions.application.decide": {
    permission: "admissions.application.decide",
    input: () => ({ applicationId: U(), decision: "offer" }),
  },
  "admissions.enrol": {
    permission: "admissions.enrol",
    input: () => ({ applicationId: U(), classSectionId: U(), feeStructureId: U() }),
  },
  "core.member.invite": { permission: "member.manage", input: () => ({ email: "probe@example.com", role: "teacher" }) },
  "core.member.revokeInvite": { permission: "member.manage", input: () => ({ invitationId: U() }) },
  "core.member.setRole": { permission: "member.manage", input: () => ({ membershipId: U(), role: "teacher" }) },
  "core.member.setStatus": { permission: "member.manage", input: () => ({ membershipId: U(), status: "active" }) },
  "core.academicYear.upsert": {
    permission: "academics.manage",
    input: () => ({ name: "Probe", startsOn: "2026-04-01", endsOn: "2027-03-31" }),
  },
  "core.term.upsert": {
    permission: "academics.manage",
    input: () => ({ academicYearId: U(), name: "Probe", startsOn: "2026-04-01", endsOn: "2026-06-30" }),
  },
  "core.institution.updateSettings": { permission: "institution.settings.manage", input: () => ({ name: "Probe" }) },
  "academics.grade.upsert": {
    permission: "academics.manage",
    input: () => ({ code: "G1", displayName: "Grade 1", sortKey: 1, gradeGroup: "primary" }),
  },
  "academics.section.upsert": {
    permission: "academics.manage",
    input: () => ({ gradeId: U(), academicYearId: U(), name: "Probe" }),
  },
  "academics.subject.upsert": {
    permission: "academics.manage",
    input: () => ({ code: "SUB", name: "Probe", kind: "scholastic" }),
  },
  "academics.subjectAssignment.set": {
    permission: "academics.manage",
    input: () => ({ classSectionId: U(), subjectId: U(), teacherId: U() }),
  },
  "people.department.upsert": { permission: "staff.write", input: () => ({ name: "Probe" }) },
  "people.staff.upsert": {
    permission: "staff.write",
    input: () => ({ employeeNo: "E1", fullName: "Probe", designation: "Teacher" }),
  },
  "people.staffAttendance.mark": {
    permission: "staff.attendance.mark",
    input: () => ({ date: "2026-10-01", records: [{ staffId: U(), status: "present" }] }),
  },
  "people.staffAttendance.checkIn": { permission: "staff.attendance.mark", input: () => ({}) },
  "people.leave.request": {
    permission: "leave.request",
    input: () => ({ leaveType: "casual", startDate: "2026-11-09", endDate: "2026-11-10", reason: "Probe reason" }),
  },
  "people.leave.approve": { permission: "leave.approve", input: () => ({ leaveId: U() }) },
  "people.leave.reject": { permission: "leave.approve", input: () => ({ leaveId: U() }) },
  "people.leave.cancel": { permission: "leave.request", input: () => ({ leaveId: U() }) },
  "studentLeave.request": {
    permission: "student_leave.request",
    input: () => ({ studentId: U(), startDate: "2026-11-09", endDate: "2026-11-10", reason: "Probe reason" }),
  },
  "studentLeave.approve": { permission: "student_leave.approve", input: () => ({ leaveId: U() }) },
  "studentLeave.reject": { permission: "student_leave.approve", input: () => ({ leaveId: U() }) },
  "studentLeave.cancel": { permission: "student_leave.request", input: () => ({ leaveId: U() }) },
  "diary.entry.post": {
    permission: "diary.write",
    input: () => ({ classSectionId: U(), entryDate: "2026-11-09", body: "Probe entry" }),
  },
  "diary.entry.delete": { permission: "diary.write", input: () => ({ entryId: U() }) },
  "diary.acknowledge": { permission: "assignment.read", input: () => ({ entryId: U(), studentId: U() }) },
  "people.student.update": { permission: "student.write", input: () => ({ studentId: U(), firstName: "Probe" }) },
  "people.guardian.update": { permission: "student.write", input: () => ({ guardianId: U(), fullName: "Probe" }) },
  "people.guardian.link": {
    permission: "student.write",
    input: () => ({ studentId: U(), relationship: "father", guardianId: U() }),
  },
  "data.import.stage": {
    permission: "data.import",
    input: () => ({
      entityType: "students",
      fileName: "students.csv",
      csv: "admission_no,first_name,last_name,dob,gender,grade,section,roll_no,guardian_name,guardian_phone,guardian_email,guardian_relationship\n",
    }),
  },
  "data.import.commit": { permission: "data.import", input: () => ({ batchId: U() }) },
  "document.requestUpload": {
    permission: "document.write",
    input: () => ({ entityType: "student", entityId: U(), kind: "id_proof", fileName: "file.pdf", mime: "application/pdf", sizeBytes: 1000 }),
  },
  "document.confirmUpload": { permission: "document.write", input: () => ({ documentId: U() }) },
  "document.getReadUrl": { permission: "document.read", input: () => ({ documentId: U() }) },
  "document.delete": { permission: "document.write", input: () => ({ documentId: U() }) },
  "announcement.create": {
    permission: "announcement.manage",
    input: () => ({ title: "Probe", body: "Probe body", audiences: [{ type: "school" }] }),
  },
  "announcement.publish": { permission: "announcement.manage", input: () => ({ announcementId: U() }) },
  "notification.preferences.set": {
    permission: "notification.read",
    input: () => ({ category: "announcement", channel: "sms", enabled: false }),
  },
  "curriculum.unit.upsert": {
    permission: "academics.manage",
    input: () => ({ gradeId: U(), subjectId: U(), title: "Probe Unit", sequence: 1 }),
  },
  "curriculum.lessonPlan.upsert": {
    permission: "assignment.manage",
    input: () => ({ classSectionId: U(), subjectId: U(), plannedOn: "2026-07-01", title: "Probe", objectives: "Probe objectives" }),
  },
  "curriculum.lessonPlan.delete": { permission: "assignment.manage", input: () => ({ id: U() }) },
  "curriculum.markCovered": {
    permission: "assignment.manage",
    input: () => ({ classSectionId: U(), curriculumUnitId: U(), covered: true, coveredOn: "2026-07-01" }),
  },
  "timetable.room.upsert": { permission: "timetable.manage", input: () => ({ name: "Probe Room", capacity: 30 }) },
  "timetable.period.upsert": {
    permission: "timetable.manage",
    input: () => ({ seq: 1, name: "Period 1", startsAt: "08:00", endsAt: "08:40" }),
  },
  "timetable.version.create": { permission: "timetable.manage", input: () => ({ academicYearId: U(), name: "Probe" }) },
  "timetable.saveDraft": {
    permission: "timetable.manage",
    input: () => ({
      versionId: U(),
      slots: [{ classSectionId: U(), weekday: 1, periodId: U(), subjectId: U(), teacherId: U(), roomId: U() }],
    }),
  },
  "timetable.publish": { permission: "timetable.manage", input: () => ({ versionId: U() }) },
  "timetable.substitution.assign": {
    permission: "timetable.manage",
    input: () => ({ slotId: U(), date: "2026-11-09", substituteId: U() }),
  },
  "timetable.substitution.cancel": { permission: "timetable.manage", input: () => ({ substitutionId: U() }) },
  "calendar.event.upsert": {
    permission: "academics.manage",
    input: () => ({ academicYearId: U(), kind: "event", title: "Probe", startsOn: "2026-04-10", endsOn: "2026-04-10" }),
  },
  "calendar.event.delete": { permission: "academics.manage", input: () => ({ id: U() }) },
  "facilities.asset.upsert": { permission: "facilities.manage", input: () => ({ name: "Probe Asset", category: "other" }) },
  "maintenance.request": { permission: "maintenance.request", input: () => ({ location: "Probe Hall", issue: "Probe issue." }) },
  "maintenance.assign": { permission: "facilities.manage", input: () => ({ requestId: U(), assigneeStaffId: U() }) },
  "maintenance.close": { permission: "facilities.manage", input: () => ({ requestId: U() }) },
  "questionBank.create": {
    permission: "question.manage",
    input: () => ({ subjectId: U(), gradeId: U(), type: "short_answer", difficulty: "easy", body: "Probe?", answer: "Probe.", marks: 1 }),
  },
  "questionBank.update": {
    permission: "question.manage",
    input: () => ({ id: U(), subjectId: U(), gradeId: U(), type: "short_answer", difficulty: "easy", body: "Probe?", answer: "Probe.", marks: 1 }),
  },
  "questionBank.archive": { permission: "question.manage", input: () => ({ id: U(), isActive: false }) },
  "transport.vehicle.upsert": {
    permission: "transport.manage",
    input: () => ({ registrationNo: "MH12AB1234", capacity: 10, driverName: "Probe Driver" }),
  },
  "transport.route.upsert": { permission: "transport.manage", input: () => ({ name: "Probe Route" }) },
  "transport.stop.upsert": {
    permission: "transport.manage",
    input: () => ({ routeId: U(), seq: 1, name: "Probe Stop", eta: "07:00", mapX: 10, mapY: 10 }),
  },
  "transport.assign": { permission: "transport.manage", input: () => ({ studentId: U(), stopId: U() }) },
  "transport.unassign": { permission: "transport.manage", input: () => ({ studentId: U() }) },
  "insight.review": { permission: "insight.review", input: () => ({ insightId: U() }) },
  "insight.action": {
    permission: "insight.review",
    input: () => ({ insightId: U(), action: "Probe action", owner: "Probe owner", rationale: "Probe rationale.", expectedOutcome: "Probe outcome." }),
  },
  "insight.resolve": { permission: "insight.review", input: () => ({ insightId: U(), note: "Probe resolution note." }) },
  "insight.dismiss": { permission: "insight.review", input: () => ({ insightId: U(), note: "Probe dismissal note." }) },
  // Gate is `insight.read` (every role here passes it except student/guardian),
  // but the handler's own `ai.generate` check (07 §2 — accountant/exam_controller
  // lack it) is what actually decides forbidden vs. past-the-gate here.
  "insight.explain": { permission: "ai.generate", input: () => ({ insightId: U() }) },
  "visitors.checkIn": { permission: "visitor.manage", input: () => ({ fullName: "Probe Visitor", phone: "9876543210", purpose: "Probe", meetingWith: "Office" }) },
  "visitors.checkOut": { permission: "visitor.manage", input: () => ({ id: U() }) },
  "visitors.gatePass.create": { permission: "gatepass.manage", input: () => ({ studentId: U(), reason: "Probe reason.", guardianId: U() }) },
  "visitors.gatePass.setStatus": { permission: "gatepass.manage", input: () => ({ id: U(), status: "approved" }) },
  "visitors.pickup.add": {
    permission: "pickup.manage",
    input: () => ({ studentId: U(), fullName: "Probe Person", relation: "driver", phone: "9876543210" }),
  },
  "visitors.pickup.remove": { permission: "pickup.manage", input: () => ({ id: U() }) },
  "visitors.purge": { permission: "visitor.manage", input: () => ({}) },
  "report.schedule.save": {
    permission: "report.schedule",
    input: () => ({ name: "Probe Report", source: "attendance.daily", cron: "0 20 * * *", recipientRoles: ["principal"] }),
  },
  "report.schedule.setStatus": { permission: "report.schedule", input: () => ({ id: U(), status: "paused" }) },
  "certificate.issue": {
    permission: "certificate.manage",
    input: () => ({ studentId: U(), kind: "bonafide", purpose: "Passport application" }),
  },
  "ptm.event.create": {
    permission: "ptm.manage",
    input: () => ({
      title: "Probe",
      eventDate: "2026-11-21",
      dayStartsAt: "09:00",
      dayEndsAt: "13:00",
      slotMinutes: 10,
      bookingClosesAt: "2026-11-20T18:00:00+05:30",
      classSectionIds: [U()],
    }),
  },
  "ptm.event.publish": { permission: "ptm.manage", input: () => ({ eventId: U() }) },
  "ptm.slots.add": { permission: "ptm.slot.manage", input: () => ({ eventId: U(), from: "10:00", to: "10:30" }) },
  "ptm.slot.remove": { permission: "ptm.slot.manage", input: () => ({ slotId: U() }) },
  "ptm.booking.create": { permission: "ptm.book", input: () => ({ slotId: U(), studentId: U() }) },
  "ptm.booking.cancel": { permission: "ptm.book", input: () => ({ bookingId: U() }) },
  "survey.create": {
    permission: "survey.manage",
    input: () => ({
      title: "Probe",
      closesAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      questions: [{ type: "text", prompt: "Probe?" }],
      audiences: [{ type: "school" }],
    }),
  },
  "survey.close": { permission: "survey.manage", input: () => ({ surveyId: U() }) },
  "survey.respond": { permission: "survey.respond", input: () => ({ surveyId: U(), answers: ["Probe answer"] }) },
  "feePlans.lateFeeRule.upsert": {
    permission: "finance.plan.manage",
    input: () => ({ feeStructureId: U(), kind: "flat", amount: 100, cap: null }),
  },
  "feePlans.instalments.set": {
    permission: "finance.plan.manage",
    input: () => ({
      invoiceId: U(),
      parts: [
        { dueOn: "2026-11-10", amount: 100 },
        { dueOn: "2026-12-10", amount: 100 },
      ],
    }),
  },
};

type CallableAction = (slug: string, raw: unknown, overrideCtx: TenantContext) => Promise<ActionResult<unknown>>;

function ctxFor(role: Role): TenantContext {
  const isStaff = role !== "student" && role !== "guardian";
  return {
    institution: { id: U(), slug: "escalation", name: "Escalation", settings: { modules: allModulesOn() }, ai_policy: "local_only", is_demo: true },
    user: { id: U(), profile: { fullName: "Probe", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: {
      role,
      staffId: isStaff ? U() : null,
      guardianId: role === "guardian" ? U() : null,
      studentId: role === "student" ? U() : null,
    },
    permissions: new Set(permissionsFor(role)),
  };
}

function countDefineActionCalls(): number {
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return /\.tsx?$/.test(e.name) ? [full] : [];
    });
  return walk(path.join(process.cwd(), "src"))
    .filter((f) => !f.endsWith(path.join("lib", "actions", "define-action.ts")))
    .reduce((n, f) => n + [...fs.readFileSync(f, "utf8").matchAll(/defineAction\s*(?:<[^>]*>)?\s*\(\s*\{/g)].length, 0);
}

const registry = getRegisteredActions();

beforeAll(() => {
  // Authorized calls end in the handler's createClient() throw, logged as `internal`.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe("C-03: action registry walk", () => {
  it("the registry holds every defineAction call in src (missing registration fails)", () => {
    expect(registry.size).toBe(countDefineActionCalls());
  });

  it("every registered action has an escalation fixture, and no fixture is stale", () => {
    expect([...registry.keys()].sort()).toEqual(Object.keys(FIXTURES).sort());
  });

  describe.each([...registry.keys()].sort())("%s", (name) => {
    const action = registry.get(name) as unknown as CallableAction;
    const fixture = FIXTURES[name];

    it.each(ROLES)("as %s: forbidden exactly when the role lacks the permission", async (role) => {
      const result = await action("escalation", fixture.input(), ctxFor(role));
      const allowed = permissionsFor(role).includes(fixture.permission);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      if (allowed) {
        expect(["forbidden", "validation_failed"]).not.toContain(result.error.code);
      } else {
        expect(result.error.code).toBe("forbidden");
      }
    });

    it("unknown keys are rejected as validation_failed (strict schemas)", async () => {
      const result = await action("escalation", { ...fixture.input(), injected: true }, ctxFor("owner"));
      expect(result).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    });
  });
});
