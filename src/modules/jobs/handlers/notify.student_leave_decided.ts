// X01-T10 — 06 rulings "Notifications": notify the portal guardians and the
// student themselves once a student leave request is approved or rejected.
// Payload: `{ leave_id: uuid }` (`app.decide_student_leave`, 0085,
// `idempotency_key = student_leave:<leave_id>`). Never puts the leave's
// `reason` or `decision_note` into the rendered message (lesson 10: may
// hold health details) — those columns are never selected below.
import { createNotification } from "../../notifications/service.ts";
import { guardiansAndStudents } from "./notify.announcement.ts";
import type { JobHandler } from "../types.ts";

export const notifyStudentLeaveDecided: JobHandler = async (job, { admin }) => {
  const leaveId = job.payload.leave_id;
  if (typeof leaveId !== "string" || leaveId.length === 0) {
    throw new Error("notify.student_leave_decided: missing leave_id");
  }

  const { data: leave, error: leaveError } = await admin
    .from("student_leave_requests")
    .select("id, institution_id, student_id, start_date, end_date, status")
    .eq("id", leaveId)
    .maybeSingle();
  if (leaveError) throw leaveError;
  // Re-check state at send time: deleted, or no longer approved/rejected (a
  // cancel never enqueues this job, but a stale rerun should still skip).
  if (!leave || (leave.status !== "approved" && leave.status !== "rejected")) return;

  const { data: institution, error: institutionError } = await admin
    .from("institutions")
    .select("name, settings")
    .eq("id", leave.institution_id)
    .single();
  if (institutionError) throw institutionError;

  const { data: student, error: studentError } = await admin
    .from("students")
    .select("first_name, last_name")
    .eq("id", leave.student_id)
    .single();
  if (studentError) throw studentError;

  const languages = (institution.settings as { communication?: { languages?: unknown } } | null)?.communication
    ?.languages;
  const lang = Array.isArray(languages) && languages[0] === "hi" ? "hi" : "en";

  const recipients = await guardiansAndStudents(admin, leave.institution_id, [leave.student_id]);

  for (const recipient of recipients) {
    await createNotification(admin, {
      institutionId: leave.institution_id,
      recipientUserId: recipient.userId,
      type: "student_leave_decided",
      entityId: leave.id,
      lang,
      vars: {
        student: [student.first_name, student.last_name].filter(Boolean).join(" "),
        from: leave.start_date,
        to: leave.end_date,
        decision: leave.status,
        school: institution.name,
      },
      contacts: recipient.contacts,
    });
  }
};
