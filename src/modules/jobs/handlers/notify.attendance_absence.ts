// T-038 — 06 §W5: notify the primary guardian of a student marked absent.
// Payload: `{ record_id: uuid }` (T-015's `app.submit_attendance` enqueues
// one of these per absent record with `idempotency_key = absence:<record_id>`,
// 20261028000014). Every value in the rendered message is re-read from the
// current DB rows below — never the payload.
import { createNotification } from "../../notifications/service.ts";
import { emitWorkflowEvent } from "../../workflows/events.ts";
import type { JobHandler } from "../types.ts";

interface AttendanceStatusConfig {
  code?: unknown;
  notify_guardian?: unknown;
}

export const notifyAttendanceAbsence: JobHandler = async (job, { admin }) => {
  const recordId = job.payload.record_id;
  if (typeof recordId !== "string" || recordId.length === 0) {
    throw new Error("notify.attendance_absence: missing record_id");
  }

  const { data: record, error: recordError } = await admin
    .from("attendance_records")
    .select("id, institution_id, status, session_id, student_id")
    .eq("id", recordId)
    .maybeSingle();
  if (recordError) throw recordError;
  // Record deleted, or the job is stale — nothing to notify about.
  if (!record) return;

  const { data: institution, error: institutionError } = await admin
    .from("institutions")
    .select("name, settings")
    .eq("id", record.institution_id)
    .single();
  if (institutionError) throw institutionError;

  // Re-check state at send time (lead ruling): if the status no longer
  // requires a guardian notification (settings changed, or the status is
  // no longer configured), skip rather than send a stale message.
  const statuses = ((institution.settings as { attendance?: { statuses?: unknown } } | null)?.attendance
    ?.statuses ?? []) as AttendanceStatusConfig[];
  const statusConfig = statuses.find((s) => s.code === record.status);
  if (!statusConfig?.notify_guardian) return;

  // M23-T14: one workflow event per session, before recipient lookups
  // (rulings §Events). Many absence jobs of one session dedupe into one run.
  await emitWorkflowEvent(admin, record.institution_id, "attendance.absences_submitted", record.session_id);

  const { data: session, error: sessionError } = await admin
    .from("attendance_sessions")
    .select("date, class_section_id")
    .eq("id", record.session_id)
    .single();
  if (sessionError) throw sessionError;

  const { data: section, error: sectionError } = await admin
    .from("class_sections")
    .select("name, grade_id")
    .eq("id", session.class_section_id)
    .single();
  if (sectionError) throw sectionError;

  const { data: grade, error: gradeError } = await admin
    .from("grades")
    .select("code")
    .eq("id", section.grade_id)
    .single();
  if (gradeError) throw gradeError;

  const { data: student, error: studentError } = await admin
    .from("students")
    .select("first_name, last_name")
    .eq("id", record.student_id)
    .single();
  if (studentError) throw studentError;

  const { data: primary, error: primaryError } = await admin
    .from("guardian_students")
    .select("guardian_id")
    .eq("student_id", record.student_id)
    .eq("is_primary", true)
    .maybeSingle();
  if (primaryError) throw primaryError;
  // No primary guardian configured — nothing to notify.
  if (!primary) return;

  const { data: guardian, error: guardianError } = await admin
    .from("guardians")
    .select("phone")
    .eq("id", primary.guardian_id)
    .single();
  if (guardianError) throw guardianError;

  // `guardians.user_id` is never populated by the seed (it links guardian
  // self-registration, unused here) — the guardian's portal account is the
  // `memberships` row for this guardian (05 §2.2 people), same as
  // `app.teacher_sees_guardian` resolves it.
  const { data: membership, error: membershipError } = await admin
    .from("memberships")
    .select("user_id")
    .eq("institution_id", record.institution_id)
    .eq("guardian_id", primary.guardian_id)
    .eq("role", "guardian")
    .eq("status", "active")
    .maybeSingle();
  if (membershipError) throw membershipError;
  // Guardian has no portal account — in-app notification has no recipient.
  if (!membership) return;

  const languages = (institution.settings as { communication?: { languages?: unknown } } | null)?.communication
    ?.languages;
  const lang = Array.isArray(languages) && languages[0] === "hi" ? "hi" : "en";

  await createNotification(admin, {
    institutionId: record.institution_id,
    recipientUserId: membership.user_id,
    type: "attendance_absence",
    entityId: record.id,
    lang,
    vars: {
      student: [student.first_name, student.last_name].filter(Boolean).join(" "),
      class: `${grade.code}-${section.name}`,
      date: session.date,
      school: institution.name,
    },
    contacts: { sms: guardian.phone },
  });
};
