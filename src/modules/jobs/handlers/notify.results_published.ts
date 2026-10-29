// T-019 (lead ruling — T-038 left this as a placeholder because `results`
// didn't exist yet, 06 §W7/§3). Payload: `{ result_id, student_id, exam_id }`
// (app.publish_exam_results, 20261028000018, enqueues one of these per
// published result with `idempotency_key = result:<result_id>`). Every
// value in the rendered message is re-read from the current DB rows below —
// never the payload — and the result's own current/published state is
// re-checked at send time, same shape as notify.attendance_absence.ts.
import { createNotification } from "../../notifications/service.ts";
import type { JobHandler } from "../types.ts";

export const notifyResultsPublished: JobHandler = async (job, { admin }) => {
  const resultId = job.payload.result_id;
  if (typeof resultId !== "string" || resultId.length === 0) {
    throw new Error("notify.results_published: missing result_id");
  }

  const { data: result, error: resultError } = await admin
    .from("results")
    .select("id, institution_id, exam_id, student_id, superseded_by")
    .eq("id", resultId)
    .maybeSingle();
  if (resultError) throw resultError;
  // Deleted, or the job is stale — nothing to notify about.
  if (!result) return;
  // Re-check state at send time (lead ruling): a recheck correction may
  // have superseded this exact version before the job ran — only notify
  // for the result that is still current.
  if (result.superseded_by !== null) return;

  const { data: exam, error: examError } = await admin
    .from("exams")
    .select("name, status")
    .eq("id", result.exam_id)
    .eq("institution_id", result.institution_id)
    .single();
  if (examError) throw examError;
  // Defense in depth: no RPC ever unpublishes an exam, but never send on a
  // stale assumption about current state.
  if (exam.status !== "published") return;

  const { data: institution, error: institutionError } = await admin
    .from("institutions")
    .select("name, settings")
    .eq("id", result.institution_id)
    .single();
  if (institutionError) throw institutionError;

  const { data: student, error: studentError } = await admin
    .from("students")
    .select("first_name, last_name")
    .eq("id", result.student_id)
    .eq("institution_id", result.institution_id)
    .single();
  if (studentError) throw studentError;

  const languages = (institution.settings as { communication?: { languages?: unknown } } | null)?.communication
    ?.languages;
  const lang = Array.isArray(languages) && languages[0] === "hi" ? "hi" : "en";

  const vars = {
    student: [student.first_name, student.last_name].filter(Boolean).join(" "),
    exam: exam.name,
    school: institution.name,
  };

  // Recipients (lead ruling): every guardian with an active membership
  // linked to this student, plus the student's own active membership —
  // never just the primary guardian (unlike notify.attendance_absence/
  // notify.enrolment_welcome, which are both single-recipient by design).
  const { data: guardianLinks, error: guardianLinksError } = await admin
    .from("guardian_students")
    .select("guardian_id, guardians(phone)")
    .eq("institution_id", result.institution_id)
    .eq("student_id", result.student_id);
  if (guardianLinksError) throw guardianLinksError;

  const guardianIds = (guardianLinks ?? []).map((g) => g.guardian_id);
  const phoneByGuardianId = new Map(
    (guardianLinks ?? []).map((g) => [g.guardian_id, (g.guardians as { phone: string | null } | null)?.phone ?? null]),
  );

  const recipients: Array<{ userId: string; sms: string | null }> = [];

  const { data: studentMembership, error: studentMembershipError } = await admin
    .from("memberships")
    .select("user_id")
    .eq("institution_id", result.institution_id)
    .eq("student_id", result.student_id)
    .eq("role", "student")
    .eq("status", "active")
    .maybeSingle();
  if (studentMembershipError) throw studentMembershipError;
  if (studentMembership) recipients.push({ userId: studentMembership.user_id, sms: null });

  if (guardianIds.length > 0) {
    const { data: guardianMemberships, error: guardianMembershipsError } = await admin
      .from("memberships")
      .select("user_id, guardian_id")
      .eq("institution_id", result.institution_id)
      .in("guardian_id", guardianIds)
      .eq("role", "guardian")
      .eq("status", "active");
    if (guardianMembershipsError) throw guardianMembershipsError;
    for (const membership of guardianMemberships ?? []) {
      recipients.push({ userId: membership.user_id, sms: phoneByGuardianId.get(membership.guardian_id ?? "") ?? null });
    }
  }

  for (const recipient of recipients) {
    await createNotification(admin, {
      institutionId: result.institution_id,
      recipientUserId: recipient.userId,
      type: "results_published",
      entityId: result.id,
      lang,
      vars,
      contacts: { sms: recipient.sms },
    });
  }
};
