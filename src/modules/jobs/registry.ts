import type { ModuleKey } from "@/lib/modules/catalog";
import type { JobHandler } from "./types.ts";
import {
  contentExtract,
  generateReport,
  lateFees,
  feeReminder,
  generateTermInvoices,
  insightsDetect,
  forecastRun,
  masteryCompute,
  notifyAnnouncement,
  notifyAttendanceAbsence,
  notifyDiaryEntry,
  notifyEnquiryReceived,
  notifyEnrolmentWelcome,
  notifyGatePass,
  notifyRecheckDecided,
  notifyResultsPublished,
  notifyStudentLeaveDecided,
  notifySafetyAlert,
  notifyStudyReminders,
  notifyMarksReminders,
  workflowRun,
} from "./handlers/index.ts";

// MOD-T11 — job type -> owning module (rulings "Jobs"). Core job types
// (notify.attendance_absence, finance.generate_term_invoices) have no row:
// the runner never gates them.
export const JOB_MODULES: Readonly<Partial<Record<string, ModuleKey>>> = {
  "notify.results_published": "exams",
  "notify.recheck_decided": "exams",
  "notify.enquiry_received": "admissions",
  "notify.enrolment_welcome": "admissions",
  "notify.announcement": "announcements",
  "notify.gate_pass": "visitors",
  "notify.student_leave_decided": "student_leave",
  "notify.diary_entry": "diary",
  "notify.safety_alert": "safety",
  "finance.fee_reminder": "finance_plus",
  "report.generate": "scheduled_reports",
  "fee_plans.late_fees": "fee_plans",
  "insights.detect": "insights",
  "forecast.run": "forecasts",
  "mastery.compute": "mastery",
  "workflow.run": "workflows",
  "notify.study_reminders": "ai_student",
  "notify.marks_reminders": "exams",
};

// Dispatch table for the runner (06 §7). A type not listed here is dead-
// lettered immediately by `runOnceCore` with `last_error = 'unknown_type'`
// and is never passed to a handler.
export const JOB_REGISTRY: Readonly<Record<string, JobHandler>> = {
  "notify.attendance_absence": notifyAttendanceAbsence,
  "notify.results_published": notifyResultsPublished,
  "notify.recheck_decided": notifyRecheckDecided,
  "notify.enquiry_received": notifyEnquiryReceived,
  "notify.enrolment_welcome": notifyEnrolmentWelcome,
  "notify.announcement": notifyAnnouncement,
  "notify.gate_pass": notifyGatePass,
  "notify.student_leave_decided": notifyStudentLeaveDecided,
  "notify.diary_entry": notifyDiaryEntry,
  "notify.safety_alert": notifySafetyAlert,
  "finance.generate_term_invoices": generateTermInvoices,
  "report.generate": generateReport,
  "finance.fee_reminder": feeReminder,
  "fee_plans.late_fees": lateFees,
  "insights.detect": insightsDetect,
  "forecast.run": forecastRun,
  "mastery.compute": masteryCompute,
  "workflow.run": workflowRun,
  "notify.study_reminders": notifyStudyReminders,
  "notify.marks_reminders": notifyMarksReminders,
  "content.extract": contentExtract,
};

export function resolveHandler(type: string): JobHandler | undefined {
  // Security review fix (T-037, MEDIUM): a plain `{}`-based lookup resolves
  // inherited `Object.prototype` members too, so `resolveHandler("constructor")`
  // would return `Object` and the job would be marked succeeded instead of
  // dead-lettered. `Object.hasOwn` restricts the lookup to real entries.
  return Object.hasOwn(JOB_REGISTRY, type) ? JOB_REGISTRY[type] : undefined;
}
