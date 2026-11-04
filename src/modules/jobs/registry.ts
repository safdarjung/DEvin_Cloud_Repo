import type { ModuleKey } from "@/lib/modules/catalog";
import type { JobHandler } from "./types.ts";
import {
  generateReport,
  generateTermInvoices,
  notifyAnnouncement,
  notifyAttendanceAbsence,
  notifyEnquiryReceived,
  notifyEnrolmentWelcome,
  notifyRecheckDecided,
  notifyResultsPublished,
} from "./handlers/index.ts";

// MOD-T11 — job type -> owning module (rulings "Jobs"). Core job types
// (notify.attendance_absence, finance.generate_term_invoices) have no row:
// the runner never gates them. `finance.fee_reminder` has no handler yet
// (M12 key map; batch-2 job types only) but is listed now so the gate is
// correct the day that handler lands.
export const JOB_MODULES: Readonly<Partial<Record<string, ModuleKey>>> = {
  "notify.results_published": "exams",
  "notify.recheck_decided": "exams",
  "notify.enquiry_received": "admissions",
  "notify.enrolment_welcome": "admissions",
  "notify.announcement": "announcements",
  "finance.fee_reminder": "finance_plus",
  "report.generate": "scheduled_reports",
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
  "finance.generate_term_invoices": generateTermInvoices,
  "report.generate": generateReport,
};

export function resolveHandler(type: string): JobHandler | undefined {
  // Security review fix (T-037, MEDIUM): a plain `{}`-based lookup resolves
  // inherited `Object.prototype` members too, so `resolveHandler("constructor")`
  // would return `Object` and the job would be marked succeeded instead of
  // dead-lettered. `Object.hasOwn` restricts the lookup to real entries.
  return Object.hasOwn(JOB_REGISTRY, type) ? JOB_REGISTRY[type] : undefined;
}
