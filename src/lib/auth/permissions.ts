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
  | "finance.read"
  | "exam.manage"
  | "exam.marks.enter"
  | "exam.result.publish"
  | "exam.result.read"
  | "exam.recheck.request"
  | "exam.recheck.review"
  | "exam.recheck.decide"
  | "assignment.manage"
  | "assignment.read"
  | "ai.generate"
  | "ai.usage.read"
  | "website.edit"
  | "website.publish"
  | "notification.read"
  | "notification.log.read"
  | "job.manage";

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
    "finance.read",
    "exam.manage",
    "exam.marks.enter",
    "exam.result.publish",
    "exam.result.read",
    "exam.recheck.review",
    "exam.recheck.decide",
    "assignment.manage",
    "assignment.read",
    "ai.generate",
    "ai.usage.read",
    "website.edit",
    "website.publish",
    "notification.read",
    "notification.log.read",
    "job.manage",
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
    "finance.read",
    "exam.manage",
    "exam.marks.enter",
    "exam.result.publish",
    "exam.result.read",
    "exam.recheck.review",
    "exam.recheck.decide",
    "assignment.manage",
    "assignment.read",
    "ai.generate",
    "ai.usage.read",
    "website.edit",
    "website.publish",
    "notification.read",
    "notification.log.read",
    "job.manage",
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
    "assignment.read",
    "ai.generate",
    "ai.usage.read",
    "website.edit",
    "website.publish",
    "notification.read",
    "notification.log.read",
    "job.manage",
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
    "website.edit",
    "notification.read",
    "notification.log.read",
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
    "finance.read",
    "notification.read",
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
    "notification.read",
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
  ],
  student: [
    "student.read",
    "academics.read",
    "attendance.read",
    "finance.read",
    "exam.result.read",
    "exam.recheck.request",
    "assignment.read",
    "notification.read",
  ],
  guardian: [
    "student.read",
    "guardian.read",
    "academics.read",
    "attendance.read",
    "finance.read",
    "exam.result.read",
    "exam.recheck.request",
    "assignment.read",
    "notification.read",
  ],
};

export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
