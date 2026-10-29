// T-038 — 06 §3: welcome the primary guardian when a student is enrolled.
// Payload: `{ enrolment_id: uuid }` — no enqueue call exists yet (the
// admissions "convert to enrolment" workflow lands in a later packet); this
// handler is ready for it, following the same `{ record_id }`-style shape
// as notify.attendance_absence.ts and re-reads everything from `enrolments`.
import { createNotification } from "../../notifications/service.ts";
import type { JobHandler } from "../types.ts";

export const notifyEnrolmentWelcome: JobHandler = async (job, { admin }) => {
  const enrolmentId = job.payload.enrolment_id;
  if (typeof enrolmentId !== "string" || enrolmentId.length === 0) {
    throw new Error("notify.enrolment_welcome: missing enrolment_id");
  }

  const { data: enrolment, error: enrolmentError } = await admin
    .from("enrolments")
    .select("id, institution_id, student_id, class_section_id")
    .eq("id", enrolmentId)
    .maybeSingle();
  if (enrolmentError) throw enrolmentError;
  if (!enrolment) return;

  const { data: student, error: studentError } = await admin
    .from("students")
    .select("first_name, last_name, admission_no")
    .eq("id", enrolment.student_id)
    .single();
  if (studentError) throw studentError;

  const { data: section, error: sectionError } = await admin
    .from("class_sections")
    .select("name, grade_id")
    .eq("id", enrolment.class_section_id)
    .single();
  if (sectionError) throw sectionError;

  const { data: grade, error: gradeError } = await admin
    .from("grades")
    .select("code")
    .eq("id", section.grade_id)
    .single();
  if (gradeError) throw gradeError;

  const { data: primary, error: primaryError } = await admin
    .from("guardian_students")
    .select("guardian_id")
    .eq("student_id", enrolment.student_id)
    .eq("is_primary", true)
    .maybeSingle();
  if (primaryError) throw primaryError;
  if (!primary) return;

  const { data: guardian, error: guardianError } = await admin
    .from("guardians")
    .select("email")
    .eq("id", primary.guardian_id)
    .single();
  if (guardianError) throw guardianError;

  // See notify.attendance_absence.ts: the guardian's portal account is the
  // `memberships` row, not `guardians.user_id` (never populated by the seed).
  const { data: membership, error: membershipError } = await admin
    .from("memberships")
    .select("user_id")
    .eq("institution_id", enrolment.institution_id)
    .eq("guardian_id", primary.guardian_id)
    .eq("role", "guardian")
    .eq("status", "active")
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership) return;

  await createNotification(admin, {
    institutionId: enrolment.institution_id,
    recipientUserId: membership.user_id,
    type: "enrolment_welcome",
    entityId: enrolment.id,
    vars: {
      student: [student.first_name, student.last_name].filter(Boolean).join(" "),
      class: `${grade.code}-${section.name}`,
      admission_no: student.admission_no,
    },
    contacts: { email: guardian.email },
  });
};
