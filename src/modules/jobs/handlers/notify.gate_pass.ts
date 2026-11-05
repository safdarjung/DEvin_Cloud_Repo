// X07-T7 — 06 §3/rulings (Notification): approval notice for a student gate
// pass. Payload: `{ gate_pass_id }` (app.enqueue_gate_pass_notice,
// 20261028000090, enqueues one per pending -> approved transition with
// idempotency_key = `gatepass:<id>`). Every value in the rendered message
// is re-read from the current DB rows below — never the payload — and the
// pass's own current state is re-checked at send time (lesson 11), same
// shape as notify.attendance_absence.ts.
import { InstitutionSettingsSchema } from "../../core/schemas.ts";
import { createNotification } from "../../notifications/service.ts";
import type { JobHandler } from "../types.ts";

export const notifyGatePass: JobHandler = async (job, { admin }) => {
  const gatePassId = job.payload.gate_pass_id;
  if (typeof gatePassId !== "string" || gatePassId.length === 0) {
    throw new Error("notify.gate_pass: missing gate_pass_id");
  }

  const { data: pass, error: passError } = await admin
    .from("gate_passes")
    .select("id, institution_id, student_id, status, collector_name, decided_at")
    .eq("id", gatePassId)
    .maybeSingle();
  if (passError) throw passError;
  // Deleted, or the job is stale — nothing to notify about.
  if (!pass) return;

  // Re-check state at send time (lesson 11): a pass cancelled, or already
  // moved past approval, before the job ran is not an approval notice any
  // more. `exited` is still allowed — approval already happened, the
  // student simply left since (rulings: "approval only — no exit
  // notification", i.e. no *separate* notice, not that an approved pass
  // that has since exited should go unnotified).
  if (pass.status !== "approved" && pass.status !== "exited") return;
  if (!pass.decided_at) return;

  const { data: institution, error: institutionError } = await admin
    .from("institutions")
    .select("name, settings")
    .eq("id", pass.institution_id)
    .single();
  if (institutionError) throw institutionError;

  const { data: student, error: studentError } = await admin
    .from("students")
    .select("first_name, last_name")
    .eq("id", pass.student_id)
    .eq("institution_id", pass.institution_id)
    .single();
  if (studentError) throw studentError;

  const { data: enrolment, error: enrolmentError } = await admin
    .from("enrolments")
    .select("class_section_id")
    .eq("institution_id", pass.institution_id)
    .eq("student_id", pass.student_id)
    .eq("status", "active")
    .maybeSingle();
  if (enrolmentError) throw enrolmentError;
  // No active enrolment (withdrawn since) — no sensible class to render.
  if (!enrolment) return;

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
    .eq("institution_id", pass.institution_id)
    .eq("student_id", pass.student_id)
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

  // Mirrors notify.attendance_absence.ts: the guardian's portal account is
  // the active `guardian` membership row, not `guardians.user_id`.
  const { data: membership, error: membershipError } = await admin
    .from("memberships")
    .select("user_id")
    .eq("institution_id", pass.institution_id)
    .eq("guardian_id", primary.guardian_id)
    .eq("role", "guardian")
    .eq("status", "active")
    .maybeSingle();
  if (membershipError) throw membershipError;
  // No portal account — in-app notification has no recipient.
  if (!membership) return;

  const settings = institution.settings as { locale?: unknown; communication?: { languages?: unknown } } | null;
  const locale = InstitutionSettingsSchema.shape.locale.safeParse(settings?.locale);
  const timeZone = locale.success ? locale.data.timezone : "Asia/Kolkata";
  const timeParts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(pass.decided_at));
  const byType = new Map(timeParts.map((p) => [p.type, p.value]));
  const time = `${byType.get("hour")}:${byType.get("minute")}`;

  const languages = settings?.communication?.languages;
  const lang = Array.isArray(languages) && languages[0] === "hi" ? "hi" : "en";

  await createNotification(admin, {
    institutionId: pass.institution_id,
    recipientUserId: membership.user_id,
    type: "gate_pass_approved",
    entityId: pass.id,
    lang,
    vars: {
      student: [student.first_name, student.last_name].filter(Boolean).join(" "),
      class: `${grade.code}-${section.name}`,
      collector: pass.collector_name,
      time,
      school: institution.name,
    },
    contacts: { sms: guardian.phone },
  });
};
