import type { JobHandler } from "../types.ts";
import { generateTermInvoices } from "./finance.generate_term_invoices.ts";
import { notifyAttendanceAbsence } from "./notify.attendance_absence.ts";
import { notifyEnquiryReceived } from "./notify.enquiry_received.ts";
import { notifyEnrolmentWelcome } from "./notify.enrolment_welcome.ts";

export { generateTermInvoices, notifyAttendanceAbsence, notifyEnquiryReceived, notifyEnrolmentWelcome };

// T-038 could not implement these two: 06 §W7/§W8 publish results and
// recheck decisions into `results`/`recheck_decisions` tables that no
// migration has created yet (grepped all of supabase/migrations/*.sql —
// neither table exists on this branch). Re-checking state at send time
// (lead ruling) is impossible without the row to re-check, and nothing
// enqueues either job type yet either. Left as placeholders, same as
// T-037 left all five; replace when the exams module's migration lands.
function notImplemented(type: string): JobHandler {
  return async () => {
    throw new Error(`not_implemented:${type}`);
  };
}

export const notifyResultsPublished: JobHandler = notImplemented("notify.results_published");
export const notifyRecheckDecided: JobHandler = notImplemented("notify.recheck_decided");
