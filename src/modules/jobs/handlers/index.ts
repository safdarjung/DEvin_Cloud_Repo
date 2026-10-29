import type { JobHandler } from "../types.ts";

// Placeholders: T-038 replaces the `notify.*` handlers, T-031 replaces
// `finance.generate_term_invoices`. Each throws so the runner retries and
// eventually dead-letters the job (06 §W12) rather than silently succeeding.
function notImplemented(type: string): JobHandler {
  return async () => {
    throw new Error(`not_implemented:${type}`);
  };
}

export const notifyAttendanceAbsence: JobHandler = notImplemented("notify.attendance_absence");
export const notifyResultsPublished: JobHandler = notImplemented("notify.results_published");
export const notifyRecheckDecided: JobHandler = notImplemented("notify.recheck_decided");
export const notifyEnquiryReceived: JobHandler = notImplemented("notify.enquiry_received");
export const notifyEnrolmentWelcome: JobHandler = notImplemented("notify.enrolment_welcome");
export const generateTermInvoices: JobHandler = notImplemented("finance.generate_term_invoices");
