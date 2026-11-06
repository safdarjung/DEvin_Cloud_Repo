// 07 §2 — the permission matrix, copied exactly. This is the only place the
// matrix is implemented; `tests/unit/permissions.test.ts` snapshots it
// against the table. `s` (scoped) cells are granted here like `✓`; the scope
// itself (own sections/children/self) is enforced by RLS and handler logic,
// not by this permission check.

export type Role =
  | "owner"
  | "principal"
  | "admin"
  | "admissions"
  | "accountant"
  | "exam_controller"
  | "teacher"
  | "student"
  | "guardian";

export type Permission =
  | "institution.settings.manage"
  | "member.manage"
  | "audit.read"
  | "dashboard.view"
  | "student.read"
  | "student.write"
  | "guardian.read"
  | "staff.read"
  | "staff.write"
  | "academics.manage"
  | "academics.read"
  | "attendance.mark"
  | "attendance.correct"
  | "attendance.read"
  | "admissions.enquiry.read"
  | "admissions.enquiry.write"
  | "admissions.application.decide"
  | "admissions.enrol"
  | "finance.structure.manage"
  | "finance.invoice.generate"
  | "finance.payment.record"
  | "finance.payment.void"
  | "finance.payment.online"
  | "finance.reminder.send"
  | "finance.read"
  | "exam.manage"
  | "exam.marks.enter"
  | "exam.result.publish"
  | "exam.result.read"
  | "exam.recheck.request"
  | "exam.recheck.review"
  | "exam.recheck.decide"
  | "exam.seating.read"
  | "assignment.manage"
  | "assignment.read"
  | "assignment.submit"
  | "ai.generate"
  | "ai.usage.read"
  | "ai.study"
  | "website.edit"
  | "website.publish"
  | "notification.read"
  | "notification.log.read"
  | "question.manage"
  | "job.manage"
  | "data.import"
  | "data.export"
  | "document.read"
  | "document.write"
  | "announcement.manage"
  | "timetable.manage"
  | "timetable.read"
  | "staff.attendance.mark"
  | "leave.request"
  | "leave.approve"
  | "certificate.manage"
  | "facilities.manage"
  | "transport.manage"
  | "maintenance.request"
  | "agent.run"
  | "agent.approve"
  | "report.schedule"
  | "library.manage"
  | "library.read"
  | "insight.read"
  | "insight.review"
  | "visitor.manage"
  | "gatepass.manage"
  | "pickup.manage"
  | "forecast.read"
  | "student_leave.request"
  | "student_leave.approve"
  | "diary.write"
  | "ptm.manage"
  | "ptm.slot.manage"
  | "ptm.book"
  | "survey.manage"
  | "survey.respond";

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: [
    "institution.settings.manage",
    "member.manage",
    "audit.read",
    "dashboard.view",
    "student.read",
    "student.write",
    "guardian.read",
    "staff.read",
    "staff.write",
    "academics.manage",
    "academics.read",
    "attendance.mark",
    "attendance.correct",
    "attendance.read",
    "admissions.enquiry.read",
    "admissions.enquiry.write",
    "admissions.application.decide",
    "admissions.enrol",
    "finance.structure.manage",
    "finance.invoice.generate",
    "finance.payment.record",
    "finance.payment.void",
    "finance.payment.online",
    "finance.reminder.send",
    "finance.read",
    "exam.manage",
    "exam.marks.enter",
    "exam.result.publish",
    "exam.result.read",
    "exam.recheck.review",
    "exam.recheck.decide",
    "exam.seating.read",
    "assignment.manage",
    "assignment.read",
    "ai.generate",
    "ai.usage.read",
    "website.edit",
    "website.publish",
    "notification.read",
    "notification.log.read",
    "question.manage",
    "job.manage",
    "data.import",
    "document.read",
    "document.write",
    "announcement.manage",
    "timetable.read",
    "timetable.manage",
    "staff.attendance.mark",
    "leave.request",
    "leave.approve",
    "certificate.manage",
    "facilities.manage",
    "transport.manage",
    "maintenance.request",
    "agent.run",
    "agent.approve",
    "insight.read",
    "insight.review",
    "visitor.manage",
    "gatepass.manage",
    "pickup.manage",
    "forecast.read",
    "data.export",
    "report.schedule",
    "library.manage",
    "library.read",
    "student_leave.approve",
    "diary.write",
    "ptm.manage",
    "ptm.slot.manage",
    "ptm.book",
    "survey.manage",
    "survey.respond",
  ],
  principal: [
    "institution.settings.manage",
    "member.manage",
    "audit.read",
    "dashboard.view",
    "student.read",
    "student.write",
    "guardian.read",
    "staff.read",
    "staff.write",
    "academics.manage",
    "academics.read",
    "attendance.mark",
    "attendance.correct",
    "attendance.read",
    "admissions.enquiry.read",
    "admissions.enquiry.write",
    "admissions.application.decide",
    "admissions.enrol",
    "finance.structure.manage",
    "finance.invoice.generate",
    "finance.payment.record",
    "finance.payment.void",
    "finance.payment.online",
    "finance.reminder.send",
    "finance.read",
    "exam.manage",
    "exam.marks.enter",
    "exam.result.publish",
    "exam.result.read",
    "exam.recheck.review",
    "exam.recheck.decide",
    "exam.seating.read",
    "assignment.manage",
    "assignment.read",
    "ai.generate",
    "ai.usage.read",
    "website.edit",
    "website.publish",
    "notification.read",
    "notification.log.read",
    "question.manage",
    "job.manage",
    "data.import",
    "document.read",
    "document.write",
    "announcement.manage",
    "timetable.read",
    "timetable.manage",
    "staff.attendance.mark",
    "leave.request",
    "leave.approve",
    "certificate.manage",
    "facilities.manage",
    "transport.manage",
    "maintenance.request",
    "agent.run",
    "agent.approve",
    "insight.read",
    "insight.review",
    "visitor.manage",
    "gatepass.manage",
    "pickup.manage",
    "forecast.read",
    "data.export",
    "report.schedule",
    "library.manage",
    "library.read",
    "student_leave.approve",
    "diary.write",
    "ptm.manage",
    "ptm.slot.manage",
    "ptm.book",
    "survey.manage",
    "survey.respond",
  ],
  admin: [
    "institution.settings.manage",
    "member.manage",
    "audit.read",
    "dashboard.view",
    "student.read",
    "student.write",
    "guardian.read",
    "staff.read",
    "staff.write",
    "academics.manage",
    "academics.read",
    "attendance.mark",
    "attendance.correct",
    "attendance.read",
    "admissions.enquiry.read",
    "admissions.enquiry.write",
    "admissions.enrol",
    "finance.structure.manage",
    "finance.read",
    "exam.result.read",
    "exam.seating.read",
    "assignment.read",
    "ai.generate",
    "ai.usage.read",
    "website.edit",
    "website.publish",
    "notification.read",
    "notification.log.read",
    "job.manage",
    "data.import",
    "document.read",
    "document.write",
    "announcement.manage",
    "timetable.read",
    "timetable.manage",
    "staff.attendance.mark",
    "leave.request",
    "leave.approve",
    "certificate.manage",
    "facilities.manage",
    "transport.manage",
    "maintenance.request",
    "agent.run",
    "insight.read",
    "insight.review",
    "visitor.manage",
    "gatepass.manage",
    "pickup.manage",
    "forecast.read",
    "data.export",
    "report.schedule",
    "library.manage",
    "library.read",
    "student_leave.approve",
    "diary.write",
    "ptm.manage",
    "ptm.slot.manage",
    "ptm.book",
    "survey.manage",
    "survey.respond",
  ],
  admissions: [
    "dashboard.view",
    "student.read",
    "student.write",
    "guardian.read",
    "admissions.enquiry.read",
    "admissions.enquiry.write",
    "admissions.application.decide",
    "admissions.enrol",
    "academics.read",
    // Admissions staff draft routine enquiry-reply/call-notes via AI (this
    // packet) — the same "AI drafts, human saves" boundary as teacher quizzes.
    "ai.generate",
    "website.edit",
    "notification.read",
    "notification.log.read",
    "document.read",
    "document.write",
    "timetable.read",
    "staff.attendance.mark",
    "leave.request",
    "certificate.manage",
    "maintenance.request",
    "library.read",
    "insight.read",
    "insight.review",
    "survey.respond",
  ],
  accountant: [
    "dashboard.view",
    "student.read",
    "guardian.read",
    "staff.read",
    "academics.read",
    "finance.structure.manage",
    "finance.invoice.generate",
    "finance.payment.record",
    "finance.payment.online",
    "finance.reminder.send",
    "finance.read",
    "notification.read",
    "document.read",
    "timetable.read",
    "staff.attendance.mark",
    "leave.request",
    "maintenance.request",
    "insight.read",
    "insight.review",
    "forecast.read",
    "data.export",
    "library.read",
    "survey.respond",
  ],
  exam_controller: [
    "dashboard.view",
    "student.read",
    "staff.read",
    "academics.read",
    "attendance.read",
    "exam.manage",
    "exam.marks.enter",
    "exam.result.publish",
    "exam.result.read",
    "exam.recheck.review",
    "exam.recheck.decide",
    "exam.seating.read",
    "notification.read",
    "question.manage",
    "document.read",
    "timetable.read",
    "staff.attendance.mark",
    "leave.request",
    "maintenance.request",
    "library.read",
    "insight.read",
    "insight.review",
    "forecast.read",
    "survey.respond",
  ],
  teacher: [
    "student.read",
    "guardian.read",
    "academics.read",
    "attendance.mark",
    "attendance.correct",
    "attendance.read",
    "exam.marks.enter",
    "exam.result.read",
    "assignment.manage",
    "assignment.read",
    "ai.generate",
    "notification.read",
    "question.manage",
    "document.read",
    "timetable.read",
    "staff.attendance.mark",
    "leave.request",
    "student_leave.approve",
    "diary.write",
    "maintenance.request",
    "library.read",
    "insight.read",
    "gatepass.manage",
    "forecast.read",
    "ptm.slot.manage",
    "survey.respond",
  ],
  student: [
    "student.read",
    "academics.read",
    "attendance.read",
    "finance.read",
    "exam.result.read",
    "exam.recheck.request",
    "exam.seating.read",
    "assignment.read",
    "assignment.submit",
    "notification.read",
    // D32/GU-08 — student-only (07 §2.2 column: stu). No other role holds this.
    "ai.study",
    "document.read",
    "document.write",
    "timetable.read",
    "library.read",
  ],
  guardian: [
    "student.read",
    "guardian.read",
    "academics.read",
    "attendance.read",
    "finance.read",
    "finance.payment.online",
    "exam.result.read",
    "exam.recheck.request",
    "exam.seating.read",
    "assignment.read",
    "notification.read",
    "document.read",
    "timetable.read",
    "library.read",
    "pickup.manage",
    "ptm.book",
    "survey.respond",
    "student_leave.request",
  ],
};

export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
