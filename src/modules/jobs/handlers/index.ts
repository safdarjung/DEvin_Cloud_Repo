import type { JobHandler } from "../types.ts";
import { generateTermInvoices } from "./finance.generate_term_invoices.ts";
import { notifyAttendanceAbsence } from "./notify.attendance_absence.ts";
import { notifyEnquiryReceived } from "./notify.enquiry_received.ts";
import { notifyEnrolmentWelcome } from "./notify.enrolment_welcome.ts";
import { notifyResultsPublished } from "./notify.results_published.ts";

export {
  generateTermInvoices,
  notifyAttendanceAbsence,
  notifyEnquiryReceived,
  notifyEnrolmentWelcome,
  notifyResultsPublished,
};

// T-019 (lead ruling) replaced notify.results_published's placeholder (the
// `results` table it depends on now exists, 0009/0018). notify.recheck_decided
// still can't be implemented: it needs `recheck_decisions` to carry real
// decision rows, which is T-020's packet, not this one.
function notImplemented(type: string): JobHandler {
  return async () => {
    throw new Error(`not_implemented:${type}`);
  };
}

export const notifyRecheckDecided: JobHandler = notImplemented("notify.recheck_decided");
