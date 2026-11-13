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
  | "finance.plan.manage"
  | "finance.read"
  | "exam.manage"
  | "exam.marks.enter"
  | "exam.result.publish"
  | "exam.result.read"
  | "mastery.read"
  | "mastery.review"
  | "exam.recheck.request"
  | "exam.recheck.review"
  | "exam.recheck.decide"
  | "exam.seating.read"
  | "assignment.manage"
  | "assignment.read"
  | "assignment.submit"
  | "ai.chat"
  | "ai.generate"
  | "ai.usage.read"
  | "ai.study"
  | "website.edit"
  | "website.publish"
  | "notification.read"
  | "notification.log.read"
  | "question.manage"
  | "question.approve"
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
  | "report.schedule"
  | "workflow.read"
  | "workflow.manage"
  | "agent.run"
  | "agent.approve"
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
  | "survey.respond"
  | "message.read"
  | "message.send"
  | "practice.attempt"
  | "scenario.manage"
  | "studio.request"
  | "studio.approve"
  // features-18 (0113–0124); matrix in .superpowers/sdd/features-18/ROLES.md.
  | "behaviour.read"
  | "behaviour.write"
  | "health.read"
  | "health.write"
  | "club.read"
  | "club.manage"
  | "club.join"
  | "hostel.read"
  | "hostel.manage"
  | "expense.read"
  | "expense.manage"
  | "concession.read"
  | "concession.manage"
  | "concession.approve"
  | "canteen.read"
  | "canteen.manage"
  | "inventory.read"
  | "inventory.manage"
  | "helpdesk.raise"
  | "helpdesk.manage"
  | "form.manage"
  | "form.respond"
  | "alumni.read"
  | "alumni.manage"
  | "payroll.manage"
  | "payslip.read"
  | "lab.read"
  | "lab.book"
  | "lab.manage"
  // features-18 §A3 (0128–0132).
  | "achievement.read"
  | "achievement.write"
  | "achievement.verify"
  | "safety.alert.send"
  | "safety.alert.read"
  | "safety.headcount.mark"
  | "compliance.read"
  | "compliance.manage"
  | "resource.read"
  | "resource.manage"
  | "duty.read"
  | "duty.manage"
  | "duty.swap";

// Shared by owner/principal/admin (features-18 *.read / *.manage rows).
const LEADERSHIP_F18 = [
  "behaviour.read",
  "behaviour.write",
  "health.read",
  "health.write",
  "club.read",
  "club.manage",
  "hostel.read",
  "hostel.manage",
  "expense.read",
  "expense.manage",
  "concession.read",
  "concession.manage",
  "canteen.read",
  "canteen.manage",
  "inventory.read",
  "inventory.manage",
  "helpdesk.manage",
  "form.manage",
  "alumni.read",
  "alumni.manage",
  "payslip.read",
  "lab.read",
  "lab.book",
  "lab.manage",
  "achievement.read",
  "achievement.write",
  "achievement.verify",
  "safety.alert.send",
  "safety.alert.read",
  "safety.headcount.mark",
  "compliance.read",
  "compliance.manage",
  "resource.read",
  "resource.manage",
  "duty.read",
  "duty.manage",
] as const satisfies readonly Permission[];

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
    "finance.plan.manage",
    "finance.read",
    "exam.manage",
    "exam.marks.enter",
    "exam.result.publish",
    "exam.result.read",
    "mastery.read",
    "mastery.review",
    "exam.recheck.review",
    "exam.recheck.decide",
    "exam.seating.read",
    "assignment.manage",
    "assignment.read",
    "ai.chat",
    "ai.generate",
    "ai.usage.read",
    "website.edit",
    "website.publish",
    "notification.read",
    "notification.log.read",
    "question.manage",
    "question.approve",
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
    "workflow.read",
    "workflow.manage",
    "library.manage",
    "library.read",
    "student_leave.approve",
    "diary.write",
    "ptm.manage",
    "ptm.slot.manage",
    "ptm.book",
    "survey.manage",
    "survey.respond",
    "message.read",
    "message.send",
    "scenario.manage",
    "studio.request",
    "studio.approve",
    ...LEADERSHIP_F18,
    "concession.approve",
    "payroll.manage",
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
    "finance.plan.manage",
    "finance.read",
    "exam.manage",
    "exam.marks.enter",
    "exam.result.publish",
    "exam.result.read",
    "mastery.read",
    "mastery.review",
    "exam.recheck.review",
    "exam.recheck.decide",
    "exam.seating.read",
    "assignment.manage",
    "assignment.read",
    "ai.chat",
    "ai.generate",
    "ai.usage.read",
    "website.edit",
    "website.publish",
    "notification.read",
    "notification.log.read",
    "question.manage",
    "question.approve",
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
    "workflow.read",
    "workflow.manage",
    "library.manage",
    "library.read",
    "student_leave.approve",
    "diary.write",
    "ptm.manage",
    "ptm.slot.manage",
    "ptm.book",
    "survey.manage",
    "survey.respond",
    "message.read",
    "message.send",
    "scenario.manage",
    "studio.request",
    "studio.approve",
    ...LEADERSHIP_F18,
    "concession.approve",
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
    "mastery.read",
    "mastery.review",
    "exam.seating.read",
    "assignment.read",
    "ai.chat",
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
    "workflow.read",
    "library.manage",
    "library.read",
    "student_leave.approve",
    "diary.write",
    "ptm.manage",
    "ptm.slot.manage",
    "ptm.book",
    "survey.manage",
    "survey.respond",
    "message.read",
    "message.send",
    "scenario.manage",
    "studio.request",
    ...LEADERSHIP_F18,
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
    "ai.chat",
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
    "club.read",
    "alumni.read",
    "payslip.read",
    "safety.alert.read",
    "resource.read",
    "duty.read",
  ],
  accountant: [
    "dashboard.view",
    "student.read",
    "guardian.read",
    "staff.read",
    "academics.read",
    "ai.chat",
    "finance.structure.manage",
    "finance.invoice.generate",
    "finance.payment.record",
    "finance.payment.online",
    "finance.reminder.send",
    "finance.plan.manage",
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
    "club.read",
    "expense.read",
    "expense.manage",
    "concession.read",
    "concession.manage",
    "canteen.read",
    "canteen.manage",
    "inventory.read",
    "inventory.manage",
    "payroll.manage",
    "payslip.read",
    "safety.alert.read",
    "compliance.read",
    "resource.read",
    "duty.read",
  ],
  exam_controller: [
    "dashboard.view",
    "student.read",
    "staff.read",
    "academics.read",
    "ai.chat",
    "attendance.read",
    "exam.manage",
    "exam.marks.enter",
    "exam.result.publish",
    "exam.result.read",
    "mastery.read",
    "mastery.review",
    "exam.recheck.review",
    "exam.recheck.decide",
    "exam.seating.read",
    "notification.read",
    "question.manage",
    "question.approve",
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
    "club.read",
    "payslip.read",
    "safety.alert.read",
    "resource.read",
    "duty.read",
  ],
  teacher: [
    "student.read",
    "guardian.read",
    "academics.read",
    "ai.chat",
    "ai.generate",
    "attendance.mark",
    "attendance.correct",
    "attendance.read",
    "exam.marks.enter",
    "exam.result.read",
    "mastery.read",
    "mastery.review",
    "assignment.manage",
    "assignment.read",
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
    "message.read",
    "message.send",
    "behaviour.read",
    "behaviour.write",
    "club.read",
    "club.join",
    "helpdesk.raise",
    "form.respond",
    "payslip.read",
    "lab.read",
    "lab.book",
    "achievement.read",
    "achievement.write",
    "safety.alert.read",
    "safety.headcount.mark",
    "resource.read",
    "resource.manage",
    "duty.read",
    "duty.swap",
  ],
  student: [
    "student.read",
    "academics.read",
    "ai.chat",
    "ai.study",
    "attendance.read",
    "finance.read",
    "exam.result.read",
    "mastery.read",
    "exam.recheck.request",
    "exam.seating.read",
    "assignment.read",
    "assignment.submit",
    "notification.read",
    // D32/GU-08 — student-only (07 §2.2 column: stu). No other role holds this.
    "document.read",
    "document.write",
    "timetable.read",
    "library.read",
    "practice.attempt",
    "behaviour.read",
    "club.read",
    "club.join",
    "canteen.read",
    "helpdesk.raise",
    "form.respond",
    "achievement.read",
    "safety.alert.read",
    "resource.read",
  ],
  guardian: [
    "student.read",
    "guardian.read",
    "academics.read",
    "ai.chat",
    "attendance.read",
    "finance.read",
    "finance.payment.online",
    "exam.result.read",
    "mastery.read",
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
    "message.read",
    "message.send",
    "behaviour.read",
    "health.read",
    "club.read",
    "club.join",
    "canteen.read",
    "helpdesk.raise",
    "form.respond",
    "achievement.read",
    "safety.alert.read",
    "resource.read",
  ],
};

export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
